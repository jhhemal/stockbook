/* Parses pasted WhatsApp-style order notes, e.g.:
 *   Tecnofly #2 A-
 *   14 x2
 *   13 pro Max x2
 *   15 128gb x1
 * Header line = client name, optionally ending in a known grade that applies
 * to every line below. Each item line = free-text model/storage + "x<qty>".
 */
const STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512, 1024]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(s) {
  return s.split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/* Pull a storage token (e.g. "128gb", "256", "1tb") out of a model's words.
 * Bare numbers only count as storage if they're a common size and not the
 * very first word (which is almost always the phone generation, e.g. "15"). */
function extractStorage(tokens) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const m = tokens[i].match(/^(\d{2,4})(gb|tb)$/i);
    if (m) {
      let val = parseInt(m[1], 10);
      if (m[2].toLowerCase() === 'tb') val *= 1024;
      return { storage: String(val), rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)] };
    }
  }
  for (let i = tokens.length - 1; i >= 1; i--) {
    if (/^\d+$/.test(tokens[i]) && STORAGE_SIZES.has(parseInt(tokens[i], 10))) {
      return { storage: tokens[i], rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)] };
    }
  }
  return { storage: '', rest: tokens };
}

/* @param grades - [{name}] from the API, used to recognize a header grade suffix */
export function parseOrderText(text, grades) {
  const rawLines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!rawLines.length) return { clientName: '', gradeName: '', items: [] };

  const header = rawLines[0];
  let clientName = header;
  let gradeName = '';
  const sortedGrades = [...grades].sort((a, b) => b.name.length - a.name.length);
  for (const g of sortedGrades) {
    const re = new RegExp('(?:^|\\s)' + escapeRegex(g.name) + '$', 'i');
    const m = header.match(re);
    if (m && header.slice(0, m.index).trim()) {
      clientName = header.slice(0, m.index).trim();
      gradeName = g.name;
      break;
    }
  }

  const items = [];
  for (const line of rawLines.slice(1)) {
    const m = line.match(/^(.+?)\s*[x×]\s*(\d+)\s*$/i);
    const body = m ? m[1] : line;
    const qty = m ? parseInt(m[2], 10) : 1;
    const tokens = body.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const { storage, rest } = extractStorage(tokens);
    if (!rest.length) continue;
    items.push({ model: titleCase(rest.join(' ')), storage, qty });
  }

  return { clientName, gradeName, items };
}

/* Best-effort match against existing products, tolerant of the "Pro Max" vs
 * "PM" abbreviation this shop's catalog uses. */
function normKey(model, storage) {
  const m = String(model || '').toLowerCase().replace(/\bpro max\b/g, 'pm').replace(/\s+/g, ' ').trim();
  const s = String(storage || '').replace(/[^0-9]/g, '');
  return m + '|' + s;
}

export function matchProduct(products, model, storage) {
  const key = normKey(model, storage);
  return products.find(p => normKey(p.model, p.storage) === key) || null;
}
