import { useEffect, useState } from 'react';
import { api, getStickyAdd } from '../api';
import { Icon, Modal, gradeClass, useToast } from '../ui';

function ProductModal({ product, grades, onClose, onSaved }) {
  const isNew = !product;
  const toast = useToast();
  const [model, setModel] = useState(product?.model || '');
  const [storage, setStorage] = useState(product?.storage || '');
  const [counts, setCounts] = useState(() =>
    Object.fromEntries(grades.map(g => [g.id, product?.counts[g.id] || 0])));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!model.trim()) { toast('Model name is required'); return; }
    setBusy(true);
    try {
      if (isNew) {
        await api.post('/api/products', { model, storage, counts });
        toast('Product added');
      } else {
        await api.patch(`/api/products/${product.id}`, { model, storage });
        for (const g of grades) {
          if ((product.counts[g.id] || 0) !== (counts[g.id] || 0)) {
            await api.post(`/api/products/${product.id}/set`, { grade_id: g.id, qty: counts[g.id] || 0 });
          }
        }
        toast('Saved');
      }
      onSaved();
    } catch (err) { toast(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete ${product.displayName}? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/products/${product.id}`);
      toast('Product deleted');
      onSaved();
    } catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'Add product' : 'Edit product'} onClose={onClose}>
      <div className="form-grid">
        <div className="field full">
          <label>Model</label>
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. 16 PM" />
        </div>
        <div className="field full">
          <label>Storage <span style={{ textTransform: 'none', fontWeight: 500, color: 'var(--ink-3)' }}>(optional)</span></label>
          <input value={storage} onChange={e => setStorage(e.target.value)} placeholder="e.g. 256" />
        </div>
        {grades.map(g => (
          <div className="field" key={g.id}>
            <label>{g.name} count</label>
            <input type="number" min="0" inputMode="numeric" value={counts[g.id]}
              onChange={e => setCounts(c => ({ ...c, [g.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
              onFocus={e => e.target.select()} />
          </div>
        ))}
      </div>
      <div className="modal-actions">
        {!isNew && <button className="btn btn-danger" disabled={busy} onClick={remove}>Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{isNew ? 'Add' : 'Save'}</button>
      </div>
    </Modal>
  );
}

export default function Stock({ onReorder }) {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [grades, setGrades] = useState([]);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined=closed, null=new, obj=edit

  const load = async () => {
    try {
      const [p, g] = await Promise.all([api.get('/api/products'), api.get('/api/grades')]);
      setProducts(p); setGrades(g);
    } catch (err) { toast(err.message); }
  };
  useEffect(() => { load(); }, []);

  const adjust = async (pid, gid, d) => {
    try {
      const updated = await api.post(`/api/products/${pid}/adjust`, { grade_id: gid, change: d });
      setProducts(ps => ps.map(p => (p.id === pid ? updated : p)));
    } catch (err) { toast(err.message); }
  };

  if (!products) return <div className="loading">Loading…</div>;

  const q = search.trim().toLowerCase();
  const items = products.filter(p => !q || p.displayName.toLowerCase().includes(q));
  const totalUnits = products.reduce((n, p) => n + p.total, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Stock</div>
          <div className="page-sub">Tap + / − to adjust counts</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onReorder}><Icon name="grip" /> Reorder</button>
          <button className={`btn btn-primary ${getStickyAdd() ? 'add-fab' : ''}`} onClick={() => setEditing(null)} aria-label="Add product">
            <Icon name="plus" /> <span className="add-fab-label">Add product</span>
          </button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><b>{totalUnits}</b><span>Units in stock</span></div>
        <div className="stat"><b>{products.length}</b><span>Products</span></div>
        <div className="stat"><b>{grades.length}</b><span>Grades</span></div>
      </div>
      <div className="search">
        <Icon name="search" />
        <input placeholder="Search model…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="stock-list">
        {items.length ? items.map(p => (
          <div className="product" key={p.id}>
            <div className="product-top">
              <div className="product-name">
                {p.model}{p.storage && <span className="storage">{p.storage}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="product-total">{p.total} unit{p.total === 1 ? '' : 's'}</div>
                <button className="edit-dot" aria-label="Edit" onClick={() => setEditing(p)}><Icon name="dots" /></button>
              </div>
            </div>
            <div className="grade-rows">
              {grades.map(g => {
                const c = p.counts[g.id] || 0;
                if (c === 0 && !showAll) return null;
                return (
                  <div className="grade-row" key={g.id}>
                    <span className="grade-label"><span className={`badge ${gradeClass(grades, g.id)}`}>{g.name}</span></span>
                    <span className={`grade-count ${c === 0 ? 'zero' : ''}`}>{c}</span>
                    <div className="stepper">
                      <button className="step-btn" aria-label="Decrease" onClick={() => adjust(p.id, g.id, -1)}>−</button>
                      <button className="step-btn" aria-label="Increase" onClick={() => adjust(p.id, g.id, 1)}>+</button>
                    </div>
                  </div>
                );
              })}
              {p.total === 0 && !showAll && <div className="row-sub">Out of stock — open edit to add units</div>}
            </div>
          </div>
        )) : (
          <div className="empty">
            <b>No products found</b>
            <p>{q ? 'Try a different search.' : 'Add your first product to get started.'}</p>
          </div>
        )}
      </div>
      <div className="toggle-row" style={{ maxWidth: 340 }}>
        <span>Show empty grades on cards</span>
        <span className="switch">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /><i></i>
        </span>
      </div>
      {editing !== undefined && (
        <ProductModal product={editing} grades={grades}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); load(); }} />
      )}
    </>
  );
}
