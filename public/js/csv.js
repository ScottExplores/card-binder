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
  const iName = col('name', 'card name', 'card'), iSet = col('set code', 'edition code', 'set id', 'edition', 'set'), iCn = col('collector number', 'card number', 'collector #', 'number'),
    iFoil = col('foil', 'finish', 'printing'), iQty = col('quantity', 'count', 'qty'), iSid = col('scryfall id', 'scryfall_id');
  const items = [], missing = [];
  for (const r of rows.slice(1)) {
    const name = iName >= 0 ? r[iName]?.trim() : '';
    let p = iSid >= 0 && r[iSid] ? db.byId.get(r[iSid].trim()) : null;
    if (!p && iSet >= 0 && iCn >= 0) p = db.bySetCn.get((r[iSet] || '').trim().toLowerCase() + '/' + (r[iCn] || '').trim());
    if (!p && name) { const l = db.byName.get(name) || [...db.byName.entries()].find(([k]) => k.split(' // ')[0] === name)?.[1]; if (l) { const sv = iSet >= 0 ? (r[iSet] || '').trim().toLowerCase() : ''; const cn = iCn >= 0 ? (r[iCn] || '').trim() : ''; p = (sv && l.find(x => (x.set === sv || x.set_name.toLowerCase() === sv) && (!cn || x.cn === cn))) || (sv && l.find(x => x.set === sv || x.set_name.toLowerCase() === sv)) || l[l.length - 1]; } }
    if (!p) { missing.push(r.join(',')); continue; }
    const fv = iFoil >= 0 ? (r[iFoil] || '').trim().toLowerCase() : '';
    const finish = fv.includes('etched') ? 'etched' : fv === 'foil' || fv === 'true' || fv === 'yes' || fv === 'premium' ? 'foil' : 'nonfoil';
    items.push({ print: p, finish, qty: Math.max(1, parseInt(iQty >= 0 ? r[iQty] : '1', 10) || 1) });
  }
  return { items, missing };
}

// ---------- exports for other sites (each in that site's own import format)
const front = n => n.split(' // ')[0];
const U = s => (s || '').toUpperCase();
export function exportGoldfish(entries) { // MTGGoldfish collection CSV
  const rows = [['Card', 'Set ID', 'Set Name', 'Quantity', 'Foil', 'Variation', 'Collector Number', 'Scryfall ID']];
  for (const e of entries) rows.push([front(e.name), U(e.set), e.set_name, e.qty, e.finish === 'foil' ? 'FOIL' : e.finish === 'etched' ? 'FOIL_ETCHED' : 'REGULAR', '', e.cn, e.id]);
  return toCSVText(rows);
}
export function exportArchidekt(entries) {
  const rows = [['Quantity', 'Name', 'Finish', 'Condition', 'Language', 'Edition Name', 'Edition Code', 'Collector Number', 'Scryfall ID']];
  for (const e of entries) rows.push([e.qty, e.name, e.finish === 'foil' ? 'Foil' : e.finish === 'etched' ? 'Etched' : 'Normal', 'NM', 'EN', e.set_name, e.set.toLowerCase(), e.cn, e.id]);
  return toCSVText(rows);
}
export function exportDeckbox(entries) {
  const rows = [['Count', 'Tradelist Count', 'Name', 'Edition', 'Card Number', 'Condition', 'Language', 'Foil', 'Signed', 'Artist Proof', 'Altered Art', 'Misprint', 'Promo', 'Textless', 'My Price']];
  for (const e of entries) rows.push([e.qty, 0, e.name, e.set_name, e.cn, 'Near Mint', 'English', e.finish !== 'nonfoil' ? 'foil' : '', '', '', '', '', '', '', '']);
  return toCSVText(rows);
}
export function exportManaBoxCSV(entries) {
  const rows = [['Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity', 'Quantity', 'ManaBox ID', 'Scryfall ID', 'Purchase price', 'Misprint', 'Altered', 'Condition', 'Language', 'Purchase price currency']];
  for (const e of entries) rows.push([e.name, U(e.set), e.set_name, e.cn, e.finish === 'nonfoil' ? 'normal' : e.finish, e.rarity || '', e.qty, '', e.id, '', 'false', 'false', 'near_mint', 'en', 'USD']);
  return toCSVText(rows);
}
// TCGplayer Mass Entry: "1 Lightning Bolt [SLD] 84" (finish is picked on TCGplayer)
export function exportTCGplayer(entries) { return entries.map(e => `${e.qty} ${front(e.name)} [${U(e.set)}] ${e.cn}`).join('\n') + '\n'; }
// Plain decklist (Moxfield/Archidekt/Arena style): "1 Lightning Bolt (M10) 146 *F*"
export function exportText(entries) { return entries.map(e => `${e.qty} ${e.name} (${U(e.set)}) ${e.cn}${e.finish === 'foil' ? ' *F*' : e.finish === 'etched' ? ' *E*' : ''}`).join('\n') + '\n'; }
