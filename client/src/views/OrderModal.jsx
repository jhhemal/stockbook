import { useState } from 'react';
import { api } from '../api';
import { Icon, Modal, useToast } from '../ui';
import { parseOrderText, matchProduct } from '../orderParse';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NEW_PRODUCT = '__new';

let lineKey = 0;
const blankLine = () => ({ key: ++lineKey, id: null, productId: '', newModel: '', newStorage: '', batteryMin: '', qty: 1 });

/* Lines used to carry their own grades; orders in practice use the same
 * grade set for everything, so pick it up as the order-level default. */
function commonGrades(orderLines) {
  const first = orderLines[0]?.grades || [];
  const key = [...first].sort().join(',');
  const same = orderLines.every(l => [...(l.grades || [])].sort().join(',') === key);
  return same ? first : [];
}

export default function OrderModal({ order, me, partners, products, grades, onClose, onSaved, onProductsChanged }) {
  const isNew = !order;
  const toast = useToast();
  const [clientName, setClientName] = useState(order?.clientName || '');
  const [partnerId, setPartnerId] = useState(order?.partnerId || partners[0]?.id || '');
  const [isRush, setIsRush] = useState(order?.isRush || false);
  const [gradeNames, setGradeNames] = useState(() => (order ? commonGrades(order.lines) : []));
  const [shipMode, setShipMode] = useState(order?.shipByType || 'none'); // none | date | day
  const [shipDate, setShipDate] = useState(order?.shipByType === 'date' ? order.shipByValue : '');
  const [shipDay, setShipDay] = useState(order?.shipByType === 'day' ? order.shipByValue : 'Friday');
  const [lines, setLines] = useState(() =>
    order
      ? order.lines.map(l => ({
          key: ++lineKey, id: l.id, productId: l.productId || '', productName: l.productName,
          newModel: '', newStorage: '', batteryMin: l.batteryMin || '', qty: l.qtyOrdered,
        }))
      : [blankLine()]);
  const [removedIds, setRemovedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = line => {
    if (line.id) setRemovedIds(ids => [...ids, line.id]);
    setLines(ls => ls.filter(l => l.key !== line.key));
  };
  const toggleGrade = name =>
    setGradeNames(gs => (gs.includes(name) ? gs.filter(g => g !== name) : [...gs, name]));

  const handleParse = () => {
    const { clientName: cn, gradeName: gn, items } = parseOrderText(pasteText, grades);
    if (!items.length) { toast('No order lines found in that text'); return; }
    if (cn) setClientName(cn);
    if (gn) setGradeNames([gn]);
    setLines(items.map(it => {
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
      return line;
    }));
    setPasteText('');
    setShowPaste(false);
    toast(`Parsed ${items.length} line${items.length === 1 ? '' : 's'} — review before saving`);
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
          body.lines.push({ product_id: await resolveProduct(l), grades: gradeNames, battery_min: l.batteryMin || null, qty: l.qty });
        }
        await api.post('/api/orders', body);
        toast('Order created');
      } else {
        await api.patch(`/api/orders/${order.id}`, { clientName, partner_id: partnerId, isRush, ...shipBody() });
        for (const id of removedIds) {
          await api.del(`/api/orders/${order.id}/lines/${id}`);
          setRemovedIds(ids => ids.filter(x => x !== id));
        }
        for (const l of lines) {
          if (l.id) {
            await api.patch(`/api/orders/${order.id}/lines/${l.id}`,
              { grades: gradeNames, battery_min: l.batteryMin || null, qty_ordered: l.qty });
          } else {
            const updated = await api.post(`/api/orders/${order.id}/lines`,
              { product_id: await resolveProduct(l), grades: gradeNames, battery_min: l.batteryMin || null, qty: l.qty });
            const created = updated.lines[updated.lines.length - 1];
            if (created) setLine(l.key, { id: created.id, productName: created.productName });
          }
        }
        toast('Saved');
      }
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
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
    if (!confirm(`Delete order for ${order.clientName}? This can't be undone.`)) return;
    setBusy(true);
    try { await api.del(`/api/orders/${order.id}`); toast('Order deleted'); onSaved(); }
    catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'New order' : `Edit ${order.clientName}`} onClose={onClose}>
      {isNew && (
        <div style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPaste(s => !s)}>
            <Icon name="plus" /> Paste from WhatsApp
          </button>
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
        <div className="field">
          <label>Partner</label>
          <div className="select-wrap">
            <select value={partnerId} onChange={e => setPartnerId(e.target.value)}>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
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
        <div className="field">
          <label>Rush</label>
          <div className="toggle-row" style={{ border: 'none', padding: '8px 0 0', margin: 0 }}>
            <span style={{ fontSize: 13 }}>⚡ Priority order</span>
            <span className="switch">
              <input type="checkbox" checked={isRush} onChange={e => setIsRush(e.target.checked)} /><i></i>
            </span>
          </div>
        </div>
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
            <div className="select-wrap">
              <select value={shipDay} onChange={e => setShipDay(e.target.value)}>
                {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="side-label" style={{ margin: '16px 0 8px' }}>Lines</div>
      {lines.map(line => (
        <div className="line-editor" key={line.key}>
          <div className="line-editor-top">
            {line.id ? (
              <div className="line-fixed-name">{line.productName}</div>
            ) : (
              <div className="select-wrap" style={{ flex: 1 }}>
                <select value={line.productId} onChange={e => setLine(line.key, { productId: e.target.value })}>
                  <option value="">Select product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  <option value={NEW_PRODUCT}>+ New product…</option>
                </select>
              </div>
            )}
            <input className="line-qty" type="number" min="1" inputMode="numeric" value={line.qty}
              onChange={e => setLine(line.key, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
              onFocus={e => e.target.select()} aria-label="Quantity" />
            <button className="icon-btn danger" type="button" aria-label="Remove line" onClick={() => removeLine(line)}><Icon name="trash" /></button>
          </div>
          {line.productId === NEW_PRODUCT && (
            <div className="line-newprod">
              <input value={line.newModel} onChange={e => setLine(line.key, { newModel: e.target.value })} placeholder="Model, e.g. 17 Pro" />
              <input value={line.newStorage} onChange={e => setLine(line.key, { newStorage: e.target.value })} placeholder="Any (edit later)" />
            </div>
          )}
          <div className="line-editor-bottom">
            <div className="seg battery-seg">
              {['', 80, 85, 90, 95].map(b => (
                <button key={b || 'any'} type="button" className={`seg-btn seg-sm ${String(line.batteryMin) === String(b) ? 'selected' : ''}`}
                  aria-pressed={String(line.batteryMin) === String(b)}
                  onClick={() => setLine(line.key, { batteryMin: b })}>{b ? `${b}%+` : 'Any'}</button>
              ))}
            </div>
          </div>
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
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{isNew ? 'Create order' : 'Save'}</button>
      </div>
    </Modal>
  );
}
