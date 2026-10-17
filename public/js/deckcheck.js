// Deck legality check. Pure: give it a deck and a lookup for card info (see meta.js; fields type, cmc, colors, ci, legal, cmdr, limit, pair).
// deck: { format, commanders: [name], cards: [{ name, qty }], companion? }  (cards excludes the commanders)
// Issue kinds: size, banned, notlegal, restricted, color, singleton, cmdcount, cmdpair, badcmd, companion, unknown
const FIDX = { commander: 0, standard: 1, modern: 2, pioneer: 3, legacy: 4, vintage: 5, pauper: 6 };
export const BANNED_AS_COMPANION = new Set(['Lutri, the Spellchaser']); // Commander, Feb 9 2026: legal in the deck, banned as a companion
const PERM = /\b(Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/;
const tokens = i => (i?.pair || '').split('|').filter(Boolean);
export function pairOK(a, b) {
  if (!a || !b || a.name === b.name) return false;
  const A = tokens(a), B = tokens(b);
  if (A.includes('P') && B.includes('P')) return true;
  for (const t of A) if (t.startsWith('P:') && B.includes(t)) return true; // Partner—Friends forever, Partner—Survivors, ...
  if (A.includes('W:' + b.name) && B.includes('W:' + a.name)) return true;
  if ((A.includes('B') && B.includes('G')) || (B.includes('B') && A.includes('G'))) return true;
  if ((A.includes('D') && B.includes('T')) || (B.includes('D') && A.includes('T'))) return true;
  return false;
}
export function checkDeck(deck, info) {
  const fmt = deck.format || 'commander'; const fi = FIDX[fmt] ?? 0; const isCmd = fmt === 'commander';
  const issues = []; const add = (kind, name, msg) => { if (!issues.some(i => i.kind === kind && i.name === name)) issues.push({ kind, name, msg }); };
  const cmdrs = isCmd ? (deck.commanders || []) : [];
  const counts = new Map(); for (const c of deck.cards) counts.set(c.name, (counts.get(c.name) || 0) + c.qty);
  for (const n of cmdrs) counts.set(n, (counts.get(n) || 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const legal = n => info(n)?.legal?.[fi] ?? '?';
  const basic = n => /\bBasic\b/.test(info(n)?.type || '');
  const comp = isCmd ? deck.companion || null : null;
  const all = [...counts.keys(), ...(comp ? [comp] : [])];
  if (isCmd ? total !== 100 : total < 60) add('size', null, isCmd ? (total < 100 ? `${total} cards — ${100 - total} short of 100` : `${total} cards — ${total - 100} over 100`) : `${total} cards — ${60 - total} short of 60`);
  for (const n of all) if (!info(n)) add('unknown', n, `${short(n)}: no card data`);
  let ci = null;
  if (isCmd) {
    const L = cmdrs.map(info).filter(Boolean);
    if (cmdrs.length < 1) add('cmdcount', null, 'Pick your commander first'); else if (cmdrs.length > 2) add('cmdcount', null, 'At most 2 commanders');
    if (cmdrs.length === 2 && L.length === 2 && !pairOK(L[0], L[1])) add('cmdpair', null, `${short(cmdrs[0])} and ${short(cmdrs[1])} can’t be commanders together`);
    for (const i of L) { const withChooser = L.length === 2 && L.some(x => tokens(x).includes('B'));
      if (!(i.cmdr === 1 || (i.cmdr === 2 && withChooser))) add('badcmd', i.name, `${short(i.name)} can’t be a commander`); }
    ci = new Set(L.flatMap(i => [...(i.ci || '')]));
  }
  for (const n of all) {
    const i = info(n); if (!i) continue; const l = legal(n);
    if (l === 'b' || (n === comp && BANNED_AS_COMPANION.has(n))) add('banned', n, n === comp && l !== 'b' ? `${short(n)} is banned as a companion` : `${short(n)} is banned in ${cap(fmt)}`);
    else if (l === 'n' || l === '?') add('notlegal', n, `${short(n)} isn’t legal in ${cap(fmt)}`);
    else if (l === 'r' && (counts.get(n) || 0) > 1) add('restricted', n, `${short(n)} is restricted: max 1 (you have ${counts.get(n)})`);
    if (ci && cmdrs.length) { const out = [...(i.ci || '')].filter(x => !ci.has(x)); if (out.length) add('color', n, `${short(n)} is outside your colors (${out.join('')})`); }
  }
  for (const [n, q] of counts) {
    const i = info(n); if (!i) continue;
    const lim = basic(n) || i.limit === 999 ? Infinity : Math.max(i.limit || 0, isCmd ? 1 : 4);
    if (q > lim) add('singleton', n, cmdrs.includes(n) && isCmd ? `${short(n)} is your commander — remove it from the deck` : isCmd ? `${short(n)} ×${q} — Commander is 1 copy each` : `${short(n)} ×${q} — max ${lim} copies`);
  }
  if (comp && info(comp)) {
    if (counts.has(comp)) add('singleton', comp, `${short(comp)} is your companion and also in the deck`);
    let ok = false; const deckNames = [...counts.keys()];
    if (comp === 'Lurrus of the Dream-Den') ok = deckNames.every(n => { const d = info(n); return !d || !PERM.test(d.type) || d.cmc <= 2; });
    else if (comp === 'Yorion, Sky Nomad') ok = total >= 120; // needs 120+; Commander is exactly 100, so size flags it
    else ok = !!deck.companionOK; // other companions: condition not checked automatically
    if (!ok) add('companion', comp, `${short(comp)}: companion condition not met`);
  }
  const order = { cmdcount: 0, cmdpair: 1, badcmd: 2, size: 3, banned: 4, notlegal: 5, restricted: 6, color: 7, singleton: 8, companion: 9, unknown: 10 };
  issues.sort((a, b) => order[a.kind] - order[b.kind]);
  return { format: fmt, total, target: isCmd ? 100 : 60, exact: isCmd, ok: !issues.length, issues, ci: ci ? [...'WUBRG'].filter(c => ci.has(c)).join('') : null, stats: stats(deck, info) };
}
export function stats(deck, info) {
  const curve = new Array(8).fill(0), types = {}, pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; let lands = 0, spells = 0, mvSum = 0;
  for (const c of deck.cards) { const i = info(c.name); if (!i) continue; const t = mainType(i.type);
    types[t] = (types[t] || 0) + c.qty;
    if (t === 'Land') { lands += c.qty; continue; }
    spells += c.qty; mvSum += i.cmc * c.qty; curve[Math.min(7, Math.floor(i.cmc))] += c.qty;
    (i.colors || 'C').split('').forEach(x => pips[x] = (pips[x] || 0) + c.qty); }
  return { curve, types, pips, lands, spells, avgMV: spells ? mvSum / spells : 0 };
}
const TYPES = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land'];
export function mainType(t = '') { for (const k of TYPES) if (t.includes(k)) return k; return 'Other'; }
const short = n => String(n).split(' // ')[0];
const cap = s => s[0].toUpperCase() + s.slice(1);
