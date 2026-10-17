// Game info per card name (type, mana value, colors, color identity, format legality) and per-printing style flags.
// Built from Scryfall bulk data by build/build_meta.py; aligned with cards.json (names[] and rows[]).
let M = null, P = null;
export const FORMATS = ['commander', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper'];
export const FORMAT_LABEL = { commander: 'Commander', standard: 'Standard', modern: 'Modern', pioneer: 'Pioneer', legacy: 'Legacy', vintage: 'Vintage', pauper: 'Pauper' };
export async function loadMeta(db, url = './data/meta.json') {
  if (M) return M;
  const j = typeof url === 'string' ? await (await fetch(url)).json() : url;
  return setMeta(db, j);
}
export function setMeta(db, j) {
  const byName = new Map();
  j.info.forEach((x, i) => { if (x) byName.set(db.names[i], { name: db.names[i], type: x[0], cmc: x[1], colors: x[2], ci: x[3], legal: x[4], cmdr: x[5] === true ? 1 : +x[5] || 0, limit: x[6], pair: typeof x[7] === 'string' ? x[7] : '' }); });
  M = { byName, style: j.style }; P = db; return M;
}
export const metaReady = () => !!M;
export function info(name) { return M?.byName.get(name) || null; }
// legality code for a format: l legal, b banned, r restricted, n not legal
export function legality(name, fmt) { const i = info(name); if (!i) return '?'; return i.legal[FORMATS.indexOf(fmt)] || '?'; }
export function styleOf(p) { return (M && p && p.row != null && M.style[p.row]) || ''; }
export const STYLES = { S: 'Showcase', X: 'Extended art', B: 'Borderless', F: 'Full art', P: 'Promo', E: 'Etched', R: 'Retro frame', T: 'Textless' };
export function isBasic(name) { const i = info(name); return !!i && /\bBasic\b/.test(i.type); }
export const MAIN_TYPES = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land'];
export function mainType(name) { const t = info(name)?.type || ''; for (const k of MAIN_TYPES) if (t.includes(k)) return k; return 'Other'; }
