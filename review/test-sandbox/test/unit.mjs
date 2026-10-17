// Unit tests: node test/unit.mjs
import assert from 'assert'; import fs from 'fs';
import { parseCSV, exportCSV, exportMoxfield, importManaBox } from '../public/js/csv.js';
import { NameIndex, norm } from '../public/js/match.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const j = JSON.parse(fs.readFileSync('public/data/cards.json'));
const C = Object.fromEntries(j.cols.map((k, i) => [k, i]));
const prints = j.rows.map(r => ({ id: r[C.id], name: j.names[r[C.name]], set: r[C.set], set_name: j.sets[r[C.set]], cn: r[C.cn], fin: r[C.fin], usd: r[C.usd] }));
const db = { byId: new Map(prints.map(p => [p.id, p])), bySetCn: new Map(prints.map(p => [p.set + '/' + p.cn, p])), byName: new Map() };
for (const p of prints) { if (!db.byName.has(p.name)) db.byName.set(p.name, []); db.byName.get(p.name).push(p); }
const idx = new NameIndex(j.names);

t('csv parse quotes/newlines/BOM', () => { const r = parseCSV('\uFEFFa,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n'); assert.deepEqual(r, [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]); });
t('manabox import by scryfall id, set/cn, name; foil; qty; missing', () => {
  const sol = db.byName.get('Sol Ring').find(p => p.set === 'c21');
  const csv = `Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency
Sol Ring,C21,Commander 2021,263,foil,uncommon,3,1,${sol.id},0,false,false,near_mint,en,USD
Necropotence,ICE,Ice Age,154,normal,rare,1,2,,0,false,false,near_mint,en,USD
"Delver of Secrets",ISD,Innistrad,51,normal,common,2,3,,0,false,false,near_mint,en,USD
Bogus Card,XXX,,1,normal,common,1,4,,0,false,false,near_mint,en,USD`;
  const { items, missing } = importManaBox(csv, db);
  assert.equal(items.length, 3); assert.equal(missing.length, 1);
  assert.equal(items[0].print.id, sol.id); assert.equal(items[0].finish, 'foil'); assert.equal(items[0].qty, 3);
  assert.equal(items[1].print.set, 'ice'); assert.equal(items[2].print.name, 'Delver of Secrets // Insectile Aberration');
});
t('exports round-trip through parser', () => {
  const e = [{ name: 'Fire // Ice', set: 'apc', set_name: 'Apocalypse', cn: '128', finish: 'foil', rarity: 'u', qty: 2, id: 'x', price: 1.5 }];
  const a = parseCSV(exportCSV(e)); assert.equal(a[1][0], 'Fire // Ice'); assert.equal(a[1][4], 'foil'); assert.equal(a[1][9], '3.00');
  const m = parseCSV(exportMoxfield(e)); assert.deepEqual(m[0].slice(0, 4), ['Count', 'Tradelist Count', 'Name', 'Edition']); assert.equal(m[1][3], 'apc'); assert.equal(m[1][6], 'foil');
});
t('name matching tolerates OCR noise', () => {
  const cases = [['Tidal Flas', 'Tidal Flats'], ['I Hypnotic Specter              Jd', 'Hypnotic Specter'], ['Giittering Wish', 'Glittering Wish'], ['Aromygzddon            oo', 'Armageddon'], ['Svyclunite Priest', 'Svyelunite Priest'], ['Eowyn, fearless Knight', 'Éowyn, Fearless Knight']];
  for (const [ocr, want] of cases) assert.equal(idx.search(ocr, 1)[0]?.full, want, ocr);
});
t('dfc face names map to full name', () => { assert.equal(idx.search('Insectile Aberration', 1)[0].full, 'Delver of Secrets // Insectile Aberration'); });
t('norm strips accents/punct', () => assert.equal(norm("Lim-Dûl's Vault"), 'limduls vault'));
console.log(`${n} tests passed`);

// round-trip every export format back through the importer
{
  const { exportGoldfish, exportArchidekt, exportDeckbox, exportManaBoxCSV, exportMoxfield, exportTCGplayer, exportText, importManaBox: imp } = await import('../public/js/csv.js');
  const P = [{ id: 'a1', name: 'Lightning Bolt', set: 'lea', set_name: 'Limited Edition Alpha', cn: '161', fin: 'n' }, { id: 'b2', name: 'Delver of Secrets // Insectile Aberration', set: 'isd', set_name: 'Innistrad', cn: '51', fin: 'nf' }];
  const fake = { byId: new Map(P.map(p => [p.id, p])), bySetCn: new Map(P.map(p => [p.set + '/' + p.cn, p])), byName: new Map(P.map(p => [p.name, [p]])) };
  const E = [{ ...P[0], qty: 3, finish: 'nonfoil', rarity: 'common' }, { ...P[1], qty: 1, finish: 'foil', rarity: 'common' }];
  for (const [n, f] of Object.entries({ exportGoldfish, exportArchidekt, exportDeckbox, exportManaBoxCSV, exportMoxfield })) {
    const r = imp(f(E), fake); const ok = r.items.length === 2 && r.items[0].qty === 3 && r.items[1].finish === 'foil' && r.items[1].print.id === 'b2';
    if (!ok) { console.error('FAIL', n, JSON.stringify(r)); process.exit(1); } console.log('ok round-trip', n);
  }
  if (exportTCGplayer(E) !== '3 Lightning Bolt [LEA] 161\n1 Delver of Secrets [ISD] 51\n') { console.error('FAIL tcg', exportTCGplayer(E)); process.exit(1); }
  if (!exportText(E).includes('1 Delver of Secrets // Insectile Aberration (ISD) 51 *F*')) { console.error('FAIL text'); process.exit(1); }
  console.log('ok tcgplayer + text');
}
