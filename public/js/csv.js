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
const CONDL = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
export const condLong = c => CONDL[c || 'NM'] || 'Near Mint';
const finishWord = f => f === 'foil' ? 'foil' : f === 'etched' ? 'etched' : '';

export function exportCSV(entries) {
  const rows = [['Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity', 'Quantity', 'Scryfall ID', 'Price USD', 'Total USD']];
  for (const e of entries) rows.push([e.name, e.set.toUpperCase(), e.set_name, e.cn, e.finish === 'nonfoil' ? 'normal' : e.finish, e.rarity, e.qty, e.id, e.price ?? '', e.price != null ? (e.price * e.qty).toFixed(2) : '']);
  return toCSVText(rows);
}
export function exportMoxfield(entries) {
  const rows = [['Count', 'Tradelist Count', 'Name', 'Edition', 'Condition', 'Language', 'Foil', 'Tags', 'Last Modified', 'Collector Number', 'Alter', 'Proxy', 'Purchase Price']];
  for (const e of entries) rows.push([e.qty, 0, e.name, e.set.toLowerCase(), condLong(e.cond), 'English', finishWord(e.finish), '', '', e.cn, 'False', 'False', '']);
  return toCSVText(rows);
}
// Returns {items:[{print, finish, qty}], missing:[rowText]}
export function importManaBox(text, db) {
  const rows = parseCSV(text); if (!rows.length) return { items: [], missing: [] };
  const H = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iName = col('name', 'card name', 'card'), iSet = col('set code', 'edition code', 'set id', 'edition', 'set'), iCn = col('collector number', 'card number', 'collector #', 'number'),
    iFoil = col('foil', 'finish', 'printing'), iQty = col('quantity', 'count', 'qty'), iSid = col('scryfall id', 'scryfall_id'), iCond = col('condition');
  const items = [], missing = [];
  for (const r of rows.slice(1)) {
    const name = iName >= 0 ? r[iName]?.trim() : '';
    let p = iSid >= 0 && r[iSid] ? db.byId.get(r[iSid].trim()) : null;
    if (!p && iSet >= 0 && iCn >= 0) p = db.bySetCn.get((r[iSet] || '').trim().toLowerCase() + '/' + (r[iCn] || '').trim());
    // explicit identifiers must agree: never swap in a different printing silently
    if (p && name && p.name !== name && p.name.split(' // ')[0] !== name) { missing.push(r.join(',')); continue; }
    if (!p && iSid >= 0 && r[iSid]?.trim()) { missing.push(r.join(',')); continue; }
    if (!p && name) { const l = db.byName.get(name) || [...db.byName.entries()].find(([k]) => k.split(' // ')[0] === name)?.[1]; if (l) { const sv = iSet >= 0 ? (r[iSet] || '').trim().toLowerCase() : ''; const cn = iCn >= 0 ? (r[iCn] || '').trim() : ''; p = (sv && l.find(x => (x.set === sv || x.set_name.toLowerCase() === sv) && (!cn || x.cn === cn))) || (sv && !cn && l.find(x => x.set === sv || x.set_name.toLowerCase() === sv)) || (!sv && !cn ? l[l.length - 1] : null); } } // set + number given but not found: reject, don't guess
    if (!p) { missing.push(r.join(',')); continue; }
    const fv = iFoil >= 0 ? (r[iFoil] || '').trim().toLowerCase() : '';
    const finish = fv.includes('etched') ? 'etched' : fv === 'foil' || fv === 'true' || fv === 'yes' || fv === 'premium' ? 'foil' : 'nonfoil';
    const qty = Number(iQty >= 0 ? (r[iQty] || '').trim() || 1 : 1);
    if (!Number.isSafeInteger(qty) || qty < 1 || !(p.fin || 'n').includes({ nonfoil: 'n', foil: 'f', etched: 'e' }[finish])) { missing.push(r.join(',')); continue; }
    const cv = iCond >= 0 ? (r[iCond] || '').trim().toLowerCase().replace(/[_-]/g, ' ') : '';
    const cond = /damag|poor/.test(cv) ? 'DMG' : /heav/.test(cv) ? 'HP' : /moder/.test(cv) ? 'MP' : /light|excellent/.test(cv) ? 'LP' : 'NM';
    items.push({ print: p, finish, qty, cond });
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
  for (const e of entries) rows.push([e.qty, e.name, e.finish === 'foil' ? 'Foil' : e.finish === 'etched' ? 'Etched' : 'Normal', e.cond || 'NM', 'EN', e.set_name, e.set.toLowerCase(), e.cn, e.id]);
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

// ---------- sell lists. rule: list at market price minus pct (e.g. 0, 5, 10), never below min
const CMULT = { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.35 };
export const listPrice = (e, pct = 0, min = 0.25) => e.price == null ? '' : Math.max(min, e.price * (CMULT[e.cond || 'NM'] ?? 1) * (1 - pct / 100)).toFixed(2);
const finWord = f => f === 'foil' ? 'Foil' : f === 'etched' ? 'Etched Foil' : '';
// TCGplayer seller-style list (match on TCGplayer by name/set/number; TCGplayer product IDs aren't in Scryfall's free data)
export function exportSellTCG(entries, pct = 0) {
  const rows = [['Quantity', 'Product Name', 'Set Name', 'Set Code', 'Number', 'Condition', 'Printing', 'Language', 'TCG Market Price', 'My Price']];
  for (const e of entries) rows.push([e.qty, front(e.name), e.set_name, U(e.set), e.cn, condLong(e.cond) + (e.finish !== 'nonfoil' ? ' ' + finWord(e.finish) : ''), e.finish === 'nonfoil' ? 'Normal' : finWord(e.finish), 'English', e.price != null ? e.price.toFixed(2) : '', listPrice(e, pct)]);
  return toCSVText(rows);
}
// eBay title, max 80 chars: <Name> <Set> #<num> <Foil> MTG <Cond>
export function ebayTitle(e) {
  const tail = `#${e.cn}${e.finish !== 'nonfoil' ? ' ' + finWord(e.finish) : ''} MTG ${e.cond || 'NM'}`;
  let t = `${front(e.name)} ${e.set_name} ${tail}`;
  if (t.length > 80) t = `${front(e.name)} ${U(e.set)} ${tail}`;
  return t.slice(0, 80);
}
// eBay Seller Hub bulk upload (File Exchange columns). Category 38292 = MTG Individual Cards. Review drafts in Seller Hub before listing.
export function exportEbay(entries, pct = 0, imgUrl = () => '') {
  const rows = [['*Action(SiteID=US|Country=US|Currency=USD|Version=1193)', '*Category', '*Title', '*ConditionID', 'CD:Card Condition - (ID: 40001)', '*C:Game', 'C:Card Name', 'C:Set', 'C:Card Number', 'C:Finish', 'C:Language', 'PicURL', '*StartPrice', '*Quantity', '*Format', '*Duration', '*Description']];
  const CD = { NM: 400010, LP: 400011, MP: 400012, HP: 400013, DMG: 400013 }; // eBay ungraded card condition descriptors
  for (const e of entries) rows.push(['Draft', 38292, ebayTitle(e), 4000, CD[e.cond || 'NM'], 'Magic: The Gathering', front(e.name), e.set_name, e.cn, e.finish === 'nonfoil' ? 'Regular' : finWord(e.finish), 'English', imgUrl(e), listPrice(e, pct), e.qty, 'FixedPrice', 'GTC', `${front(e.name)} from ${e.set_name} (#${e.cn}), ${condLong(e.cond)}${e.finish !== 'nonfoil' ? ', ' + finWord(e.finish) : ''}. English. Ships in a sleeve and toploader.`]);
  return toCSVText(rows);
}
