import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon, Loading, useToast } from '../ui';

export default function Reorder({ onBack }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const dragIdxRef = useRef(null);

  useEffect(() => {
    api.get('/api/products').then(setItems).catch(err => toast(err.message));
  }, []);

  const persist = async list => {
    setSaving(true);
    try {
      const updated = await api.post('/api/products/reorder', { order: list.map(p => p.id) });
      setItems(updated);
    } catch (err) { toast(err.message); }
    finally { setSaving(false); }
  };

  const onPointerDown = idx => e => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragIdxRef.current = idx;
    setDragIdx(idx);

    const onMove = ev => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest('[data-ridx]');
      if (!row) return;
      const overIdx = Number(row.dataset.ridx);
      const from = dragIdxRef.current;
      if (overIdx === from) return;
      dragIdxRef.current = overIdx;
      setDragIdx(overIdx);
      setItems(cur => {
        const next = cur.slice();
        const [moved] = next.splice(from, 1);
        next.splice(overIdx, 0, moved);
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragIdxRef.current = null;
      setDragIdx(null);
      setItems(cur => { persist(cur); return cur; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}>
            <Icon name="back" /> Back
          </button>
          <div className="page-title">Reorder products</div>
          <div className="page-sub">Drag by the handle to set the order shown on Stock and in reports{saving ? ' — saving…' : ''}</div>
        </div>
      </div>

      {items === null ? <Loading /> : (
        <div className="reorder-list">
          {items.map((p, idx) => (
            <div className={`reorder-row ${dragIdx === idx ? 'dragging' : ''}`} key={p.id} data-ridx={idx}>
              <span className="reorder-handle" onPointerDown={onPointerDown(idx)}><Icon name="grip" /></span>
              <div className="row-main">
                {p.model}{p.storage && <span className="storage"> {p.storage}</span>}
              </div>
              <span className="product-total">{p.total} unit{p.total === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
