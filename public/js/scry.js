// Scryfall API client with polite rate limiting and in-memory + IndexedDB caching.
import { kvGet, kvSet } from './db.js';
const API = 'https://api.scryfall.com';
let last = 0; const GAP = 520; // Scryfall asks <=2 req/s for search, named and collection
const mem = new Map();
async function throttle() { const now = Date.now(); const wait = Math.max(0, last + GAP - now); last = now + wait; if (wait) await new Promise(r => setTimeout(r, wait)); }
export async function sget(path, { cacheHours = 24 } = {}) {
  if (mem.has(path)) return mem.get(path);
  const p = (async () => {
    const ck = 'sf:' + path;
    if (cacheHours) { const c = await kvGet(ck); if (c && Date.now() - c.t < cacheHours * 3600e3) return c.v; }
    for (let attempt = 0; attempt < 3; attempt++) {
      await throttle();
      const r = await fetch(API + path, { headers: { Accept: 'application/json' } });
      if (r.status === 429) { await new Promise(r => setTimeout(r, 600 * (attempt + 1))); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Scryfall ' + r.status);
      const v = await r.json(); if (cacheHours) kvSet(ck, { t: Date.now(), v }); return v;
    }
    throw new Error('Scryfall rate limited');
  })();
  mem.set(path, p); p.catch(() => mem.delete(path)); return p;
}
export async function printsOf(name) {
  const q = encodeURIComponent(`!"${name}" game:paper`);
  let page = await sget(`/cards/search?q=${q}&unique=prints&order=released&dir=asc`, { cacheHours: 72 });
  if (!page) return [];
  const out = [...page.data];
  let n = 0; while (page.has_more && n++ < 4) { page = await sget(page.next_page.replace(API, ''), { cacheHours: 72 }); if (!page) break; out.push(...page.data); }
  return out;
}
export const fuzzy = name => sget('/cards/named?fuzzy=' + encodeURIComponent(name), { cacheHours: 72 });
export async function collection(ids) { // refresh prices, 75 per request
  const out = [];
  for (let i = 0; i < ids.length; i += 75) {
    await throttle();
    const r = await fetch(API + '/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifiers: ids.slice(i, i + 75) }) });
    if (!r.ok) throw new Error('Scryfall ' + r.status); const j = await r.json(); out.push(...j.data);
  }
  return out;
}
export function imageOf(card, size = 'normal', face = 0) {
  return card.image_uris?.[size] || card.card_faces?.[face]?.image_uris?.[size] || card.card_faces?.[0]?.image_uris?.[size] || '';
}
export const isOldFrame = c => c.frame === '1993' || c.frame === '1997';
// Slim record stored in the binder
export function slim(c) {
  return { id: c.id, oracle_id: c.oracle_id || c.card_faces?.[0]?.oracle_id, name: c.name, set: c.set, set_name: c.set_name, cn: c.collector_number,
    rarity: c.rarity, frame: c.frame, lang: c.lang, img: imageOf(c, 'normal'), small: imageOf(c, 'small'),
    usd: c.prices?.usd ? +c.prices.usd : null, usd_foil: c.prices?.usd_foil ? +c.prices.usd_foil : null, usd_etched: c.prices?.usd_etched ? +c.prices.usd_etched : null,
    finishes: c.finishes || [], released: c.released_at, type: c.type_line || c.card_faces?.[0]?.type_line, priced_at: Date.now() };
}
