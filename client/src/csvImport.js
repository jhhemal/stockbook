/* Parses purchase CSVs exported from the phone-purchasing app (one row per
 * unit, IMEI-level) into { model, storage, qty } grouped by product —
 * ignoring color, IMEI/SKU/purchase reference, and price/fund columns,
 * none of which this app tracks. */

/* Minimal quoted-CSV reader: handles quoted fields (with embedded commas
 * and "" as an escaped quote) and both \n and \r\n line endings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// iPhone qualifier words that belong in the model name — anything after
// these (before the storage size) is a color, however many words long
// ("Silver", "Deep Blue", "Cosmic Orange" all fall out the same way).
const MODEL_QUALIFIERS = new Set(['pro', 'max', 'plus', 'mini', 'e']);

/* "IPHONE 17 PRO MAX SILVER 256GB NEW" -> { model: "17 Pro Max", storage: "256" } */
export function parseCsvProductName(name) {
  const m = String(name || '').match(/(\d+)\s*GB\b/i);
  if (!m) return null;
  const storage = m[1];
  const tokens = name.slice(0, m.index).trim().split(/\s+/).filter(Boolean)
    .filter(t => !['iphone', 'apple'].includes(t.toLowerCase()));
  if (!tokens.length || !/^\d+$/.test(tokens[0])) return null;

  const modelParts = [tokens[0]];
  let i = 1;
  while (i < tokens.length && MODEL_QUALIFIERS.has(tokens[i].toLowerCase())) {
    modelParts.push(tokens[i]);
    i++;
  }
  const model = modelParts.map((t, idx) => (idx === 0 ? t : t[0].toUpperCase() + t.slice(1).toLowerCase())).join(' ');
  return { model, storage };
}

/* @param rows - output of parseCsv(), header row included.
 * Groups by model+storage, summing "Quantity Purchased" (defaulting to 1
 * per row if that column is missing) — rows whose "Product Name" doesn't
 * parse are counted in `skipped` rather than silently dropped. */
export function aggregateImportRows(rows) {
  if (!rows.length) return { items: [], skipped: 0 };
  const header = rows[0].map(h => h.trim().toLowerCase());
  const nameIdx = header.indexOf('product name');
  const qtyIdx = header.indexOf('quantity purchased');
  if (nameIdx === -1) return { items: [], skipped: Math.max(0, rows.length - 1) };

  const grouped = new Map(); // "model|storage" -> { model, storage, qty }
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length || r.every(c => c.trim() === '')) continue;
    const parsed = parseCsvProductName(r[nameIdx] || '');
    if (!parsed) { skipped++; continue; }
    const qty = qtyIdx !== -1 ? (parseInt(r[qtyIdx], 10) || 1) : 1;
    const key = `${parsed.model}|${parsed.storage}`;
    if (!grouped.has(key)) grouped.set(key, { model: parsed.model, storage: parsed.storage, qty: 0 });
    grouped.get(key).qty += qty;
  }
  return { items: [...grouped.values()], skipped };
}
