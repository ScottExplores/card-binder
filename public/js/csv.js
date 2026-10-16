// CSV helpers: generic export, Moxfield collection export, ManaBox import.
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = []; } else f += ch;
  }
  row.push(f); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export const toCSVText = rows => rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
const finishWord = f => f === 'foil' ? 'foil' : f === 'etched' ? 'etched' : '';

export function exportCSV(entries) {
  const rows = [['Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity', 'Quantity', 'Scryfall ID', 'Price USD', 'Total USD']];
  for (const e of entries) rows.push([e.name, e.set.toUpperCase(), e.set_name, e.cn, e.finish === 'nonfoil' ? 'normal' : e.finish, e.rarity, e.qty, e.id, e.price ?? '', e.price != null ? (e.price * e.qty).toFixed(2) : '']);
  return toCSVText(rows);
}
export function exportMoxfield(entries) {
  const rows = [['Count', 'Tradelist Count', 'Name', 'Edition', 'Condition', 'Language', 'Foil', 'Tags', 'Last Modified', 'Collector Number', 'Alter', 'Proxy', 'Purchase Price']];
  for (const e of entries) rows.push([e.qty, 0, e.name, e.set.toLowerCase(), 'Near Mint', 'English', finishWord(e.finish), '', '', e.cn, 'False', 'False', '']);
  return toCSVText(rows);
}
// Returns {items:[{print, finish, qty}], missing:[rowText]}
export function importManaBox(text, db) {
  const rows = parseCSV(text); if (!rows.length) return { items: [], missing: [] };
  const H = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iName = col('name', 'card name'), iSet = col('set code', 'edition', 'set'), iCn = col('collector number', 'card number', 'number'),
    iFoil = col('foil', 'printing', 'finish'), iQty = col('quantity', 'count', 'qty'), iSid = col('scryfall id', 'scryfall_id');
  const items = [], missing = [];
  for (const r of rows.slice(1)) {
    const name = iName >= 0 ? r[iName]?.trim() : '';
    let p = iSid >= 0 && r[iSid] ? db.byId.get(r[iSid].trim()) : null;
    if (!p && iSet >= 0 && iCn >= 0) p = db.bySetCn.get((r[iSet] || '').trim().toLowerCase() + '/' + (r[iCn] || '').trim());
    if (!p && name) { const l = db.byName.get(name) || [...db.byName.entries()].find(([k]) => k.split(' // ')[0] === name)?.[1]; if (l) p = (iSet >= 0 && l.find(x => x.set === (r[iSet] || '').trim().toLowerCase())) || l[l.length - 1]; }
    if (!p) { missing.push(r.join(',')); continue; }
    const fv = iFoil >= 0 ? (r[iFoil] || '').trim().toLowerCase() : '';
    const finish = fv === 'foil' || fv === 'true' || fv === 'yes' ? 'foil' : fv === 'etched' ? 'etched' : 'nonfoil';
    items.push({ print: p, finish, qty: Math.max(1, parseInt(iQty >= 0 ? r[iQty] : '1', 10) || 1) });
  }
  return { items, missing };
}
