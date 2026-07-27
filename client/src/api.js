/* API client — token in localStorage, JSON everywhere. */
const TOKEN_KEY = 'stockbook_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

/* device preference: keep the "Add product" button pinned in view on mobile */
const STICKY_ADD_KEY = 'stockbook_sticky_add';

export function getStickyAdd() {
  try { return localStorage.getItem(STICKY_ADD_KEY) !== '0'; } catch { return true; }
}
export function setStickyAdd(on) {
  try { localStorage.setItem(STICKY_ADD_KEY, on ? '1' : '0'); } catch {}
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('sb:unauthorized'));
    throw new Error('Session expired — please sign in again');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong');
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};
