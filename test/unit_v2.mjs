// Unit tests for v2 modules (deck check, filters, deck lists, sell exports): node test/unit_v2.mjs
import assert from 'assert'; import fs from 'fs';
globalThis.fetch = async u => ({ json: async () => JSON.parse(fs.readFileSync('public/' + String(u).replace('./', ''))) });
const { loadDB } = await import('../public/js/carddb.js'); const { loadMeta, info } = await import('../public/js/meta.js');
const { checkDeck, pairOK } = await import('../public/js/deckcheck.js');
const { applyFilters, DEFAULT_F, sortEntries, unitPrice, activeCount } = await import('../public/js/filters.js');
const { parseList, deckText } = await import('../public/js/decks.js');
const { listPrice, ebayTitle, exportSellTCG, exportEbay, parseCSV } = await import('../public/js/csv.js');
const db = await loadDB(); await loadMeta(db);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const kinds = r => r.issues.map(i => i.kind);
const basics = k => Array.from({ length: k }, () => ({ name: 'Forest', qty: 1 }))[0] && [{ name: 'Forest', qty: k }];

await t('commander: exact 100 legal deck is ok', () => { const r = checkDeck({ format: 'commander', commanders: ['Omnath, Locus of Mana'], cards: [{ name: 'Llanowar Elves', qty: 1 }, ...basics(98)] }, info); assert.equal(r.total, 100); assert(r.ok, JSON.stringify(r.issues)); assert.equal(r.ci, 'G'); });
await t('commander: over/under count message', () => { const a = checkDeck({ format: 'commander', commanders: ['Omnath, Locus of Mana'], cards: basics(97) }, info); assert(a.issues[0].msg.includes('2 short')); const b = checkDeck({ format: 'commander', commanders: ['Omnath, Locus of Mana'], cards: basics(102) }, info); assert(b.issues.some(i => i.msg.includes('3 over'))); });
await t('commander: banned, color identity, singleton, no commander', () => {
  const r = checkDeck({ format: 'commander', commanders: ['Omnath, Locus of Mana'], cards: [{ name: 'Channel', qty: 1 }, { name: 'Lightning Bolt', qty: 1 }, { name: 'Sol Ring', qty: 2 }, ...basics(95)] }, info);
  const k = kinds(r); assert(k.includes('banned') && k.includes('color') && k.includes('singleton')); assert(r.issues.find(i => i.kind === 'color').name === 'Lightning Bolt');
  assert(kinds(checkDeck({ format: 'commander', commanders: [], cards: basics(100) }, info)).includes('cmdcount')); });
await t('commander: "any number" cards and basics are not duplicates', () => { const r = checkDeck({ format: 'commander', commanders: ['Marrow-Gnawer'], cards: [{ name: 'Relentless Rats', qty: 30 }, { name: 'Swamp', qty: 69 }] }, info); assert(r.ok, JSON.stringify(r.issues)); });
await t('commander: 2026 unbans + Lutri only banned as companion', () => {
  for (const n of ['Lutri, the Spellchaser', 'Coalition Victory', 'Braids, Cabal Minion', 'Biorhythm']) assert.equal(info(n).legal[0], 'l', n);
  const r = checkDeck({ format: 'commander', commanders: ['Omnath, Locus of Mana'], companion: 'Lutri, the Spellchaser', cards: basics(99) }, info); assert(kinds(r).includes('banned')); });
await t('commander: partner pairs', () => { assert(pairOK(info('Thrasios, Triton Hero'), info('Tymna the Weaver'))); assert(!pairOK(info('Omnath, Locus of Mana'), info('Tymna the Weaver')));
  assert(kinds(checkDeck({ format: 'commander', commanders: ['Omnath, Locus of Mana', 'Tymna the Weaver'], cards: basics(98) }, info)).includes('cmdpair')); });
await t('modern/standard/pauper/vintage rules', () => {
  const m = checkDeck({ format: 'modern', cards: [{ name: 'Lightning Bolt', qty: 5 }, { name: 'Sol Ring', qty: 1 }, { name: 'Mountain', qty: 50 }] }, info); assert(kinds(m).includes('singleton') && kinds(m).includes('notlegal') && kinds(m).includes('size'));
  const v = checkDeck({ format: 'vintage', cards: [{ name: 'Sol Ring', qty: 2 }, { name: 'Island', qty: 58 }] }, info); assert(kinds(v).includes('restricted'));
  const p = checkDeck({ format: 'pauper', cards: [{ name: 'Lightning Bolt', qty: 4 }, { name: 'Mountain', qty: 56 }] }, info); assert(p.ok, JSON.stringify(p.issues));
  const s = checkDeck({ format: 'standard', cards: [{ name: 'Black Lotus', qty: 1 }, { name: 'Island', qty: 59 }] }, info); assert(kinds(s).includes('notlegal')); });
await t('deck stats curve', () => { const r = checkDeck({ format: 'modern', cards: [{ name: 'Lightning Bolt', qty: 4 }, { name: 'Mountain', qty: 20 }] }, info); assert.equal(r.stats.curve[1], 4); assert.equal(r.stats.lands, 20); });

const P = n => db.byName.get(n)[0];
const E = (n, o = {}) => { const p = P(n); return { name: n, set: p.set, set_name: p.set_name, cn: p.cn, rarity: p.rarity, finish: 'nonfoil', qty: 1, price: 10, cond: 'NM', binder: 'Unsorted', added: Date.now(), ...o }; };
const L = [E('Lightning Bolt', { price: 2 }), E('Counterspell', { price: 1, binder: 'Trade' }), E('Sol Ring', { price: 6, finish: 'foil', cond: 'LP', batch: 7 }), E('Llanowar Elves', { price: 0.3, pile: 'bulk' }), E('Thrasios, Triton Hero', { price: 8 })];
const FI = { commander: 0, standard: 1, modern: 2, pioneer: 3, legacy: 4, vintage: 5, pauper: 6 };
const F = o => ({ ...DEFAULT_F(), ...o }); const names = l => l.map(e => e.name).sort();
await t('filters: color, identity, type, cmc', () => {
  assert.deepEqual(names(applyFilters(L, F({ colors: ['R'] }), info)), ['Lightning Bolt']);
  assert.deepEqual(names(applyFilters(L, F({ colors: ['C'] }), info)), ['Sol Ring']);
  assert.deepEqual(names(applyFilters(L, F({ colors: ['M'] }), info)), ['Thrasios, Triton Hero']);
  assert.deepEqual(names(applyFilters(L, F({ ci: ['G', 'U'] }), info)), ['Counterspell', 'Llanowar Elves', 'Sol Ring', 'Thrasios, Triton Hero']);
  assert.deepEqual(names(applyFilters(L, F({ types: ['Creature'] }), info)), ['Llanowar Elves', 'Thrasios, Triton Hero']);
  assert.deepEqual(names(applyFilters(L, F({ cmc: [1] }), info)), ['Lightning Bolt', 'Llanowar Elves', 'Sol Ring']); });
await t('filters: legality, price (condition-adjusted), foil, binder, pile, last batch, $5+, search', () => {
  assert(!names(applyFilters(L, F({ legal: 'commander' }), info, { fmtIdx: FI })).includes('Nope'));
  assert.deepEqual(names(applyFilters(L, F({ legal: 'pauper' }), info, { fmtIdx: FI })), ['Counterspell', 'Lightning Bolt', 'Llanowar Elves']);
  assert.equal(unitPrice(L[2]), 6 * 0.85); assert.deepEqual(names(applyFilters(L, F({ over5: true }), info)), ['Sol Ring', 'Thrasios, Triton Hero']);
  assert.deepEqual(names(applyFilters(L, F({ pmin: '1', pmax: '3' }), info)), ['Counterspell', 'Lightning Bolt']);
  assert.deepEqual(names(applyFilters(L, F({ foil: 'foil' }), info)), ['Sol Ring']);
  assert.deepEqual(names(applyFilters(L, F({ binder: 'Trade' }), info)), ['Counterspell']);
  assert.deepEqual(names(applyFilters(L, F({ pile: 'bulk' }), info)), ['Llanowar Elves']);
  assert.deepEqual(names(applyFilters(L, F({ last: true }), info, { lastBatch: 7 })), ['Sol Ring']);
  assert.deepEqual(names(applyFilters(L, F({ q: 'thras' }), info)), ['Thrasios, Triton Hero']);
  assert.equal(activeCount(F({ colors: ['R'], over5: true, q: 'x' })), 2); });
await t('sorts', () => { assert.equal(sortEntries(L.slice(), 'name', info)[0].name, 'Counterspell'); assert.equal(sortEntries(L.slice(), 'value', info)[0].name, 'Thrasios, Triton Hero'); assert.equal(sortEntries(L.slice(), 'cmc', info).at(-1).name, 'Thrasios, Triton Hero'); });

await t('parseList: arena/moxfield lines, sections, set+number, foil, missing', () => {
  const { items, missing } = parseList('Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring (C21) 263\n4x Lightning Bolt\n1 Counterspell *F*\n10 forest\n1 Not A Real Card\n// note');
  assert.equal(items.length, 5); assert.deepEqual(missing, ['Not A Real Card']); assert.equal(items[0].section, 'commander');
  assert.equal(items[1].print.set, 'c21'); assert.equal(items[2].qty, 4); assert.equal(items[3].finish, 'foil'); assert.equal(items[4].print.name, 'Forest'); });
await t('deckText: arena / archidekt / plain', () => {
  const a = P('Atraxa, Praetors\' Voice'), s = db.bySetCn.get('c21/263');
  const d = { commanders: [{ id: a.id, name: a.name }], cards: [{ id: s.id, name: s.name, finish: 'foil', qty: 1 }] };
  const ar = deckText(d, 'arena'); assert(ar.startsWith('Commander\n1 Atraxa') && ar.includes('\n\nDeck\n1 Sol Ring (C21) 263 *F*'));
  assert(deckText(d, 'archidekt').includes('[Commander]')); assert.equal(deckText(d, 'plain').split('\n').filter(Boolean).at(-1), '1 Sol Ring'); });

await t('sell exports: price rule, condition, eBay titles, CSV shape', () => {
  assert.equal(listPrice({ price: 10, cond: 'NM' }, 10), '9.00'); assert.equal(listPrice({ price: 10, cond: 'LP' }, 0), '8.50'); assert.equal(listPrice({ price: 0.05 }, 0), '0.25'); assert.equal(listPrice({ price: null }), '');
  const s = { ...E('Sol Ring'), set_name: 'Commander 2021', cn: '263', finish: 'foil', cond: 'LP' };
  assert.equal(ebayTitle(s), 'Sol Ring Commander 2021 #263 Foil MTG LP');
  const long = { ...s, name: 'Asmoranomardicadaistinaculdacar', set_name: 'Modern Horizons 2 Extremely Long Set Name For Testing Purposes', set: 'mh2' };
  assert(ebayTitle(long).length <= 80 && ebayTitle(long).includes('MH2'));
  const tcg = parseCSV(exportSellTCG([s], 10)); assert.equal(tcg.length, 2); assert.equal(tcg[1][5], 'Lightly Played Foil'); assert.equal(tcg[1][9], (10 * 0.85 * 0.9).toFixed(2));
  const eb = parseCSV(exportEbay([s], 0, () => 'https://x/y.jpg')); assert.equal(eb[1][0], 'Draft'); assert.equal(eb[1][2], ebayTitle(s)); assert.equal(eb[1][4], '400011'); assert.equal(eb[1][11], 'https://x/y.jpg'); assert.equal(eb[0].length, eb[1].length); });
console.log(`\n${n} v2 unit tests passed`);
