import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon, copyText, useToast } from '../ui';

export default function Report() {
  const toast = useToast();
  const [grades, setGrades] = useState([]);
  const [mode, setMode] = useState('stock');       // 'stock' | 'sold'
  const [day, setDay] = useState('today');
  const [gradeIds, setGradeIds] = useState([]);
  const [includeZero, setIncludeZero] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/api/grades').then(setGrades).catch(err => toast(err.message));
  }, []);

  useEffect(() => {
    const gradeNames = grades.filter(g => gradeIds.includes(g.id)).map(g => g.name);
    const gradeParam = gradeNames.length ? `&grades=${encodeURIComponent(gradeNames.join(','))}` : '';
    const url = mode === 'sold'
      ? `/api/reports/sold?day=${day}${gradeParam}`
      : `/api/reports/stock?include_zero=${includeZero}${gradeParam}`;
    api.get(url).then(setData).catch(err => toast(err.message));
  }, [mode, day, gradeIds, includeZero, grades]);

  const toggleChip = id =>
    setGradeIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  const doCopy = async () => {
    const ok = await copyText(data?.text || '');
    toast(ok ? 'Report copied — paste in WhatsApp' : 'Copy failed — select the text manually');
  };
  const doShare = () =>
    window.open('https://wa.me/?text=' + encodeURIComponent(data?.text || ''), '_blank');

  const time = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Report</div>
          <div className="page-sub">Exactly what you'll paste into WhatsApp</div>
        </div>
      </div>
      <div className="report-wrap">
        <div className="chat">
          <div className="bubble">
            <pre>{data ? (data.text || 'Nothing to report.') : 'Loading…'}</pre>
            <div className="bubble-time">{time} <Icon name="check2" /></div>
          </div>
        </div>
        <div className="report-side">
          <div className="card">
            <div className="side-label">What to send</div>
            <div className="seg" style={{ marginBottom: 14 }}>
              <button className={`seg-btn ${mode === 'stock' ? 'selected' : ''}`} onClick={() => setMode('stock')}>Current stock</button>
              <button className={`seg-btn ${mode === 'sold' ? 'selected' : ''}`} onClick={() => setMode('sold')}>
                Sold {day === 'yesterday' ? 'yesterday' : 'today'}
              </button>
            </div>
            {mode === 'sold' && (
              <div className="seg" style={{ marginBottom: 14 }}>
                <button className={`seg-btn ${day === 'today' ? 'selected' : ''}`} onClick={() => setDay('today')}>Today</button>
                <button className={`seg-btn ${day === 'yesterday' ? 'selected' : ''}`} onClick={() => setDay('yesterday')}>Yesterday</button>
              </div>
            )}
            <div className="side-label">Grades <span style={{ textTransform: 'none', fontWeight: 500 }}>(none = all)</span></div>
            <div className="chips">
              {grades.map(g => (
                <button key={g.id}
                  className={`chip ${gradeIds.includes(g.id) ? 'selected' : ''}`}
                  onClick={() => toggleChip(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
            {mode === 'stock' && (
              <div className="toggle-row">
                <span>Include out-of-stock</span>
                <span className="switch">
                  <input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} /><i></i>
                </span>
              </div>
            )}
          </div>
          <div className="card">
            <div className="report-count">
              <b>{data?.total_units ?? 0}</b> units · <b>{data?.line_count ?? 0}</b> lines
            </div>
            <button className="btn btn-primary btn-block" style={{ marginBottom: 9 }} onClick={doCopy}>
              <Icon name="copy" /> Copy report
            </button>
            <button className="btn btn-ghost btn-block" onClick={doShare}>
              <Icon name="wa" /> Open in WhatsApp
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
