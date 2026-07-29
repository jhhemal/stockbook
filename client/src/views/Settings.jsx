import { useEffect, useState } from 'react';
import { api, getStickyAdd, setStickyAdd } from '../api';
import { Icon, Modal, gradeClass, gradeClassByName, useConfirm, useToast } from '../ui';

function GradeModal({ grade, onClose, onSaved }) {
  const isNew = !grade;
  const toast = useToast();
  const [name, setName] = useState(grade?.name || '');
  const save = async () => {
    if (!name.trim()) { toast('Name is required'); return; }
    try {
      if (isNew) await api.post('/api/grades', { name });
      else await api.patch(`/api/grades/${grade.id}`, { name });
      toast(isNew ? 'Grade added' : 'Saved');
      onSaved();
    } catch (err) { toast(err.message); }
  };
  return (
    <Modal title={isNew ? 'Add grade' : 'Rename grade'} onClose={onClose}>
      <div className="field">
        <label>Grade name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. AB, Genuine" />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? 'Add' : 'Save'}</button>
      </div>
    </Modal>
  );
}

export const PARTNER_PALETTE = ['#F59E0B', '#3B82F6', '#22C55E', '#EF4444', '#A855F7', '#EC4899', '#14B8A6', '#EAB308'];
const PALETTE_NAMES = {
  '#F59E0B': 'Amber', '#3B82F6': 'Blue', '#22C55E': 'Green', '#EF4444': 'Red',
  '#A855F7': 'Purple', '#EC4899': 'Pink', '#14B8A6': 'Teal', '#EAB308': 'Yellow',
};

function PartnerModal({ partner, onClose, onSaved }) {
  const isNew = !partner;
  const toast = useToast();
  const [name, setName] = useState(partner?.name || '');
  const [color, setColor] = useState(partner?.color || PARTNER_PALETTE[0]);
  const save = async () => {
    if (!name.trim()) { toast('Name is required'); return; }
    try {
      if (isNew) await api.post('/api/partners', { name, color });
      else await api.patch(`/api/partners/${partner.id}`, { name, color });
      toast(isNew ? 'Partner added' : 'Saved');
      onSaved();
    } catch (err) { toast(err.message); }
  };
  return (
    <Modal title={isNew ? 'Add partner' : `Edit ${partner.name}`} onClose={onClose}>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Partner name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Noori" />
      </div>
      <div className="field">
        <label>Note color</label>
        <div className="swatches">
          {PARTNER_PALETTE.map(c => (
            <button key={c} type="button" className={`swatch ${color === c ? 'selected' : ''}`}
              style={{ background: c }} aria-label={PALETTE_NAMES[c] || c} aria-pressed={color === c}
              onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? 'Add' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function UserModal({ user, me, onClose, onSaved }) {
  const isNew = !user;
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role || 'staff');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const save = async () => {
    try {
      if (isNew) {
        if (!username.trim() || !password) { toast('Username and password are required'); return; }
        await api.post('/api/users', { username, password, role });
        toast('User added');
      } else {
        const body = { role };
        if (password) body.password = password;
        if (user.id !== me.id) body.isActive = isActive;
        await api.patch(`/api/users/${user.id}`, body);
        toast('Saved');
      }
      onSaved();
    } catch (err) { toast(err.message); }
  };
  return (
    <Modal title={isNew ? 'Add user' : `Edit ${user.username}`} onClose={onClose}>
      <div className="form-grid">
        {isNew && (
          <div className="field full">
            <label>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" placeholder="Username" />
          </div>
        )}
        <div className="field full">
          <label>{isNew ? 'Password' : 'New password (leave blank to keep)'}</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="Password" />
        </div>
        <div className="field">
          <label>Role</label>
          <div className="select-wrap">
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        {!isNew && user.id !== me.id && (
          <div className="field">
            <label>Status</label>
            <div className="select-wrap">
              <select value={isActive ? '1' : '0'} onChange={e => setIsActive(e.target.value === '1')}>
                <option value="1">Active</option>
                <option value="0">Disabled</option>
              </select>
            </div>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? 'Add' : 'Save'}</button>
      </div>
    </Modal>
  );
}

export default function Settings({ me }) {
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = me.role === 'admin';
  const [grades, setGrades] = useState([]);
  const [users, setUsers] = useState([]);
  const [movements, setMovements] = useState([]);
  const [partners, setPartners] = useState([]);
  const [gradeModal, setGradeModal] = useState(undefined);
  const [userModal, setUserModal] = useState(undefined);
  const [partnerModal, setPartnerModal] = useState(undefined);
  const [stickyAdd, setStickyAddState] = useState(getStickyAdd());

  const toggleStickyAdd = () => {
    const next = !stickyAdd;
    setStickyAddState(next);
    setStickyAdd(next);
  };

  const load = async () => {
    try {
      const [g, m, pt] = await Promise.all([
        api.get('/api/grades'), api.get('/api/reports/movements?limit=40'), api.get('/api/partners'),
      ]);
      setGrades(g); setMovements(m); setPartners(pt);
      if (isAdmin) setUsers(await api.get('/api/users'));
    } catch (err) { toast(err.message); }
  };
  useEffect(() => { load(); }, []);

  const deleteGrade = async g => {
    if (!await confirm({ title: 'Delete grade?', message: `Grade '${g.name}' will be removed.` })) return;
    try { await api.del(`/api/grades/${g.id}`); load(); toast('Grade deleted'); }
    catch (err) { toast(err.message); }
  };
  const deletePartner = async p => {
    if (!await confirm({ title: 'Delete partner?', message: `Partner '${p.name}' will be removed.` })) return;
    try { await api.del(`/api/partners/${p.id}`); load(); toast('Partner deleted'); }
    catch (err) { toast(err.message); }
  };
  const deleteUser = async u => {
    if (!await confirm({ title: 'Delete user?', message: `User '${u.username}' will lose access immediately.` })) return;
    try { await api.del(`/api/users/${u.id}`); load(); toast('User deleted'); }
    catch (err) { toast(err.message); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Signed in as <b>{me.username}</b> ({me.role})</div>
        </div>
      </div>

      <div className="settings-section">
        <div className="side-label" style={{ marginBottom: 10 }}>Preferences</div>
        <div className="card" style={{ padding: 15 }}>
          <div className="toggle-row" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
            <div>
              Sticky "Add product" button
              <div className="row-sub">Keeps it in view on mobile so you don't have to scroll to the top</div>
            </div>
            <span className="switch">
              <input type="checkbox" checked={stickyAdd} onChange={toggleStickyAdd} /><i></i>
            </span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <div className="side-label" style={{ margin: 0 }}>Grades</div>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setGradeModal(null)}>
              <Icon name="plus" /> Add grade
            </button>
          )}
        </div>
        <div className="card">
          <div className="row-list">
            {grades.map(g => (
              <div className="row-item" key={g.id}>
                <span className={`badge ${gradeClass(grades, g.id)}`}>{g.name}</span>
                <div className="row-main"></div>
                {isAdmin && (
                  <div className="row-actions">
                    <button className="icon-btn" aria-label="Rename" onClick={() => setGradeModal(g)}><Icon name="edit" /></button>
                    <button className="icon-btn danger" aria-label="Delete" onClick={() => deleteGrade(g)}><Icon name="trash" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <div className="side-label" style={{ margin: 0 }}>Partners</div>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPartnerModal(null)}>
              <Icon name="plus" /> Add partner
            </button>
          )}
        </div>
        <div className="card">
          <div className="row-list">
            {partners.length ? partners.map(p => (
              <div className="row-item" key={p.id}>
                <span className="pdot" style={{ background: p.color }}></span>
                <div className="row-main">{p.name}</div>
                {isAdmin && (
                  <div className="row-actions">
                    <button className="icon-btn" aria-label="Edit" onClick={() => setPartnerModal(p)}><Icon name="edit" /></button>
                    <button className="icon-btn danger" aria-label="Delete" onClick={() => deletePartner(p)}><Icon name="trash" /></button>
                  </div>
                )}
              </div>
            )) : <div className="empty" style={{ padding: 20 }}><p>No partners yet.</p></div>}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="settings-section">
          <div className="page-head" style={{ marginBottom: 10 }}>
            <div className="side-label" style={{ margin: 0 }}>Team</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setUserModal(null)}>
              <Icon name="plus" /> Add user
            </button>
          </div>
          <div className="card">
            <div className="row-list">
              {users.map(u => (
                <div className="row-item" key={u.id}>
                  <div className="row-main">
                    {u.username}
                    <div className="row-sub">{u.isActive ? 'Active' : 'Disabled'}</div>
                  </div>
                  <span className={`pill ${u.role === 'admin' ? 'admin' : ''}`}>{u.role}</span>
                  {!u.isActive && <span className="pill off">off</span>}
                  <div className="row-actions">
                    <button className="icon-btn" aria-label="Edit" onClick={() => setUserModal(u)}><Icon name="edit" /></button>
                    {u.id !== me.id && (
                      <button className="icon-btn danger" aria-label="Delete" onClick={() => deleteUser(u)}><Icon name="trash" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="side-label" style={{ marginBottom: 10 }}>Recent stock movements</div>
        <div className="card">
          <div className="row-list">
            {movements.length ? movements.map(m => (
              <div className="mv-item" key={m.id}>
                <span className={`mv-change ${m.change > 0 ? 'pos' : 'neg'}`}>{m.change > 0 ? '+' : ''}{m.change}</span>
                <span>
                  {m.productName}{' '}
                  <span className={`badge ${gradeClassByName(grades, m.gradeName)}`}>{m.gradeName}</span>
                </span>
                <span className="mv-meta">
                  {m.reason.replace('_', ' ')}{m.username && ` · ${m.username}`}<br />
                  {new Date(m.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            )) : <div className="empty" style={{ padding: 20 }}><p>No movements yet.</p></div>}
          </div>
        </div>
      </div>

      {gradeModal !== undefined && (
        <GradeModal grade={gradeModal} onClose={() => setGradeModal(undefined)}
          onSaved={() => { setGradeModal(undefined); load(); }} />
      )}
      {userModal !== undefined && (
        <UserModal user={userModal} me={me} onClose={() => setUserModal(undefined)}
          onSaved={() => { setUserModal(undefined); load(); }} />
      )}
      {partnerModal !== undefined && (
        <PartnerModal partner={partnerModal} onClose={() => setPartnerModal(undefined)}
          onSaved={() => { setPartnerModal(undefined); load(); }} />
      )}
    </>
  );
}
