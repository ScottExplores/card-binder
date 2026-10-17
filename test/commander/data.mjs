// App metadata is authoritative; local Oracle bulk text supplies omitted abilities.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
export async function loadCardData() {
  const root = new URL('../../', import.meta.url);
  const [cards, meta, bulk] = await Promise.all([
    readFile(new URL('public/data/cards.json', root)).then(JSON.parse),
    readFile(new URL('public/data/meta.json', root)).then(JSON.parse),
    readFile(new URL('build/oracle.jsonl.gz', root)),
  ]);
  const oracle = new Map();
  for (const line of gunzipSync(bulk).toString('utf8').split('\n')) {
    const clean = line.trim().replace(/,$/, '');
    if (!clean.startsWith('{')) continue;
    const c = JSON.parse(clean);
    if (!['token', 'art_series'].includes(c.layout)) oracle.set(c.name, c);
  }
  const byName = new Map();
  cards.names.forEach((name, i) => {
    const row = meta.info[i];
    if (!row) return;
    const info = Object.fromEntries(meta.cols.map((key, j) => [key, row[j]]));
    const raw = oracle.get(name);
    const front = raw?.card_faces?.[0] ?? raw;
    byName.set(name, { ...info, name,
      legality: info.legal[meta.formats.indexOf('commander')],
      oracleText: front?.oracle_text ?? '',
      frontType: front?.type_line ?? info.type,
      // Bulk cmc is the whole card; Lurrus examines front characteristics.
      manaValue: raw?.cmc ?? info.cmc,
      raw,
    });
  });
  return { byName, built: cards.built, formats: meta.formats };
}
