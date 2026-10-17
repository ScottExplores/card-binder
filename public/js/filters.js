// Binder filtering and sorting. Pure: entries + a card-info lookup (meta.js info()).
export const DEFAULT_F = () => ({ q: '', colors: [], colorMode: 'any', ci: [], types: [], cmc: [], rarity: [], set: '', legal: '', pmin: '', pmax: '', foil: '', binder: '', since: '', pile: '', last: false, over5: false });
const RAR = { c: 0, u: 1, r: 2, m: 3, s: 4, b: 5 };
const WUBRG = 'WUBRG';
export const condMult = { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.35 };
export const unitPrice = e => e.price == null ? null : e.price * (condMult[e.cond || 'NM'] ?? 1);
export function activeCount(f) { let n = 0; for (const [k, v] of Object.entries(f)) { if (k === 'q' || k === 'colorMode') continue; if (Array.isArray(v) ? v.length : v) n++; } return n; }
export function applyFilters(entries, f, info, { lastBatch = null, fmtIdx = null } = {}) {
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const q = norm(f.q || '');
  const since = f.since ? Date.now() - +f.since * 86400e3 : 0;
  return entries.filter(e => {
    if (q && !norm(e.name + ' ' + e.set + ' ' + (e.set_name || '') + ' ' + (e.binder || '')).includes(q)) return false;
    if (f.last && (lastBatch == null || e.batch !== lastBatch)) return false;
    if (f.over5 && (unitPrice(e) || 0) < 5) return false;
    if (f.binder && (e.binder || 'Unsorted') !== f.binder) return false;
    if (f.pile && (e.pile || '') !== (f.pile === 'none' ? '' : f.pile)) return false;
    if (f.set && e.set !== f.set) return false;
    if (f.rarity.length && !f.rarity.includes(e.rarity)) return false;
    if (f.foil === 'foil' && e.finish === 'nonfoil') return false;
    if (f.foil === 'nonfoil' && e.finish !== 'nonfoil') return false;
    const pr = unitPrice(e) || 0; if (f.pmin !== '' && pr < +f.pmin) return false; if (f.pmax !== '' && pr > +f.pmax) return false;
    if (since && (e.added || 0) < since) return false;
    const needInfo = f.colors.length || f.ci.length || f.types.length || f.cmc.length || f.legal;
    if (!needInfo) return true;
    const i = info(e.name); if (!i) return false;
    if (f.colors.length) { const cs = i.colors || ''; const wantC = f.colors.includes('C'), wantM = f.colors.includes('M'); const cols = f.colors.filter(c => WUBRG.includes(c));
      const hit = (wantC && !cs) || (wantM && cs.length > 1) || (f.colorMode === 'exact' ? cols.length && cs.split('').sort().join('') === cols.slice().sort().join('') : cols.some(c => cs.includes(c)));
      if (!hit) return false; }
    if (f.ci.length) { const allowed = new Set(f.ci); if (!(i.ci || '').split('').every(c => allowed.has(c))) return false; }
    if (f.types.length && !f.types.some(t => i.type.includes(t))) return false;
    if (f.cmc.length && !f.cmc.includes(Math.min(7, Math.floor(i.cmc || 0)))) return false;
    if (f.legal) { const k = f.legal; const l = i.legal[fmtIdx?.[k] ?? 0]; if (l !== 'l' && l !== 'r') return false; }
    return true;
  });
}
export const SORTS = { value: 'Value', name: 'Name', newest: 'Newest', set: 'Set', cmc: 'Mana value', color: 'Color', rarity: 'Rarity', qty: 'Quantity' };
export function sortEntries(l, by, info) {
  const ci = e => { const c = info(e.name)?.colors || ''; return c.length === 0 ? 6 : c.length > 1 ? 5 : WUBRG.indexOf(c); };
  const f = {
    value: (a, b) => (unitPrice(b) || 0) - (unitPrice(a) || 0), name: (a, b) => a.name.localeCompare(b.name), newest: (a, b) => (b.added || 0) - (a.added || 0), added: (a, b) => (b.added || 0) - (a.added || 0),
    set: (a, b) => a.set.localeCompare(b.set) || String(a.cn).localeCompare(String(b.cn), undefined, { numeric: true }),
    cmc: (a, b) => (info(a.name)?.cmc ?? 99) - (info(b.name)?.cmc ?? 99) || a.name.localeCompare(b.name),
    color: (a, b) => ci(a) - ci(b) || a.name.localeCompare(b.name),
    rarity: (a, b) => (RAR[b.rarity] ?? -1) - (RAR[a.rarity] ?? -1) || (unitPrice(b) || 0) - (unitPrice(a) || 0),
    qty: (a, b) => b.qty - a.qty || a.name.localeCompare(b.name),
  }[by] || ((a, b) => 0);
  return l.sort(f);
}
