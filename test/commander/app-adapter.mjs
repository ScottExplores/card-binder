// Adapter: runs the app's own checker (public/js/deckcheck.js) on the pack, using only the app's meta.json.
import { readFile } from 'node:fs/promises';
import { checkDeck as appCheck } from '../../public/js/deckcheck.js';
const root = new URL('../../', import.meta.url);
const [cards, meta] = await Promise.all([readFile(new URL('public/data/cards.json', root)).then(JSON.parse), readFile(new URL('public/data/meta.json', root)).then(JSON.parse)]);
const byName = new Map(); cards.names.forEach((n, i) => { const x = meta.info[i]; if (x) byName.set(n, { name: n, type: x[0], cmc: x[1], colors: x[2], ci: x[3], legal: x[4], cmdr: +x[5], limit: x[6], pair: x[7] || '' }); });
const TYPE = { size: 'DECK_SIZE', banned: 'BANNED', notlegal: 'NOT_LEGAL', color: 'COLOR_IDENTITY', singleton: 'SINGLETON', cmdcount: 'COMMANDER_COUNT', cmdpair: 'COMMANDER_PAIR', badcmd: 'INVALID_COMMANDER', companion: 'COMPANION', unknown: 'UNKNOWN_CARD', restricted: 'SINGLETON' };
export function checkDeck(input) {
  const cardsIn = [...input.cards, ...(input.fillBasics || [])].map(c => ({ name: c.name, qty: c.count }));
  const r = appCheck({ format: 'commander', commanders: input.commanders, cards: cardsIn, companion: input.companion }, n => byName.get(n));
  const errors = []; for (const i of r.issues) { const e = { type: TYPE[i.kind], card: i.name }; if (!errors.some(x => x.type === e.type && x.card === e.card)) errors.push(e); }
  return { legal: !errors.length, errors };
}
