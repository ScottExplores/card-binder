// Local card database (all English paper printings), built from Scryfall bulk data by build/build_db.py.
let DB = null;
export async function loadDB(url = './data/cards.json') {
  if (DB) return DB;
  const j = await (await fetch(url)).json();
  const byName = new Map(), byId = new Map(), bySetCn = new Map();
  const C = j.cols.reduce((o, k, i) => (o[k] = i, o), {});
  const prints = j.rows.map(r => {
    const p = { id: r[C.id], name: j.names[r[C.name]], set: r[C.set], set_name: j.sets[r[C.set]], cn: r[C.cn], frame: r[C.frame], rarity: r[C.rarity], fin: r[C.fin],
      usd: r[C.usd], usd_foil: r[C.usd_foil], usd_etched: r[C.usd_etched], released: r[C.released], fullart: !!r[C.fullart], noimg: !!r[C.noimg] };
    byId.set(p.id, p); bySetCn.set(p.set + '/' + p.cn, p);
    if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name).push(p); return p;
  });
  for (const l of byName.values()) l.sort((a, b) => (a.released < b.released ? -1 : 1));
  DB = { names: j.names, prints, byName, byId, bySetCn, built: j.built };
  return DB;
}
export const db = () => DB;
export const isOldFrame = p => p.frame === '1993' || p.frame === '1997';
export function img(p, size = 'normal', face = 'front') { return `https://cards.scryfall.io/${size}/${face}/${p.id[0]}/${p.id[1]}/${p.id}.jpg`; }
export function priceOf(p, finish = 'nonfoil') { return finish === 'foil' ? (p.usd_foil ?? p.usd_etched) : finish === 'etched' ? (p.usd_etched ?? p.usd_foil) : (p.usd ?? p.usd_foil ?? p.usd_etched); }
export function defaultFinish(p) { return p.fin.includes('n') ? 'nonfoil' : p.fin.includes('f') ? 'foil' : 'etched'; }
