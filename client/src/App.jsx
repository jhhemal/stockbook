import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { Icon, Loading, ToastProvider } from './ui';
import Orders from './views/Orders';
import Stock from './views/Stock';
import Sales from './views/Sales';
import Report from './views/Report';
import Settings from './views/Settings';
import Reorder from './views/Reorder';

const TABS = [
  { key: 'orders', label: 'Orders' },
  { key: 'stock', label: 'Stock' },
  { key: 'sales', label: 'Sales' },
  { key: 'report', label: 'Report' },
  { key: 'settings', label: 'Settings' },
];

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!username.trim() || !password) { setError('Enter username and password'); return; }
    setBusy(true);
    try {
      const data = await api.post('/api/auth/login', { username, password });
      setToken(data.access_token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const onKey = e => { if (e.key === 'Enter') submit(); };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand" style={{ justifyContent: 'center', paddingBottom: 20 }}>
          <div className="brand-mark">S</div>
          <div className="brand-name">StockBook</div>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={onKey}
            autoComplete="username" placeholder="Username" />
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={onKey}
            autoComplete="current-password" placeholder="Password" />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>Sign in</button>
      </div>
      <div className="credit">Developed by hashtrik.</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('orders');

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('sb:unauthorized', onUnauthorized);
    (async () => {
      if (getToken()) {
        try { setUser(await api.get('/api/auth/me')); }
        catch { /* token invalid — show login */ }
      }
      setBooting(false);
    })();
    return () => window.removeEventListener('sb:unauthorized', onUnauthorized);
  }, []);

  const logout = () => { setToken(null); setUser(null); };

  if (booting) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;

  const views = {
    orders: <Orders me={user} />,
    stock: <Stock onReorder={() => setView('reorder')} />,
    sales: <Sales />,
    report: <Report />,
    settings: <Settings me={user} />,
    reorder: <Reorder onBack={() => setView('stock')} />,
  };
  const activeTab = view === 'reorder' ? 'stock' : view;

  return (
    <>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">S</div>
            <div className="brand-name">StockBook</div>
          </div>
          {TABS.map(t => (
            <button key={t.key} className={`nav-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => setView(t.key)}>
              <Icon name={t.key} /> {t.label}
            </button>
          ))}
          <div className="sidebar-foot">
            <div className="account">
              <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
              <div className="account-id">
                <div className="account-name">{user.username}</div>
                <div className="account-role">{user.role}</div>
              </div>
              <button className="signout-btn" onClick={logout} title="Sign out" aria-label="Sign out">
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </aside>
        <main className={`main ${view === 'orders' ? 'main-wide' : ''}`}>
          <div className="mobile-head">
            <div className="brand">
              <div className="brand-mark">S</div>
              <div className="brand-name">StockBook</div>
            </div>
            <button className="signout-btn" onClick={logout} title="Sign out" aria-label="Sign out">
              <Icon name="logout" />
            </button>
          </div>
          {/* key forces a fresh mount (and data load) when switching tabs */}
          <div key={view}>{views[view]}</div>
          {view === 'settings' && <div className="credit credit-inline">Developed by hashtrik.</div>}
        </main>
      </div>
      {/* mobile hides this and shows the inline one under Settings instead —
          the tabbar already owns the bottom of the screen */}
      <div className="credit credit-fixed">Developed by hashtrik.</div>
      <nav className="tabbar">
        {TABS.map(t => (
          <button key={t.key} className={`tab-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => setView(t.key)}>
            <span className="tab-ic"><Icon name={t.key} /></span>{t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
