import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon, Loading, Modal, copyText, useConfirm, useToast } from '../ui';
import { modelSortKey } from '../orderParse';

/* @param entries - [{ productName, qty }]. Shared between the live draft
 * (not saved yet) and a saved session's report, so the two always read
 * identically once the draft becomes history. */
function countReportText(entries, note, dateLabel) {
  const total = entries.reduce((n, e) => n + e.qty, 0);
  const lines = [`Count${dateLabel ? ` — ${dateLabel}` : ''}${note ? ` (${note})` : ''}`, ''];
  if (entries.length) entries.forEach(e => lines.push(`${e.productName} — ${e.qty}`));
  else lines.push('Nothing counted yet');
  lines.push('', `Total: ${total} unit${total === 1 ? '' : 's'}`);
  return lines.join('\n');
}

function formatSessionDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function HistoryModal({ session, onClose, onDeleted }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const text = countReportText(session.lines, session.note, formatSessionDate(session.createdAt));

  const doCopy = async () => {
    const ok = await copyText(text);
    toast(ok ? 'Report copied — paste in WhatsApp' : 'Copy failed — select the text manually');
  };
  const doShare = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');

  const remove = async () => {
    if (!await confirm({ title: 'Delete this count?', message: `The count from ${formatSessionDate(session.createdAt)} will be permanently removed.` })) return;
    setBusy(true);
    try { await api.del(`/api/counts/${session.id}`); toast('Count deleted'); onDeleted(); }
    catch (err) { toast(err.message); setBusy(false); }
  };

  return (
    <Modal title={`Count — ${formatSessionDate(session.createdAt)}`} onClose={onClose}>
      <div className="chat" style={{ marginBottom: 14 }}>
        <div className="bubble"><pre>{text}</pre></div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-danger" disabled={busy} onClick={remove}>Delete</button>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <button className="btn btn-ghost" onClick={doCopy}><Icon name="copy" /></button>
        <button className="btn btn-primary" onClick={doShare}><Icon name="wa" /> WhatsApp</button>
      </div>
    </Modal>
  );
}

export default function Count() {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [counts, setCounts] = useState({}); // productId -> raw input string
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null); // a history session, or null

  const load = async () => {
    try {
      const [p, s] = await Promise.all([api.get('/api/products'), api.get('/api/counts')]);
      setProducts(p); setSessions(s);
    } catch (err) { toast(err.message); }
  };
  useEffect(() => { load(); }, []);

  if (!products) return <Loading />;

  const q = search.trim().toLowerCase();
  const items = products
    .filter(p => !q || p.displayName.toLowerCase().includes(q))
    .sort((a, b) => modelSortKey(a.model, a.storage).localeCompare(modelSortKey(b.model, b.storage), undefined, { numeric: true, sensitivity: 'base' }));

  const setCount = (id, val) => setCounts(c => ({ ...c, [id]: val }));

  const draftEntries = products
    .map(p => ({ productName: p.displayName, qty: parseInt(counts[p.id]) || 0 }))
    .filter(e => e.qty > 0);
  const enteredCount = draftEntries.length;

  const submit = async () => {
    const lines = Object.entries(counts)
      .map(([product_id, qty]) => ({ product_id, qty: parseInt(qty) || 0 }))
      .filter(l => l.qty > 0);
    if (!lines.length) { toast('Enter at least one count'); return; }
    setBusy(true);
    try {
      await api.post('/api/counts', { note, lines });
      toast('Count saved');
      setCounts({});
      setNote('');
      setSearch('');
      load();
    } catch (err) { toast(err.message); }
    finally { setBusy(false); }
  };

  const draftText = countReportText(draftEntries, note, formatSessionDate(new Date().toISOString()));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Count</div>
          <div className="page-sub">A separate manual count, not tied to Stock — enter this week's numbers and send the report</div>
        </div>
      </div>

      <div className="report-wrap">
        <div className="chat">
          <div className="bubble"><pre>{draftText}</pre></div>
        </div>

        <div className="report-side">
          <div className="card">
            <div className="side-label">This count</div>
            <div className="field full" style={{ marginBottom: 10 }}>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional), e.g. Week of Aug 4" />
            </div>
            <div className="search" style={{ marginBottom: 10 }}>
              <Icon name="search" />
              <input placeholder="Search model…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="row-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {items.map(p => (
                <div className="mv-item" key={p.id}>
                  <span>{p.displayName}</span>
                  <input type="number" min="0" inputMode="numeric" className="line-qty" style={{ width: 64 }}
                    value={counts[p.id] || ''} placeholder="0"
                    onChange={e => setCount(p.id, e.target.value)}
                    onFocus={e => e.target.select()} />
                </div>
              ))}
              {!items.length && <div className="row-sub">No products match your search.</div>}
            </div>
          </div>
          <div className="card">
            <div className="report-count">
              <b>{draftEntries.reduce((n, e) => n + e.qty, 0)}</b> units · <b>{enteredCount}</b> products counted
            </div>
            <button className="btn btn-primary btn-block" disabled={busy || !enteredCount} onClick={submit}>
              {busy ? 'Saving…' : 'Save count'}
            </button>
          </div>
        </div>
      </div>

      <div className="side-label" style={{ margin: '24px 0 8px' }}>History</div>
      {sessions.length ? (
        <div className="row-list">
          {sessions.map(s => (
            <button type="button" className="mv-item" key={s.id} style={{ width: '100%', cursor: 'pointer' }} onClick={() => setViewing(s)}>
              <span>{formatSessionDate(s.createdAt)}{s.note && ` · ${s.note}`}</span>
              <span className="mv-meta">{s.totalUnits} unit{s.totalUnits === 1 ? '' : 's'} · {s.lineCount} product{s.lineCount === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty"><b>No counts yet</b><p>Saved counts will show up here so you can re-send them later.</p></div>
      )}

      {viewing && (
        <HistoryModal session={viewing} onClose={() => setViewing(null)}
          onDeleted={() => { setViewing(null); load(); }} />
      )}
    </>
  );
}
