import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { api } from '../api';
import { copyText, Icon, Loading, Modal, Select, useRefetchOnFocus, useToast } from '../ui';
import { modelSortKey } from '../orderParse';
import OrderModal from './OrderModal';

const WEEKDAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

export function shipByLabel(o) {
  if (!o.shipByType || !o.shipByValue) return null;
  if (o.shipByType === 'day') return WEEKDAY_SHORT[o.shipByValue] || o.shipByValue;
  const d = new Date(o.shipByValue + 'T00:00:00');
  return isNaN(d) ? o.shipByValue : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function shipByOverdue(o) {
  return o.status === 'active' && o.shipByType === 'date' &&
    o.shipByValue < new Date().toISOString().slice(0, 10);
}

// A "day" ship-by (e.g. "Friday") is due today whenever today happens to
// land on that weekday — it's a recurring label, not a one-off date.
function shipsToday(o) {
  if (o.shipByType === 'date') return o.shipByValue === new Date().toISOString().slice(0, 10);
  if (o.shipByType === 'day') return o.shipByValue === new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return false;
}

function barClass(line) {
  const p = line.qtyOrdered ? line.qtyFulfilled / line.qtyOrdered : 0;
  if (p >= 1) return 'green';
  if (p >= 1 / 3) return 'blue';
  return 'red';
}

function orderProgress(order) {
  const ordered = order.lines.reduce((n, l) => n + l.qtyOrdered, 0);
  const fulfilled = order.lines.reduce((n, l) => n + l.qtyFulfilled, 0);
  const p = ordered ? fulfilled / ordered : 0;
  return { ordered, fulfilled, cls: p >= 1 ? 'green' : p >= 1 / 3 ? 'blue' : 'red' };
}

function lineLabel(line) {
  // productName is a snapshot saved to the order line when it was created —
  // older lines have "1024" baked in from before storage got formatted as
  // "1TB", and that stored text never gets rewritten. Fixing it here at
  // display time covers old and new snapshots alike.
  let s = line.productName.replace(/\b1024\b/, '1TB');
  if (line.grades.length) s += ' · ' + line.grades.join('/');
  if (line.batteryMin) s += ` · ${line.batteryMin}+`;
  return s;
}

/* Lines come back from the server in insertion order (whenever each one
 * was added to the order), not name order — sort for display here since
 * the server itself doesn't reorder them on every edit. */
function sortedLines(lines) {
  return [...lines].sort((a, b) =>
    modelSortKey(a.productName, '').localeCompare(modelSortKey(b.productName, ''), undefined, { numeric: true, sensitivity: 'base' }));
}

// A- routinely gets used to fill an A order at this shop, so a line asking
// for A should also count A- stock as usable toward it (not the reverse).
function substituteGrades(names) {
  return names.includes('A') && !names.includes('A-') ? [...names, 'A-'] : names;
}

/* Per-grade stock breakdown for this line's product (every grade actually
 * holding stock, not just the ones the order asked for — so staff can see
 * what else is available to offer as a substitute). null once the product's
 * been deleted. cls is colored off whether the order's own allowed grades
 * (plus accepted substitutes) cover what's still needed. */
function lineStock(line, products, grades) {
  const product = products.find(p => p.id === line.productId);
  if (!product) return null;
  const entries = grades
    .map(g => ({ name: g.name, qty: product.counts[g.id] || 0 }))
    .filter(e => e.qty > 0);
  const wanted = substituteGrades(line.grades);
  const usable = line.grades.length
    ? entries.filter(e => wanted.includes(e.name)).reduce((n, e) => n + e.qty, 0)
    : product.total;
  const remaining = Math.max(0, line.qtyOrdered - line.qtyFulfilled);
  return { entries, cls: usable <= 0 ? 'red' : usable >= remaining ? 'green' : 'blue' };
}

/* The order-line rows — shared between the grid card and the focused view
 * popup so the two don't drift out of sync with duplicated markup. */
function OrderLines({ order, products, grades, onFulfillClick }) {
  return sortedLines(order.lines).map(l => {
    const done = l.qtyFulfilled >= l.qtyOrdered;
    const clickable = order.status !== 'cancelled';
    const stock = !done ? lineStock(l, products, grades) : null;
    return (
      <button type="button" className={`order-line ${done ? 'ol-done' : ''}`} key={l.id}
        disabled={!clickable}
        onClick={() => clickable && onFulfillClick(l)}>
        <div className="ol-row">
          <span className="ol-name">
            {lineLabel(l)}
            {l.note && <span className="note-badge">{l.note}</span>}
            {stock && (
              <span className={`stock-badge ${stock.cls}`}>
                {stock.entries.length
                  ? stock.entries.map(e => `${e.name}: ${e.qty}`).join(' · ')
                  : 'Out of stock'}
              </span>
            )}
          </span>
          <span className="ol-qty">{l.qtyFulfilled}/{l.qtyOrdered}{done ? ' ✓' : ''}</span>
        </div>
        <div className="obar">
          <i className={barClass(l)} style={{ width: `${Math.min(100, (l.qtyFulfilled / l.qtyOrdered) * 100)}%` }}></i>
        </div>
      </button>
    );
  });
}

/* Read-only "focus on this order" popup — opened by tapping the client
 * name/subtitle on a card, as distinct from the 3-dot icon which opens the
 * actual edit form. Dims the rest of the page via the shared Modal. */
function OrderViewModal({ order, products, grades, isPartner, onClose, onEdit, onFulfillClick, onCopyReport, onShareImage, onToggleShelf }) {
  const prog = orderProgress(order);
  return (
    <Modal title={order.clientName} onClose={onClose}>
      <div className="fulfill-meta" style={{ marginBottom: 14 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`order-progress ${prog.cls}`}>{prog.fulfilled}/{prog.ordered} supplied</span>
          {order.isRush && <span className="rush-pill"><Icon name="bolt" size={11} /> Rush</span>}
          {order.status === 'cancelled' && <span className="pill off">cancelled</span>}
        </span>
        <span className="row-sub">
          via {order.partnerName}
          {shipByLabel(order) && <> · <span className={shipByOverdue(order) ? 'overdue' : ''}>ship by {shipByLabel(order)}</span></>}
        </span>
        {!isPartner && (
          <label className="shelf-check">
            <input type="checkbox" checked={!!order.shelfWritten} onChange={onToggleShelf} />
            Written on shelf
          </label>
        )}
      </div>
      <OrderLines order={order} products={products} grades={grades} onFulfillClick={onFulfillClick} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCopyReport}><Icon name="wa" /></button>
        <button className="btn btn-ghost" onClick={onShareImage}><Icon name="image" /></button>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <button className="btn btn-primary" onClick={onEdit}>Edit</button>
      </div>
    </Modal>
  );
}

/* WhatsApp-ready status update for one order — what's been supplied so far
 * and what's still owed, so it can be sent whenever the client asks. */
function orderReportText(order) {
  const lines = [`${order.clientName} — via ${order.partnerName}`, ''];
  for (const l of sortedLines(order.lines)) {
    const remaining = Math.max(0, l.qtyOrdered - l.qtyFulfilled);
    lines.push(lineLabel(l));
    lines.push(remaining > 0
      ? `${l.qtyFulfilled}/${l.qtyOrdered} supplied, ${remaining} needed`
      : `${l.qtyFulfilled}/${l.qtyOrdered} ✓ done`);
    lines.push('');
  }
  const { fulfilled, ordered } = orderProgress(order);
  const remaining = Math.max(0, ordered - fulfilled);
  lines.push(remaining > 0
    ? `Total: ${fulfilled}/${ordered} supplied, ${remaining} still needed`
    : `Total: ${fulfilled}/${ordered} — all supplied ✓`);
  return lines.join('\n').trim();
}

function FulfillModal({ order, line, products, grades, onClose, onSaved, onProductsChanged }) {
  const toast = useToast();
  const [qtyOrdered, setQtyOrdered] = useState(line.qtyOrdered);
  const [qtyFulfilled, setQtyFulfilled] = useState(line.qtyFulfilled);
  const [note, setNote] = useState(line.note || '');
  const [fromStock, setFromStock] = useState(false);
  const [stockGradeId, setStockGradeId] = useState('');
  const [busy, setBusy] = useState(false);

  const delta = qtyFulfilled - line.qtyFulfilled;
  const product = products.find(p => p.id === line.productId);
  const stockHint = product
    ? (line.grades.length
        ? grades.filter(g => substituteGrades(line.grades).includes(g.name)).map(g => `${g.name} ${product.counts[g.id] || 0}`).join(' · ')
        : `${product.total} total`)
    : null;
  // Units go into "supplied" from two places: pulled off the shelf (should
  // come off the tracked count too) or handed over fresh from testing,
  // never having touched stock — hence this being opt-in, not automatic.
  const stockGradeOptions = product
    ? (line.grades.length ? grades.filter(g => substituteGrades(line.grades).includes(g.name)) : grades)
        .filter(g => (product.counts[g.id] || 0) > 0)
        .map(g => ({ value: g.id, label: `${g.name} (${product.counts[g.id]} in stock)` }))
    : [];

  const save = async () => {
    if (!qtyOrdered || qtyOrdered < 1) { toast('Quantity needed must be at least 1'); return; }
    const noteChanged = note !== (line.note || '');
    if (!delta && qtyOrdered === line.qtyOrdered && !noteChanged) { onClose(); return; }
    if (fromStock && delta > 0 && !stockGradeId) { toast('Pick which grade to deduct from stock'); return; }
    setBusy(true);
    try {
      if (qtyOrdered !== line.qtyOrdered || noteChanged) {
        await api.patch(`/api/orders/${order.id}/lines/${line.id}`,
          { qty_ordered: qtyOrdered, note });
      }
      if (delta) {
        // The stock deduction (when requested) happens server-side as part
        // of this same call — a partner is allowed to fulfill (and thus
        // deduct stock for) their own order, but must never be able to
        // call the general stock-adjust endpoint directly.
        await api.post(`/api/orders/${order.id}/lines/${line.id}/fulfill`, {
          qty: delta,
          ...(fromStock && delta > 0 ? { deduct_grade_id: stockGradeId } : {}),
        });
        if (fromStock && delta > 0) onProductsChanged?.();
      }
      toast('Updated');
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={lineLabel(line)} onClose={onClose}>
      <div className="fulfill-meta">
        <span><b>{line.qtyFulfilled}</b> of <b>{line.qtyOrdered}</b> supplied</span>
        {stockHint && <span className="row-sub">In stock: {stockHint}</span>}
        {line.note && <span className="note-badge" style={{ marginLeft: 0 }}>{line.note}</span>}
      </div>
      <div className="field">
        <label>Quantity needed</label>
        <div className="stepper">
          <button type="button" className="step-btn" onClick={() => setQtyOrdered(q => Math.max(1, q - 1))}>−</button>
          <input type="number" min="1" inputMode="numeric" value={qtyOrdered}
            onChange={e => setQtyOrdered(Math.max(1, parseInt(e.target.value) || 1))}
            onFocus={e => e.target.select()} />
          <button type="button" className="step-btn" onClick={() => setQtyOrdered(q => q + 1)}>+</button>
        </div>
      </div>
      <div className="field">
        <label>Units supplied</label>
        <div className="stepper">
          <button type="button" className="step-btn" onClick={() => setQtyFulfilled(q => Math.max(0, q - 1))}>−</button>
          <input type="number" min="0" inputMode="numeric" value={qtyFulfilled}
            onChange={e => setQtyFulfilled(Math.max(0, parseInt(e.target.value) || 0))}
            onFocus={e => e.target.select()} />
          <button type="button" className="step-btn" onClick={() => setQtyFulfilled(q => Math.min(qtyOrdered, q + 1))}>+</button>
        </div>
      </div>
      {product && delta > 0 && stockGradeOptions.length > 0 && (
        <div className="field">
          <div className="toggle-row" style={{ border: 'none', padding: 0, margin: fromStock ? '0 0 8px' : 0 }}>
            <span>Deduct from stock</span>
            <span className="switch">
              <input type="checkbox" checked={fromStock} onChange={e => {
                const on = e.target.checked;
                setFromStock(on);
                if (on && !stockGradeId) setStockGradeId(stockGradeOptions[0].value);
              }} /><i></i>
            </span>
          </div>
          {fromStock && (
            <Select value={stockGradeId} onChange={setStockGradeId} placeholder="Which grade?" options={stockGradeOptions} />
          )}
        </div>
      )}
      <div className="field">
        <label>Extra requirement</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. only pink, no black" />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

export default function Orders({ me }) {
  const isPartner = me.role === 'partner';
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [partners, setPartners] = useState([]);
  const [products, setProducts] = useState([]);
  const [grades, setGrades] = useState([]);
  const [tab, setTab] = useState('active');           // active | done
  const [partnerFilter, setPartnerFilter] = useState('');
  const [rushOnly, setRushOnly] = useState(false);
  const [shipFilter, setShipFilter] = useState('');    // '' | 'today' | 'overdue'
  const [shelfFilter, setShelfFilter] = useState(false); // true = show only "not written" orders
  const [editing, setEditing] = useState(undefined);  // undefined=closed, null=new, obj=edit
  const [viewing, setViewing] = useState(null);       // order being read-only-viewed, or null
  const [fulfilling, setFulfilling] = useState(null); // { order, line }
  const [loadError, setLoadError] = useState(false);
  const loadSeq = useRef(0);

  const loadOrders = async (t = tab, pf = partnerFilter) => {
    const seq = ++loadSeq.current;
    try {
      const q = `/api/orders?status=${t}` + (pf ? `&partner_id=${pf}` : '');
      const data = await api.get(q);
      if (seq !== loadSeq.current) return;   // stale response, ignore
      setOrders(data); setLoadError(false);
    } catch (err) {
      if (seq !== loadSeq.current) return;   // stale failure, ignore
      toast(err.message); setOrders([]); setLoadError(true);
    }
  };

  const refreshProducts = async () => setProducts(await api.get('/api/products'));

  useEffect(() => {
    (async () => {
      try {
        // A partner login can't see /api/partners (it's everyone else's
        // business relationships) — they only ever need their own, and
        // that's already embedded in each order (partnerName/partnerColor).
        const [pt, p, g] = await Promise.all([
          isPartner ? Promise.resolve([]) : api.get('/api/partners'),
          api.get('/api/products'), api.get('/api/grades'),
        ]);
        setPartners(pt); setProducts(p); setGrades(g);
        await loadOrders();
      } catch (err) { toast(err.message); }
    })();
  }, []);

  // Another device may have changed an order since this screen loaded —
  // catch up whenever the tab/app regains focus rather than showing stale data.
  useRefetchOnFocus(() => loadOrders());

  const copyOrderReport = async o => {
    const ok = await copyText(orderReportText(o));
    toast(ok ? 'Update copied — paste in WhatsApp' : 'Copy failed — select the text manually');
  };

  const toggleShelf = async o => {
    try {
      const updated = await api.patch(`/api/orders/${o.id}`, { shelf_written: !o.shelfWritten });
      setOrders(os => os.map(x => (x.id === o.id ? updated : x)));
    } catch (err) { toast(err.message); }
  };

  // Renders an order card to a PNG so it can be shared/downloaded looking
  // exactly like it does on screen — the action icons are excluded (they're
  // app-only controls, not part of the update a client should see).
  const cardRefs = useRef(new Map());
  const shareCardImage = async o => {
    const node = cardRefs.current.get(o.id);
    if (!node) return;
    // Hide the action buttons with a real class toggle so the browser
    // actually reflows the card without them before capture, rather than
    // relying on html-to-image's own node filter — pruning nodes only
    // during its clone/serialize step (after layout) was producing glitches
    // (wrapped text overlapping the row below it) on some phones.
    node.classList.add('capturing');
    try {
      // Wait for web fonts so text isn't rasterized against a fallback font
      // metric, and render at a fixed high pixel ratio — matching only the
      // viewing device's devicePixelRatio produced soft/blurry text on
      // higher-density phone screens WhatsApp images get viewed at.
      if (document.fonts?.ready) await document.fonts.ready;
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        backgroundColor: '#ffffff',
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `${o.clientName.replace(/\s+/g, '_') || 'order'}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: o.clientName });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Image saved — attach it in WhatsApp');
    } catch (err) {
      if (err?.name === 'AbortError') return; // user cancelled the share sheet
      toast('Could not create the image — try again');
    } finally {
      node.classList.remove('capturing');
    }
  };

  const switchTab = t => { setTab(t); setOrders(null); loadOrders(t, partnerFilter); };
  const switchPartner = id => {
    const next = partnerFilter === id ? '' : id;
    setPartnerFilter(next); setOrders(null); loadOrders(tab, next);
  };

  if (!orders) return <Loading />;

  const unitsNeeded = orders.reduce((n, o) =>
    n + (o.status === 'active' ? o.lines.reduce((m, l) => m + Math.max(0, l.qtyOrdered - l.qtyFulfilled), 0) : 0), 0);

  const visibleOrders = orders.filter(o =>
    (!rushOnly || o.isRush) &&
    (shipFilter !== 'today' || shipsToday(o)) &&
    (shipFilter !== 'overdue' || shipByOverdue(o)) &&
    (!shelfFilter || !o.shelfWritten));
  const filtersActive = rushOnly || shipFilter || shelfFilter;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Orders</div>
          <div className="page-sub">
            {tab === 'active' ? `${orders.length} active · ${unitsNeeded} units still needed` : `${orders.length} finished`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(null)}>
          <Icon name="plus" /> New order
        </button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${tab === 'active' ? 'selected' : ''}`} onClick={() => switchTab('active')}>Active</button>
        <button className={`chip ${tab === 'done' ? 'selected' : ''}`} onClick={() => switchTab('done')}>Completed</button>
        <span style={{ width: 6 }}></span>
        {partners.map(p => (
          <button key={p.id} className={`chip ${partnerFilter === p.id ? 'selected' : ''}`} onClick={() => switchPartner(p.id)}>
            <span className="pdot" style={{ background: p.color, width: 9, height: 9, marginRight: 6 }}></span>{p.name}
          </button>
        ))}
        <span style={{ width: 6 }}></span>
        <button className={`chip ${rushOnly ? 'selected' : ''}`} onClick={() => setRushOnly(r => !r)}>
          <Icon name="bolt" size={11} /> Priority
        </button>
        <button className={`chip ${shipFilter === 'today' ? 'selected' : ''}`}
          onClick={() => setShipFilter(f => (f === 'today' ? '' : 'today'))}>Ship today</button>
        <button className={`chip ${shipFilter === 'overdue' ? 'selected' : ''}`}
          onClick={() => setShipFilter(f => (f === 'overdue' ? '' : 'overdue'))}>Overdue</button>
        {!isPartner && (
          <button className={`chip ${shelfFilter ? 'selected' : ''}`} onClick={() => setShelfFilter(s => !s)}>
            Not written
          </button>
        )}
      </div>

      <div className="orders-grid">
        {visibleOrders.length ? visibleOrders.map(o => {
          const prog = orderProgress(o);
          return (
          <div className="order-card" key={o.id} style={{ borderLeftColor: o.partnerColor }}
            ref={el => { if (el) cardRefs.current.set(o.id, el); else cardRefs.current.delete(o.id); }}>
            <div className="order-head">
              <div className="order-client" role="button" tabIndex={0} onClick={() => setViewing(o)}
                onKeyDown={e => e.key === 'Enter' && setViewing(o)}>{o.clientName}</div>
              <span className={`order-progress ${prog.cls}`} title="Units supplied / ordered">{prog.fulfilled}/{prog.ordered}</span>
              {o.isRush && <span className="rush-pill"><Icon name="bolt" size={11} /> Rush</span>}
              {o.status === 'cancelled' && <span className="pill off">cancelled</span>}
              <button className="edit-dot card-action" aria-label="Copy WhatsApp update" onClick={() => copyOrderReport(o)}><Icon name="wa" /></button>
              <button className="edit-dot card-action" aria-label="Share order as image" onClick={() => shareCardImage(o)}><Icon name="image" /></button>
              <button className="edit-dot card-action" aria-label="Edit order" onClick={() => setEditing(o)}><Icon name="dots" /></button>
            </div>
            <div className="order-sub" role="button" tabIndex={0} onClick={() => setViewing(o)}
              onKeyDown={e => e.key === 'Enter' && setViewing(o)}>
              via {o.partnerName}
              {shipByLabel(o) && <> · <span className={shipByOverdue(o) ? 'overdue' : ''}>ship by {shipByLabel(o)}</span></>}
            </div>
            {!isPartner && (
              <label className="shelf-check">
                <input type="checkbox" checked={!!o.shelfWritten} onChange={() => toggleShelf(o)} />
                Written on shelf
              </label>
            )}
            <OrderLines order={o} products={products} grades={grades}
              onFulfillClick={l => setFulfilling({ order: o, line: l })} />
            {/* only shown while rendering the shared image — see .card-credit CSS */}
            <div className="card-credit">
              <span className="card-credit-mark">S</span>
              <span><b className="card-credit-brand">StockBook</b> — Developed by hashtrik.</span>
            </div>
          </div>
          );
        }) : loadError ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <b>Couldn't load orders</b>
            <p><button className="btn btn-ghost btn-sm" onClick={() => { setOrders(null); setLoadError(false); loadOrders(); }}>Retry</button></p>
          </div>
        ) : filtersActive ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <b>No orders match those filters</b>
            <p><button className="btn btn-ghost btn-sm" onClick={() => { setRushOnly(false); setShipFilter(''); setShelfFilter(false); }}>Clear filters</button></p>
          </div>
        ) : (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <b>{tab === 'active' ? 'No active orders' : 'Nothing here yet'}</b>
            <p>{tab === 'active' ? 'Tap "New order" to write your first note.' : 'Completed and cancelled orders will appear here.'}</p>
          </div>
        )}
      </div>

      {editing !== undefined && (
        <OrderModal order={editing} me={me} partners={partners} products={products} grades={grades}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); loadOrders(); }}
          onRefresh={loadOrders}
          onProductsChanged={refreshProducts} />
      )}
      {fulfilling && (
        <FulfillModal order={fulfilling.order} line={fulfilling.line} products={products} grades={grades}
          onClose={() => setFulfilling(null)}
          onSaved={() => { setFulfilling(null); loadOrders(); }}
          onProductsChanged={refreshProducts} />
      )}
      {viewing && (() => {
        // Re-resolve against the live list so a fulfill made while this
        // stays open (opened on top of it) is reflected immediately.
        const order = orders.find(o => o.id === viewing.id) || viewing;
        return (
          <OrderViewModal order={order} products={products} grades={grades} isPartner={isPartner}
            onClose={() => setViewing(null)}
            onEdit={() => { setViewing(null); setEditing(order); }}
            onFulfillClick={l => setFulfilling({ order, line: l })}
            onCopyReport={() => copyOrderReport(order)}
            onShareImage={() => shareCardImage(order)}
            onToggleShelf={() => toggleShelf(order)} />
        );
      })()}
    </>
  );
}
