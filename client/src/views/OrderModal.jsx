import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon, Modal, Select, useConfirm, useToast } from '../ui';
import { parseOrderText, matchProduct, modelSortKey } from '../orderParse';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NEW_PRODUCT = '__new';

let lineKey = 0;
const blankLine = () => ({ key: ++lineKey, id: null, productId: '', newModel: '', newStorage: '', note: '', qty: 1 });

const BATTERY_OPTIONS = [{ value: '', label: 'Any' }, ...[80, 85, 90, 95].map(b => ({ value: b, label: `${b}%+` }))];

/* Best name available for a line, whatever state it's in — an existing
 * line already has its productName resolved, a new line needs a look-up
 * (or the quick-add fields), and a genuinely blank new line sorts last. */
function lineSortName(line, products) {
  if (line.productName) return line.productName;
  if (line.productId === NEW_PRODUCT) return line.newModel ? `${line.newModel} ${line.newStorage}`.trim() : '';
  const p = products.find(p => p.id === line.productId);
  return p ? p.displayName : '';
}

function resortLines(ls, products) {
  return ls
    .map((l, i) => ({ l, i, name: lineSortName(l, products) }))
    .sort((a, b) => {
      if (!a.name || !b.name) return (!a.name && !b.name) ? a.i - b.i : (!a.name ? 1 : -1);
      return modelSortKey(a.name, '').localeCompare(modelSortKey(b.name, ''), undefined, { numeric: true, sensitivity: 'base' });
    })
    .map(x => x.l);
}

/* Lines used to carry their own grades/battery; orders in practice use the
 * same values for everything, so pick them up as order-level defaults. */
function commonGrades(orderLines) {
  const first = orderLines[0]?.grades || [];
  const key = [...first].sort().join(',');
  const same = orderLines.every(l => [...(l.grades || [])].sort().join(',') === key);
  return same ? first : [];
}
function commonBatteryMin(orderLines) {
  const first = orderLines[0]?.batteryMin || '';
  return orderLines.every(l => (l.batteryMin || '') === first) ? first : '';
}

export default function OrderModal({ order, me, partners, products, grades, onClose, onSaved, onRefresh, onProductsChanged }) {
  const isNew = !order;
  const isPartner = me.role === 'partner';
  const toast = useToast();
  const confirm = useConfirm();
  const [clientName, setClientName] = useState(order?.clientName || '');
  const [partnerId, setPartnerId] = useState(order?.partnerId || (isPartner ? me.partnerId : partners[0]?.id) || '');
  const [isRush, setIsRush] = useState(order?.isRush || false);
  const [shelfWritten, setShelfWritten] = useState(order?.shelfWritten || false);
  const [gradeNames, setGradeNames] = useState(() => (order ? commonGrades(order.lines) : []));
  const [batteryMin, setBatteryMin] = useState(() => (order ? commonBatteryMin(order.lines) : ''));
  const [shipMode, setShipMode] = useState(order?.shipByType || 'none'); // none | date | day
  const [shipDate, setShipDate] = useState(order?.shipByType === 'date' ? order.shipByValue : '');
  const [shipDay, setShipDay] = useState(order?.shipByType === 'day' ? order.shipByValue : 'Friday');
  const [lines, setLines] = useState(() =>
    order
      ? resortLines(order.lines.map(l => ({
          key: ++lineKey, id: l.id, productId: l.productId || '', productName: l.productName,
          newModel: '', newStorage: '', note: l.note || '', qty: l.qtyOrdered,
        })), products)
      : [blankLine()]);
  const [removedIds, setRemovedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Nothing is sent to the server until Save — closing (Cancel, clicking
  // outside, Escape) while dirty silently discards edits, including removed
  // lines, which look gone from the form but never actually get deleted.
  const [dirty, setDirty] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) setDirty(true);
    else mounted.current = true;
  }, [clientName, partnerId, isRush, shelfWritten, gradeNames, batteryMin, shipMode, shipDate, shipDay, lines, removedIds]);

  const requestClose = async () => {
    if (dirty && !await confirm({
      title: 'Discard changes?',
      message: 'Your unsaved edits to this order will be lost.',
      confirmLabel: 'Discard',
    })) return;
    onClose();
  };

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  // A line added later shouldn't just sit at the bottom once it's given a
  // product — re-sort right when its identity changes (product picked, or
  // the quick-add model/storage finished being typed), not on every
  // keystroke of qty/note, which would make those rows jump around instead.
  const setLineProduct = (key, patch) =>
    setLines(ls => resortLines(ls.map(l => (l.key === key ? { ...l, ...patch } : l)), products));
  const removeLine = line => {
    if (line.id) setRemovedIds(ids => [...ids, line.id]);
    setLines(ls => ls.filter(l => l.key !== line.key));
  };
  const toggleGrade = name =>
    setGradeNames(gs => (gs.includes(name) ? gs.filter(g => g !== name) : [...gs, name]));

  const handleParse = () => {
    const { clientName: cn, gradeName: gn, batteryMin: bm, items } = parseOrderText(pasteText, grades, products);
    if (!items.length) { toast('No order lines found in that text'); return; }
    if (cn) setClientName(cn);
    if (gn) setGradeNames([gn]);
    if (bm != null) setBatteryMin(bm);
    const sorted = [...items].sort((a, b) =>
      modelSortKey(a.model, a.storage).localeCompare(modelSortKey(b.model, b.storage), undefined, { numeric: true, sensitivity: 'base' }));
    setLines(sorted.map(it => {
      const line = blankLine();
      const match = matchProduct(products, it.model, it.storage);
      if (match) {
        line.productId = match.id;
      } else {
        line.productId = NEW_PRODUCT;
        line.newModel = it.model;
        line.newStorage = it.storage;
      }
      line.qty = it.qty;
      line.note = it.note || '';
      return line;
    }));
    setPasteText('');
    setShowPaste(false);
    toast(`Parsed ${items.length} line${items.length === 1 ? '' : 's'} — review before saving`);
  };

  /* Quick start for a manual order: add every catalog product at qty 1,
   * then delete/adjust whichever weren't actually ordered — faster than
   * repeating Add line -> search -> pick for a big order. Skips products
   * already on the form instead of duplicating them. */
  const addAllProducts = () => {
    setLines(ls => {
      const already = new Set(ls.filter(l => l.productId && l.productId !== NEW_PRODUCT).map(l => l.productId));
      const additions = products.filter(p => !already.has(p.id)).map(p => ({ ...blankLine(), productId: p.id, qty: 1 }));
      if (!additions.length) return ls;
      const base = ls.length === 1 && !ls[0].productId ? [] : ls; // drop the lone still-blank starter line
      return resortLines([...base, ...additions], products);
    });
    toast("Added every product — remove what isn't ordered");
  };

  const shipBody = () => ({
    shipByType: shipMode === 'none' ? null : shipMode,
    shipByValue: shipMode === 'date' ? shipDate : shipMode === 'day' ? shipDay : null,
  });

  /* resolve a line's productId, creating the product first for quick-add lines */
  const resolveProduct = async line => {
    if (line.productId !== NEW_PRODUCT) return line.productId;
    const p = await api.post('/api/products', { model: line.newModel, storage: line.newStorage, counts: {} });
    await onProductsChanged();
    setLine(line.key, { productId: p.id });
    return p.id;
  };

  const save = async () => {
    if (!clientName.trim()) { toast('Client name is required'); return; }
    if (!partnerId) { toast('Pick a partner'); return; }
    if (!lines.length) { toast('Add at least one line'); return; }
    for (const l of lines) {
      if (!l.id && !l.productId) { toast('Every line needs a product'); return; }
      if (l.productId === NEW_PRODUCT && !l.newModel.trim()) { toast('Enter the new product model'); return; }
      if (!l.qty || l.qty < 1) { toast('Line quantities must be at least 1'); return; }
    }
    if (shipMode === 'date' && !shipDate) { toast('Pick a ship-by date'); return; }
    setBusy(true);
    try {
      if (isNew) {
        const body = {
          clientName, partner_id: partnerId, isRush, ...shipBody(),
          lines: [],
        };
        for (const l of lines) {
          body.lines.push({ product_id: await resolveProduct(l), grades: gradeNames, battery_min: batteryMin || null, note: l.note, qty: l.qty });
        }
        await api.post('/api/orders', body);
        toast('Order created');
      } else {
        await api.patch(`/api/orders/${order.id}`, { clientName, partner_id: partnerId, isRush, shelf_written: shelfWritten, ...shipBody() });

        // Each line is its own request; one failing (e.g. a transient network
        // blip) shouldn't stop the rest from saving or leave the Orders list
        // showing stale pre-edit data for the ones that did go through.
        const errors = [];
        for (const id of removedIds) {
          try {
            await api.del(`/api/orders/${order.id}/lines/${id}`);
            setRemovedIds(ids => ids.filter(x => x !== id));
          } catch (err) { errors.push(err.message); }
        }
        for (const l of lines) {
          try {
            if (l.id) {
              await api.patch(`/api/orders/${order.id}/lines/${l.id}`,
                { grades: gradeNames, battery_min: batteryMin || null, note: l.note, qty_ordered: l.qty });
            } else {
              const updated = await api.post(`/api/orders/${order.id}/lines`,
                { product_id: await resolveProduct(l), grades: gradeNames, battery_min: batteryMin || null, note: l.note, qty: l.qty });
              const created = updated.lines[updated.lines.length - 1];
              if (created) setLine(l.key, { id: created.id, productName: created.productName });
            }
          } catch (err) { errors.push(err.message); }
        }

        if (errors.length) {
          toast(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more failed)` : ''));
          onRefresh?.();
          setBusy(false);
          return;
        }
        toast('Saved');
      }
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); onRefresh?.(); }
  };

  const setStatus = async status => {
    setBusy(true);
    try {
      await api.patch(`/api/orders/${order.id}`, { status });
      toast(status === 'active' ? 'Order reopened' : `Order ${status}`);
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
  };

  const remove = async () => {
    if (!await confirm({
      title: 'Delete order?',
      message: `The order for ${order.clientName} will be permanently removed. This can't be undone.`,
    })) return;
    setBusy(true);
    try { await api.del(`/api/orders/${order.id}`); toast('Order deleted'); onSaved(); }
    catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'New order' : `Edit ${order.clientName}`} onClose={requestClose}>
      {isNew && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPaste(s => !s)}>
              <Icon name="plus" /> Paste from WhatsApp
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addAllProducts}>
              <Icon name="plus" /> Add all products
            </button>
          </div>
          {showPaste && (
            <div style={{ marginTop: 8 }}>
              <textarea rows={7} value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder={'Tecnofly #2 A-\n14 x2\n13 pro Max x2\n15 128gb x1'} />
              <div className="modal-actions" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleParse}>Parse</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="form-grid">
        <div className="field full">
          <label>Client name</label>
          <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. CV Juan #1" />
        </div>
        {!isPartner && (
          <div className="field">
            <label>Partner</label>
            <Select value={partnerId} onChange={setPartnerId} options={partners.map(p => ({ value: p.id, label: p.name }))} />
          </div>
        )}
        <div className="field full">
          <label>Grade</label>
          <div className="seg">
            {grades.map(g => (
              <button key={g.id} type="button" className={`seg-btn ${gradeNames.includes(g.name) ? 'selected' : ''}`}
                aria-pressed={gradeNames.includes(g.name)}
                onClick={() => toggleGrade(g.name)}>{g.name}</button>
            ))}
          </div>
        </div>
        <div className="field full">
          <label>Battery</label>
          <div className="seg">
            {BATTERY_OPTIONS.map(b => (
              <button key={b.value || 'any'} type="button" className={`seg-btn ${batteryMin === b.value ? 'selected' : ''}`}
                aria-pressed={batteryMin === b.value}
                onClick={() => setBatteryMin(b.value)}>{b.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Rush</label>
          <div className="toggle-row" style={{ border: 'none', padding: '8px 0 0', margin: 0 }}>
            <span style={{ fontSize: 13 }}>⚡ Priority order</span>
            <span className="switch">
              <input type="checkbox" checked={isRush} onChange={e => setIsRush(e.target.checked)} /><i></i>
            </span>
          </div>
        </div>
        {!isNew && !isPartner && (
          <div className="field">
            <label>Shelf</label>
            <div className="toggle-row" style={{ border: 'none', padding: '8px 0 0', margin: 0 }}>
              <span style={{ fontSize: 13 }}>Written on shelf</span>
              <span className="switch">
                <input type="checkbox" checked={shelfWritten} onChange={e => setShelfWritten(e.target.checked)} /><i></i>
              </span>
            </div>
          </div>
        )}
        <div className="field full">
          <label>Ship by</label>
          <div className="seg" style={{ marginBottom: 8 }}>
            {['none', 'date', 'day'].map(m => (
              <button key={m} type="button" className={`seg-btn ${shipMode === m ? 'selected' : ''}`} onClick={() => setShipMode(m)}>
                {m === 'none' ? 'None' : m === 'date' ? 'Date' : 'Day'}
              </button>
            ))}
          </div>
          {shipMode === 'date' && (
            <input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} />
          )}
          {shipMode === 'day' && (
            <Select value={shipDay} onChange={setShipDay} options={WEEKDAYS.map(d => ({ value: d, label: d }))} />
          )}
        </div>
      </div>

      <div className="side-label" style={{ margin: '16px 0 8px' }}>Lines</div>
      {lines.map(line => (
        <div className="line-editor" key={line.key}>
          <div className="line-editor-top">
            {line.id ? (
              // productName is a saved snapshot — older lines have "1024"
              // baked in from before storage displayed as "1TB".
              <div className="line-fixed-name">{line.productName.replace(/\b1024\b/, '1TB')}</div>
            ) : (
              <Select value={line.productId} onChange={v => setLineProduct(line.key, { productId: v })}
                placeholder="Search product…" searchable
                options={[...products.map(p => ({ value: p.id, label: p.displayName })), { value: NEW_PRODUCT, label: '+ New product…' }]} />
            )}
            <input className="line-qty" type="number" min="1" inputMode="numeric" value={line.qty}
              onChange={e => setLine(line.key, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
              onFocus={e => e.target.select()} aria-label="Quantity" />
            <button className="icon-btn danger" type="button" aria-label="Remove line" onClick={() => removeLine(line)}><Icon name="trash" /></button>
          </div>
          {line.productId === NEW_PRODUCT && (
            <div className="line-newprod">
              <input value={line.newModel} onChange={e => setLine(line.key, { newModel: e.target.value })}
                onBlur={() => setLineProduct(line.key, {})} placeholder="Model, e.g. 17 Pro" />
              <input value={line.newStorage} onChange={e => setLine(line.key, { newStorage: e.target.value })}
                onBlur={() => setLineProduct(line.key, {})} placeholder="Any (edit later)" />
            </div>
          )}
          <input className="line-note" value={line.note} onChange={e => setLine(line.key, { note: e.target.value })}
            placeholder="Extra requirement, e.g. only pink, no black" />
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setLines(ls => [...ls, blankLine()])}>
        <Icon name="plus" /> Add line
      </button>

      {!isNew && (
        <div className="order-status-actions">
          {order.status !== 'completed' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('completed')}>Mark completed</button>}
          {order.status === 'active' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('cancelled')}>Cancel order</button>}
          {order.status !== 'active' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('active')}>Reopen</button>}
          {me?.role === 'admin' && <button className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={requestClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{isNew ? 'Create order' : 'Save'}</button>
      </div>
    </Modal>
  );
}
