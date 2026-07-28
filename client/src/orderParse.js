/* Parses pasted WhatsApp-style order notes. Quantity can show up as a
 * prefix ("2-13 pro 128"), a suffix ("14 x2" / "14PM 256 1x"), or a count in
 * parens ("iPhone 13 Pro 256gb (3)"). Lines with no recognizable quantity
 * marker (headers, "Total 16 pcs" footers, "*banner*" text) are skipped
 * rather than turned into a bogus item. A header line = client name,
 * optionally ending in a known grade that applies to every line below —
 * only checked when the first line isn't itself an item.
 */
const STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512, 1024]);

const COLOR_WORDS = new Set([
  'pink', 'black', 'white', 'gold', 'silver', 'blue', 'red', 'green', 'purple',
  'gray', 'grey', 'rose', 'yellow', 'orange', 'titanium', 'midnight',
  'starlight', 'graphite', 'coral', 'lavender', 'teal',
]);

const IGNORED_WORDS = new Set(['iphone', 'apple']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(s) {
  return s.split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* Strip emoji (✅❌🔋 etc.) so they don't break end-of-line quantity matches. */
function stripEmoji(s) {
  return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/[\uFE0F\u200D]/g, '');
}

/* Merge a bare "128" + "gb"/"tb" pair of tokens into one "128gb" token. */
function mergeStorageUnit(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i < tokens.length - 1 && /^\d{2,4}$/.test(tokens[i]) && /^(gb|tb)$/i.test(tokens[i + 1])) {
      out.push(tokens[i] + tokens[i + 1].toLowerCase());
      i++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
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

/* Find a quantity marker in a line: leading "N-", trailing "xN", trailing
 * "Nx", or a "(N)" count (anything after the parens becomes a note, e.g.
 * "(1) not black"). Returns null if the line has no quantity marker at all. */
function extractQty(line) {
  let m = line.match(/^(\d+)\s*[-–]\s*(.+)$/);
  if (m) return { qty: parseInt(m[1], 10), body: m[2], trailingNote: '' };

  m = line.match(/^(.+?)\s*[x×]\s*(\d+)\s*$/i);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: '' };

  m = line.match(/^(.+?)\s*(\d+)\s*[x×]\s*$/i);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: '' };

  m = line.match(/^(.+?)\s*\((\d+)\)\s*(.*)$/);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: m[3].trim() };

  return null;
}

/* @param grades - [{name}] from the API, used to recognize a header grade suffix */
export function parseOrderText(text, grades) {
  const rawLines = String(text || '').split('\n').map(l => stripEmoji(l).trim()).filter(Boolean);
  if (!rawLines.length) return { clientName: '', gradeName: '', items: [] };

  let clientName = '';
  let gradeName = '';
  let itemLines = rawLines;

  if (!extractQty(rawLines[0])) {
    const header = rawLines[0];
    clientName = header;
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
    itemLines = rawLines.slice(1);
  }

  const items = [];
  for (const line of itemLines) {
    const parsed = extractQty(line);
    if (!parsed) continue; // no quantity marker — header/footer/banner text, not an item
    let { qty, body, trailingNote } = parsed;
    let note = trailingNote ? capitalize(trailingNote) : '';

    // free-text aside in parens, e.g. "4-12 128 gb (I have 2)" — only when
    // parens weren't already consumed as the quantity marker above
    const paren = body.match(/\(([^)]*)\)/);
    if (paren) {
      const asideText = paren[1].trim();
      body = (body.slice(0, paren.index) + body.slice(paren.index + paren[0].length)).trim();
      if (asideText) note = note ? `${note}, ${asideText}` : asideText;
    }

    body = body.replace(/(\d)(pm)\b/gi, '$1 $2'); // "14PM" -> "14 PM"
    let tokens = body.split(/\s+/).filter(Boolean).filter(t => !IGNORED_WORDS.has(t.toLowerCase()));
    if (!tokens.length) continue;

    const colorIdx = tokens.findIndex(t => COLOR_WORDS.has(t.toLowerCase()));
    if (colorIdx !== -1) {
      const color = titleCase(tokens[colorIdx]);
      note = note ? `${note}, ${color}` : color;
      tokens = [...tokens.slice(0, colorIdx), ...tokens.slice(colorIdx + 1)];
    }

    tokens = mergeStorageUnit(tokens);
    const { storage, rest } = extractStorage(tokens);
    if (!rest.length) continue;
    const model = titleCase(rest.join(' ')).replace(/\bPm\b/g, 'PM');
    items.push({ model, storage, qty, note });
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
