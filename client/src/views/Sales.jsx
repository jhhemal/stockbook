import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon, gradeClass, gradeClassByName, useToast } from '../ui';

export default function Sales() {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [grades, setGrades] = useState([]);
  const [sales, setSales] = useState([]);
  const [sel, setSel] = useState({ productId: '', gradeId: '', qty: 1 });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [p, g, s] = await Promise.all([
        api.get('/api/products'), api.get('/api/grades'), api.get('/api/sales?days=30'),
      ]);
      setProducts(p); setGrades(g); setSales(s);
    } catch (err) { toast(err.message); }
  };
  useEffect(() => { load(); }, []);

  if (!products) return <div className="loading">Loading…</div>;

  const prod = products.find(p => p.id === sel.productId);
  const grade = grades.find(g => g.id === sel.gradeId);
  const avail = prod && grade ? (prod.counts[grade.id] || 0) : 0;

  const record = async () => {
    if (!sel.productId) { toast('Select a product'); return; }
    if (!sel.gradeId) { toast('Select a grade'); return; }
    setBusy(true);
    try {
      await api.post('/api/sales', { product_id: sel.productId, grade_id: sel.gradeId, qty: sel.qty });
      setSel({ productId: '', gradeId: '', qty: 1 });
      await load();
      toast('Sale recorded');
    } catch (err) { toast(err.message); }
    finally { setBusy(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this sale and return units to stock?')) return;
    try {
      await api.del(`/api/sales/${id}`);
      await load();
      toast('Sale removed — stock restored');
    } catch (err) { toast(err.message); }
  };

  // group by day
  const groups = {};
  for (const s of sales) {
    const key = new Date(s.createdAt).toDateString();
    (groups[key] = groups[key] || []).push(s);
  }
  const dayLabel = key => {
    const today = new Date().toDateString();
    const yest = new Date(Date.now() - 864e5).toDateString();
    if (key === today) return 'Today';
    if (key === yest) return 'Yesterday';
    return new Date(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Sales</div>
          <div className="page-sub">Recording a sale updates stock automatically</div>
        </div>
      </div>
      <div className="card sale-form">
        <div className="form-grid">
          <div className="field full">
            <label>Product</label>
            <div className="select-wrap">
              <select value={sel.productId}
                onChange={e => setSel({ productId: e.target.value, gradeId: '', qty: 1 })}>
                <option value="">Select product…</option>
                {products.filter(p => p.total > 0).map(p => (
                  <option key={p.id} value={p.id}>{p.displayName} — {p.total} in stock</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field full">
            <label>Grade</label>
            <div className="seg">
              {grades.map(g => {
                const c = prod ? (prod.counts[g.id] || 0) : 0;
                return (
                  <button key={g.id}
                    className={`seg-btn ${sel.gradeId === g.id ? 'selected' : ''}`}
                    disabled={!prod || c === 0}
                    onClick={() => setSel(s => ({ ...s, gradeId: g.id }))}>
                    {g.name}{c > 0 ? ` · ${c}` : ''}
                  </button>
                );
              })}
            </div>
            {prod && grade && <div className="avail-note">{avail} available in {grade.name}</div>}
          </div>
          <div className="field">
            <label>Quantity</label>
            <input type="number" min="1" max={avail || undefined} inputMode="numeric" value={sel.qty}
              onChange={e => setSel(s => ({ ...s, qty: Math.max(1, parseInt(e.target.value) || 1) }))}
              onFocus={e => e.target.select()} />
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={record}>Record sale</button>
          </div>
        </div>
      </div>
      {Object.keys(groups).length ? Object.entries(groups).map(([key, list]) => (
        <div className="day-group" key={key}>
          <div className="day-label">{dayLabel(key)} · {list.reduce((n, s) => n + s.qty, 0)} units</div>
          {list.map(s => (
            <div className="sale-item" key={s.id}>
              <span className="sale-qty">×{s.qty}</span>
              <div className="sale-info">
                <div className="sale-what">
                  {s.productName}{' '}
                  <span className={`badge ${gradeClassByName(grades, s.gradeName)}`}>{s.gradeName}</span>
                </div>
                <div className="sale-meta">
                  {new Date(s.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  {s.username && ` · ${s.username}`}
                </div>
              </div>
              <button className="sale-del" aria-label="Delete sale" onClick={() => remove(s.id)}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )) : (
        <div className="empty">
          <b>No sales yet</b>
          <p>Record your first sale above — stock will update on its own.</p>
        </div>
      )}
    </>
  );
}
