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

  const sortByName = () => {
    const sorted = [...items].sort((a, b) =>
      `${a.model} ${a.storage}`.localeCompare(`${b.model} ${b.storage}`, undefined, { numeric: true, sensitivity: 'base' }));
    setItems(sorted);
    persist(sorted);
  };

  // Shared drag-tracking logic keyed on raw client coordinates, driven by
  // either Pointer Events (mouse/pen) or native Touch Events (below). Touch
  // gets its own path rather than relying on PointerEvent's touch support —
  // some mobile browsers/WebViews (e.g. in-app browsers) implement Pointer
  // Events unreliably for drags, while touchmove + preventDefault is the
  // oldest and most universally supported way to suppress page scroll.
  const beginDrag = idx => {
    dragIdxRef.current = idx;
    setDragIdx(idx);
  };
  const moveDragOver = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
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
  const endDrag = () => {
    dragIdxRef.current = null;
    setDragIdx(null);
    setItems(cur => { persist(cur); return cur; });
  };

  const onPointerDown = idx => e => {
    if (e.pointerType === 'touch') return; // handled by onTouchStart instead
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    beginDrag(idx);

    const onMove = ev => moveDragOver(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onTouchStart = idx => e => {
    e.preventDefault();
    beginDrag(idx);

    const onTouchMove = ev => {
      ev.preventDefault();
      const t = ev.touches[0];
      if (t) moveDragOver(t.clientX, t.clientY);
    };
    const onTouchEnd = () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      endDrag();
    };
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
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
        <button className="btn btn-ghost btn-sm" onClick={sortByName} disabled={!items || saving}>Sort by name</button>
      </div>

      {items === null ? <Loading /> : (
        <div className="reorder-list">
          {items.map((p, idx) => (
            <div className={`reorder-row ${dragIdx === idx ? 'dragging' : ''}`} key={p.id} data-ridx={idx}>
              <span className="reorder-handle" onPointerDown={onPointerDown(idx)} onTouchStart={onTouchStart(idx)}><Icon name="grip" /></span>
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
