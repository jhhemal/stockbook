import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon, Loading, Modal, useToast } from '../ui';
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

function barClass(line) {
  const p = line.qtyOrdered ? line.qtyFulfilled / line.qtyOrdered : 0;
  if (p >= 1) return 'green';
  if (p >= 1 / 3) return 'blue';
  return 'red';
}

function lineLabel(line) {
  let s = line.productName;
  if (line.grades.length) s += ' · ' + line.grades.join('/');
  if (line.batteryMin) s += ` · ${line.batteryMin}+`;
  return s;
}

function FulfillModal({ order, line, products, grades, onClose, onSaved }) {
  const toast = useToast();
  const [qtyOrdered, setQtyOrdered] = useState(line.qtyOrdered);
  const [qtyFulfilled, setQtyFulfilled] = useState(line.qtyFulfilled);
  const [note, setNote] = useState(line.note || '');
  const [busy, setBusy] = useState(false);

  const product = products.find(p => p.id === line.productId);
  const stockHint = product
    ? (line.grades.length
        ? grades.filter(g => line.grades.includes(g.name)).map(g => `${g.name} ${product.counts[g.id] || 0}`).join(' · ')
        : `${product.total} total`)
    : null;

  const save = async () => {
    if (!qtyOrdered || qtyOrdered < 1) { toast('Quantity needed must be at least 1'); return; }
    const delta = qtyFulfilled - line.qtyFulfilled;
    const noteChanged = note !== (line.note || '');
    if (!delta && qtyOrdered === line.qtyOrdered && !noteChanged) { onClose(); return; }
    setBusy(true);
    try {
      if (qtyOrdered !== line.qtyOrdered || noteChanged) {
        await api.patch(`/api/orders/${order.id}/lines/${line.id}`,
          { qty_ordered: qtyOrdered, note });
      }
      if (delta) {
        await api.post(`/api/orders/${order.id}/lines/${line.id}/fulfill`, { qty: delta });
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
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [partners, setPartners] = useState([]);
  const [products, setProducts] = useState([]);
  const [grades, setGrades] = useState([]);
  const [tab, setTab] = useState('active');           // active | done
  const [partnerFilter, setPartnerFilter] = useState('');
  const [editing, setEditing] = useState(undefined);  // undefined=closed, null=new, obj=edit
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

  useEffect(() => {
    (async () => {
      try {
        const [pt, p, g] = await Promise.all([
          api.get('/api/partners'), api.get('/api/products'), api.get('/api/grades'),
        ]);
        setPartners(pt); setProducts(p); setGrades(g);
        await loadOrders();
      } catch (err) { toast(err.message); }
    })();
  }, []);

  const switchTab = t => { setTab(t); setOrders(null); loadOrders(t, partnerFilter); };
  const switchPartner = id => {
    const next = partnerFilter === id ? '' : id;
    setPartnerFilter(next); setOrders(null); loadOrders(tab, next);
  };

  if (!orders) return <Loading />;

  const unitsNeeded = orders.reduce((n, o) =>
    n + (o.status === 'active' ? o.lines.reduce((m, l) => m + Math.max(0, l.qtyOrdered - l.qtyFulfilled), 0) : 0), 0);

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
      </div>

      <div className="orders-grid">
        {orders.length ? orders.map(o => (
          <div className="order-card" key={o.id} style={{ borderLeftColor: o.partnerColor }}>
            <div className="order-head">
              <div className="order-client">{o.clientName}</div>
              {o.isRush && <span className="rush-pill"><Icon name="bolt" size={11} /> Rush</span>}
              {o.status === 'cancelled' && <span className="pill off">cancelled</span>}
              <button className="edit-dot" aria-label="Edit order" onClick={() => setEditing(o)}><Icon name="dots" /></button>
            </div>
            <div className="order-sub">
              via {o.partnerName}
              {shipByLabel(o) && <> · <span className={shipByOverdue(o) ? 'overdue' : ''}>ship by {shipByLabel(o)}</span></>}
            </div>
            {o.lines.map(l => {
              const done = l.qtyFulfilled >= l.qtyOrdered;
              const clickable = o.status !== 'cancelled';
              return (
                <button type="button" className={`order-line ${done ? 'ol-done' : ''}`} key={l.id}
                  disabled={!clickable}
                  onClick={() => clickable && setFulfilling({ order: o, line: l })}>
                  <div className="ol-row">
                    <span className="ol-name">
                      {lineLabel(l)}
                      {l.note && <span className="note-badge">{l.note}</span>}
                    </span>
                    <span className="ol-qty">{l.qtyFulfilled}/{l.qtyOrdered}{done ? ' ✓' : ''}</span>
                  </div>
                  <div className="obar">
                    <i className={barClass(l)} style={{ width: `${Math.min(100, (l.qtyFulfilled / l.qtyOrdered) * 100)}%` }}></i>
                  </div>
                </button>
              );
            })}
          </div>
        )) : loadError ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <b>Couldn't load orders</b>
            <p><button className="btn btn-ghost btn-sm" onClick={() => { setOrders(null); setLoadError(false); loadOrders(); }}>Retry</button></p>
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
          onProductsChanged={async () => setProducts(await api.get('/api/products'))} />
      )}
      {fulfilling && (
        <FulfillModal order={fulfilling.order} line={fulfilling.line} products={products} grades={grades}
          onClose={() => setFulfilling(null)}
          onSaved={() => { setFulfilling(null); loadOrders(); }} />
      )}
    </>
  );
}
