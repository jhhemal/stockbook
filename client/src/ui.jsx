import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ---------- icons ---------- */
const paths = {
  orders: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/><path d="M8 12h8M8 16h5"/>',
  bolt: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
  stock: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  sales: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  report: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8.5v7M8.5 12h7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  check2: '<path d="m2 12 4 4 8-9"/><path d="m11 15 1 1 8-9"/>',
  grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
};

export function Icon({ name, size, className }) {
  if (name === 'wa') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={size ? { width: size, height: size } : undefined}>
        <path d="M17.5 14.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.1 3.2 5.1 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35M12.05 21.79h-.01a9.8 9.8 0 0 1-4.98-1.36l-.36-.21-3.7.97.99-3.61-.24-.37a9.77 9.77 0 0 1-1.5-5.21c0-5.4 4.4-9.79 9.81-9.79a9.74 9.74 0 0 1 6.93 2.87 9.73 9.73 0 0 1 2.87 6.93c0 5.4-4.4 9.79-9.8 9.79m8.34-18.13A11.7 11.7 0 0 0 12.05.21C5.55.21.26 5.5.26 12c0 2.08.54 4.1 1.57 5.89L.16 24l6.25-1.64a11.78 11.78 0 0 0 5.63 1.43h.01c6.5 0 11.79-5.29 11.79-11.79 0-3.15-1.23-6.11-3.46-8.34" />
      </svg>
    );
  }
  if (name === 'grip') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={size ? { width: size, height: size } : undefined}
        dangerouslySetInnerHTML={{ __html: paths[name] }} />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}
      style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: paths[name] || '' }}
    />
  );
}

/* ---------- shared loading state (gear spinner + label) ---------- */
export function Loading({ label = 'Loading', style }) {
  return (
    <div className="loading" style={style}>
      <Icon name="settings" className="loading-gear" />
      <span>{label}</span>
    </div>
  );
}

/* ---------- custom select (native <select> popups can't be themed — this
 * fully-styled dropdown replaces them) ---------- */
export function Select({ value, onChange, options, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, (openUp ? spaceAbove : spaceBelow) - 16);
    setPos(openUp
      ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width, maxHeight }
      : { top: r.bottom + 4, left: r.left, width: r.width, maxHeight });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const current = options.find(o => String(o.value) === String(value));

  return (
    <div className="csel">
      <button type="button" ref={btnRef} className="csel-trigger" onClick={() => (open ? setOpen(false) : openMenu())}>
        <span className={current ? '' : 'csel-placeholder'}>{current ? current.label : placeholder}</span>
      </button>
      {open && pos && createPortal(
        <div className="csel-menu" ref={menuRef} style={pos}>
          {options.map(o => (
            <button key={o.value} type="button"
              className={`csel-opt ${String(o.value) === String(value) ? 'selected' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ---------- grade badge colors (stable by position in grade list) ---------- */
export function gradeClass(grades, gradeId) {
  const idx = grades.findIndex(g => g.id === gradeId);
  return 'gc-' + (idx >= 0 ? idx % 8 : 0);
}
export function gradeClassByName(grades, name) {
  const g = grades.find(g => g.name === name);
  return g ? gradeClass(grades, g.id) : 'gc-0';
}

/* ---------- toast ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const timer = useRef();
  const toast = useCallback(m => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------- modal ---------- */
export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={e => { if (e.target.classList.contains('overlay')) onClose(); }}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

/* ---------- clipboard ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally { ta.remove(); }
  }
}
