/* Parses pasted WhatsApp-style order notes. Quantity can show up as a
 * prefix ("2-13 pro 128", "15x 15 pro max 256", "X4 14 pro max 256",
 * "20) 13 pro 128", "40 13 pro 128"), a suffix ("14 x2" / "14PM 256 1x" /
 * "13 pro 128 - 30"), floating mid-line ("16 x5 pink" — everything after
 * the "xN" becomes the note), a count in parens ("iPhone 13 Pro 256gb
 * (3)"), or a bare trailing number. Lines with no recognizable quantity at
 * all (footers like "Total 16 pcs", "*banner*" text) are skipped rather
 * than turned into a bogus item. A line with no storage size named picks
 * the smallest size that model is actually carried in (falling back to
 * 128 if the model isn't in the catalog at all). A Spanish "A y B"
 * ("13 pro Max 128 y 256") offers two sizes at once and becomes two
 * items sharing the same quantity. If the first
 * line isn't itself an item, it's checked for a trailing grade (e.g.
 * "A-") that then applies to every line below — client name is never
 * guessed from it, since plenty of messages don't include one. A trailing
 * grade/condition shorthand like "AB 90+" (grade code + battery floor),
 * or a "grade A and clean A-" phrase, is pulled into the line's note
 * instead of polluting the model name. A model+storage line with no
 * quantity of its own pairs with a "qty- note" line right after it (e.g.
 * "14 128gb" / "5- mix"), taking that quantity and folding the note text in.
 */
const STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512, 1024]);

/* Lines often leave the size off entirely ("2-13 pro"). 128 is far and away
 * the most common size ordered, so it's assumed rather than left blank —
 * a blank storage matches no product at all and stalls the row. */
const DEFAULT_STORAGE = '128';

const COLOR_WORDS = new Set([
  'pink', 'black', 'white', 'gold', 'silver', 'blue', 'red', 'green', 'purple',
  'gray', 'grey', 'rose', 'yellow', 'orange', 'titanium', 'midnight',
  'starlight', 'graphite', 'coral', 'lavender', 'teal',
]);

// Some partners write in Spanish — filler/connector words like "de" ("of")
// sneak into a line's body and end up baked into the model name (e.g. "13
// De Pro Max"), which then fails to match the real "13 Pro Max" product and
// creates a duplicate. Stripped the same way "iPhone"/"Apple" already are.
const IGNORED_WORDS = new Set([
  'iphone', 'apple',
  'de', 'del', 'con', 'y', 'el', 'la', 'los', 'las', 'un', 'una', 'para',
]);

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
    if (i < tokens.length - 1 && /^\d{1,4}$/.test(tokens[i]) && /^(gb|tb)$/i.test(tokens[i + 1])) {
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
    const m = tokens[i].match(/^(\d{1,4})(gb|tb)$/i); // 1 digit matters for "1tb"
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
 * "Nx", a "(N)" count (anything after the parens becomes a note, e.g. "(1)
 * not black"), or — failing all of those — a bare number that isn't the
 * first word (the phone generation) and isn't a recognized storage size,
 * which is taken to be the quantity. Returns null if nothing qualifies. */
function extractQty(line) {
  let m = line.match(/^(\d+)\s*[-–]\s*(.+)$/);
  if (m) return { qty: parseInt(m[1], 10), body: m[2], trailingNote: '' };

  // Leading "20) 13 pro 128" — outline-style numbering, a bare ")" with no
  // matching "(" (the real parens-count format below requires both).
  m = line.match(/^(\d+)\)\s*(.+)$/);
  if (m) return { qty: parseInt(m[1], 10), body: m[2], trailingNote: '' };

  // Trailing "13 pro 128 - 30" — dash then quantity at the very end. Without
  // this the bare-number fallback below still finds the 30, but leaves the
  // dash stuck onto the body ("13 pro 128 -"), corrupting the model name.
  m = line.match(/^(.+?)\s*[-–]\s*(\d+)\s*$/);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: '' };

  // Leading "15x 15 pro max 256" — a bare "Nx" (with a space before the
  // model) is a quantity prefix, not the trailing "body xN" suffix below.
  m = line.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (m) return { qty: parseInt(m[1], 10), body: m[2], trailingNote: '' };

  // Leading "X4 14 pro max 256" — reversed "xN" prefix.
  m = line.match(/^[x×]\s*(\d+)\s+(.+)$/i);
  if (m) return { qty: parseInt(m[1], 10), body: m[2], trailingNote: '' };

  m = line.match(/^(.+?)\s*[x×]\s*(\d+)\s*$/i);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: '' };

  m = line.match(/^(.+?)\s*(\d+)\s*[x×]\s*$/i);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: '' };

  // Floating "16 x5 pink" — an "xN" quantity token sitting in the middle of
  // the line (not at the very start or end), with trailing words after it
  // becoming the note. The trailing/leading patterns above only catch "xN"
  // when it's anchored to one end of the line.
  m = line.match(/^(.+?)\s+[x×](\d+)(?:\s+(.+))?$/i);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: m[3] || '' };

  m = line.match(/^(.+?)\s*\((\d+)\)\s*(.*)$/);
  if (m) return { qty: parseInt(m[2], 10), body: m[1], trailingNote: m[3].trim() };

  // Leading "40 13 pro 128" — a bare quantity with no separator at all,
  // recognizable because the model right after it starts with its own
  // number (the phone generation). Without this, the fallback below skips
  // the first token on the assumption it's always the generation, and
  // picks the generation number itself as the quantity instead. Doesn't
  // fire when the second number is a recognized storage size ("13 128
  // 10", "16 128 4") — there the first number is the phone generation and
  // the real quantity is the trailing one, which the fallback below
  // already finds correctly; treating "13" as the quantity here would
  // instead turn "128 10" into a bogus model name.
  m = line.match(/^(\d+)\s+(\d+)(.*)$/);
  if (m && !STORAGE_SIZES.has(parseInt(m[2], 10))) {
    return { qty: parseInt(m[1], 10), body: m[2] + m[3], trailingNote: '' };
  }

  const tokens = line.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 1; i--) {
    if (!/^\d+$/.test(tokens[i])) continue;
    const n = parseInt(tokens[i], 10);
    if (STORAGE_SIZES.has(n)) continue;
    const body = [...tokens.slice(0, i), ...tokens.slice(i + 1)].join(' ');
    return { qty: n, body, trailingNote: '' };
  }

  return null;
}

/* Trailing grade/condition shorthand like "AB 90+" (grade code + battery
 * floor) is never part of the model name — pull the battery number out
 * always, and the grade code too when it's a real configured grade (case-
 * insensitive), so the caller can promote a grade shared by every line to
 * the order-level grade picker instead of repeating it in every note.
 * @param gradeSet - Map of lowercased grade name -> real-cased grade name. */
function extractCondition(tokens, gradeSet) {
  const last = tokens[tokens.length - 1];
  const pm = last && last.match(/^(\d{2,3})\+$/);
  if (!pm) return { rest: tokens, gradeCode: '', looseCode: '', batteryPct: null };
  const batteryPct = parseInt(pm[1], 10);
  const prev = tokens[tokens.length - 2];
  if (prev && /^[A-Za-z]{1,4}$/.test(prev) && gradeSet.has(prev.toLowerCase())) {
    return { rest: tokens.slice(0, -2), gradeCode: gradeSet.get(prev.toLowerCase()), looseCode: '', batteryPct };
  }
  // Unrecognized ALL-CAPS shorthand (not a configured grade) — still not
  // part of the model name, but not confident enough to promote as a grade.
  if (prev && /^[A-Z]{1,3}$/.test(prev)) {
    return { rest: tokens.slice(0, -2), gradeCode: '', looseCode: prev, batteryPct };
  }
  return { rest: tokens.slice(0, -1), gradeCode: '', looseCode: '', batteryPct };
}

/* A line can offer two sizes at once via Spanish "y" ("and"), e.g.
 * "13 pro Max 128 y 256" meaning both variants are available. Splits that
 * into two body strings, one per size, with the "A y B" segment replaced
 * by just A or just B — everything else in the line stays put. Returns
 * null when there's no such pattern (the normal, single-size case). */
function splitDualStorage(body) {
  const m = body.match(/\b(\d{2,4})\s*(?:gb)?\s+y\s+(\d{2,4})\s*(?:gb)?\b/i);
  if (!m) return null;
  const before = body.slice(0, m.index);
  const after = body.slice(m.index + m[0].length);
  return [`${before}${m[1]}${after}`.replace(/\s+/g, ' ').trim(), `${before}${m[2]}${after}`.replace(/\s+/g, ' ').trim()];
}

/* @param grades - [{name}] from the API, used to recognize a header grade suffix.
 * @param products - [{model,storage}] from the API, used to pick the
 * smallest carried size for a line that names no storage of its own.
 * Client name is never auto-filled — messages don't always include one, and
 * guessing wrong is worse than leaving it blank for the user to type. */
export function parseOrderText(text, grades, products = []) {
  const rawLines = String(text || '').split('\n').map(l => stripEmoji(l).trim()).filter(Boolean);
  if (!rawLines.length) return { clientName: '', gradeName: '', batteryMin: null, items: [] };

  let gradeName = '';
  let itemLines = rawLines;

  // A model+storage line with no quantity of its own is only a stray header
  // when the very next line isn't its paired "qty- note" continuation (see
  // below) — otherwise the first phone in a "14 128gb / 5- mix" style list
  // would get mistaken for a grade header and silently dropped.
  const pairsWithNext = (line, next) => {
    const nextParsed = next && extractQty(next);
    return !!nextParsed && !/\d/.test(nextParsed.body);
  };

  if (!extractQty(rawLines[0]) && !pairsWithNext(rawLines[0], rawLines[1])) {
    const header = rawLines[0];
    const sortedGrades = [...grades].sort((a, b) => b.name.length - a.name.length);
    for (const g of sortedGrades) {
      const re = new RegExp('(?:^|\\s)' + escapeRegex(g.name) + '$', 'i');
      if (re.test(header)) { gradeName = g.name; break; }
    }
    itemLines = rawLines.slice(1);
  }

  const gradeSet = new Map(grades.map(g => [g.name.toLowerCase(), g.name]));

  const raw = [];
  for (let i = 0; i < itemLines.length; i++) {
    const line = itemLines[i];
    let parsed = extractQty(line);
    if (!parsed) {
      // No quantity on this line — check whether it's a headerless
      // model+storage line whose quantity/note live on the next line
      // instead, e.g. "14 128gb" followed by "5- mix". The next line only
      // counts as that pairing (rather than an unrelated standalone item)
      // when its own body has no digits, i.e. it reads as a plain note.
      const next = itemLines[i + 1];
      if (pairsWithNext(line, next)) {
        const nextParsed = extractQty(next);
        parsed = { qty: nextParsed.qty, body: line, trailingNote: nextParsed.body };
        i++; // consumed as this item's quantity/note
      } else {
        continue; // header/footer/banner text, not an item
      }
    }
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

    // "grade A and clean A-" -> note "Grade: A, A-", stripped from the model text
    const gradePhrase = body.match(/\bgrade\s+([A-Za-z][+-]?)\s+(?:and\s+)?clean\s+([A-Za-z][+-]?)(?=\s|$)/i);
    if (gradePhrase) {
      const gnote = `Grade: ${gradePhrase[1].toUpperCase()}, ${gradePhrase[2].toUpperCase()}`;
      body = (body.slice(0, gradePhrase.index) + body.slice(gradePhrase.index + gradePhrase[0].length)).trim();
      note = note ? `${note}, ${gnote}` : gnote;
    }

    // "128 y 256" -> two variants of this same line (same qty/note each);
    // otherwise just the one body, unchanged.
    const bodyVariants = splitDualStorage(body) || [body];
    for (let variant of bodyVariants) {
      variant = variant.replace(/(\d)(pm)\b/gi, '$1 $2'); // "14PM" -> "14 PM"
      let tokens = variant.split(/\s+/).filter(Boolean).filter(t => !IGNORED_WORDS.has(t.toLowerCase()));
      if (!tokens.length) continue;

      let lineNote = note;
      const colorIdx = tokens.findIndex(t => COLOR_WORDS.has(t.toLowerCase()));
      if (colorIdx !== -1) {
        const color = titleCase(tokens[colorIdx]);
        lineNote = lineNote ? `${lineNote}, ${color}` : color;
        tokens = [...tokens.slice(0, colorIdx), ...tokens.slice(colorIdx + 1)];
      }

      tokens = mergeStorageUnit(tokens);
      const { storage, rest: rest0 } = extractStorage(tokens);
      const { rest, gradeCode, looseCode, batteryPct } = extractCondition(rest0, gradeSet);
      if (!rest.length) continue;
      const model = titleCase(rest.join(' ')).replace(/\bPm\b/g, 'PM');
      raw.push({ model, storage: storage || smallestStorageFor(model, products) || DEFAULT_STORAGE, qty, note: lineNote, gradeCode, looseCode, batteryPct });
    }
  }

  // A grade code shared by every line (e.g. "AB" on every row) is promoted
  // to the order-level grade instead of being repeated in each line's note.
  if (!gradeName && raw.length && raw.every(r => r.gradeCode)) {
    const codes = new Set(raw.map(r => r.gradeCode));
    if (codes.size === 1) gradeName = raw[0].gradeCode;
  }
  // Same idea for a battery floor shared by every line — lines disagree in
  // practice more often than grade does, so this only fires when uniform.
  let batteryMin = null;
  if (raw.length && raw.every(r => r.batteryPct != null)) {
    const pcts = new Set(raw.map(r => r.batteryPct));
    if (pcts.size === 1) batteryMin = raw[0].batteryPct;
  }

  const items = raw.map(r => {
    let note = r.note;
    if (r.looseCode) note = note ? `${note}, ${r.looseCode}` : r.looseCode;
    if (r.gradeCode && r.gradeCode !== gradeName) {
      const t = `Grade: ${r.gradeCode}`;
      note = note ? `${note}, ${t}` : t;
    }
    if (r.batteryPct != null && r.batteryPct !== batteryMin) {
      const t = `Battery ${r.batteryPct}%+`;
      note = note ? `${note}, ${t}` : t;
    }
    return { model: r.model, storage: r.storage, qty: r.qty, note };
  });

  return { clientName: '', gradeName, batteryMin, items };
}

/* Best-effort match against existing products, tolerant of the "Pro Max" vs
 * "PM" abbreviation this shop's catalog uses. */
function normModel(model) {
  return String(model || '').toLowerCase().replace(/\bpro max\b/g, 'pm').replace(/\s+/g, ' ').trim();
}
function normKey(model, storage) {
  const s = String(storage || '').replace(/[^0-9]/g, '');
  return normModel(model) + '|' + s;
}

export function matchProduct(products, model, storage) {
  const key = normKey(model, storage);
  return products.find(p => normKey(p.model, p.storage) === key) || null;
}

/* A line with no storage size named at all (e.g. "16 x5 pink") picks the
 * smallest size this model is actually carried in, rather than a hardcoded
 * guess — closer to what's really in stock. Falls back to DEFAULT_STORAGE
 * when the model isn't in the catalog yet (nothing to compare against). */
function smallestStorageFor(model, products) {
  const key = normModel(model);
  let min = null;
  for (const p of products) {
    if (normModel(p.model) !== key) continue;
    const n = parseInt(p.storage, 10);
    if (!isNaN(n) && (min == null || n < min)) min = n;
  }
  return min != null ? String(min) : '';
}

/* Sort key for model+storage that expands "PM" (this shop's Pro Max
 * shorthand) to "Pro Max" first — otherwise "13 PM" sorts ahead of "13 Pro"
 * (M < R) instead of after it. */
export function modelSortKey(model, storage) {
  return `${model} ${storage}`.replace(/\bPM\b/gi, 'Pro Max');
}

/* Storage is stored/matched as a plain number ("1024") so parsing and
 * product lookups stay simple — this only affects what gets displayed. */
export function formatStorage(storage) {
  const n = parseInt(storage, 10);
  if (n && n >= 1024 && n % 1024 === 0) return `${n / 1024}TB`;
  return storage;
}
