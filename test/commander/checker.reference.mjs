// Fixture oracle, not production code. No fixture IDs or expected results are read.
import { loadCardData } from './data.mjs';
const permanent = /\b(Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/;
const background = c => /Legendary.*Enchantment.*\bBackground\b/.test(c.frontType);
const ability = (c, line) => c.oracleText.split('\n').some(s => s === line || s.startsWith(line + ' ('));
const eligible = c => (/Legendary/.test(c.frontType) && /Creature/.test(c.frontType)) ||
  /can be your commander/.test(c.oracleText) || c.name === 'Grist, the Hunger Tide';
function pairAllowed(a, b) {
  if (a.name === b.name) return false;
  if (ability(a, 'Partner') && ability(b, 'Partner')) return true;
  // Current Oracle spells this Partner—Friends forever; retain legacy spelling.
  const friends = c => ability(c, 'Friends forever') || ability(c, 'Partner—Friends forever');
  if (friends(a) && friends(b)) return true;
  const namesPartner = (x, y) => x.oracleText.split('\n').some(s => s === `Partner with ${y.name}` || s.startsWith(`Partner with ${y.name} (`));
  if (namesPartner(a, b) && namesPartner(b, a)) return true;
  if ((ability(a, 'Choose a Background') && background(b)) || (ability(b, 'Choose a Background') && background(a))) return true;
  const doctor = c => c.frontType === 'Legendary Creature — Time Lord Doctor';
  return (ability(a, "Doctor's companion") && doctor(b)) || (ability(b, "Doctor's companion") && doctor(a));
}
export async function checkDeck(input, data) {
  data ??= await loadCardData();
  const errors = [];
  const add = (type, card = null) => {
    if (!errors.some(e => e.type === type && e.card === card)) errors.push({ type, card });
  };
  const commanders = input.commanders.map(name => ({ name, count: 1 }));
  const deck = [...commanders, ...input.cards, ...(input.fillBasics ?? [])];
  const all = [...deck, ...(input.companion ? [{ name: input.companion, count: 1 }] : [])];
  const total = deck.reduce((n, c) => n + c.count, 0);
  if (total !== 100) add('DECK_SIZE');
  const get = name => data.byName.get(name);
  for (const { name } of all) if (!get(name)) add('UNKNOWN_CARD', name);
  if (errors.some(e => e.type === 'UNKNOWN_CARD')) return { legal: false, errors };
  const leaders = commanders.map(c => get(c.name));
  if (leaders.length < 1 || leaders.length > 2) add('COMMANDER_COUNT');
  if (leaders.length === 2 && !pairAllowed(...leaders)) add('COMMANDER_PAIR');
  for (const c of leaders) {
    // An enchantment Background needs a chooser, despite meta.cmdr === 1.
    if (!eligible(c) && !(background(c) && leaders.length === 2 && leaders.some(x => ability(x, 'Choose a Background')))) add('INVALID_COMMANDER', c.name);
  }
  const identity = new Set(leaders.flatMap(c => [...c.ci]));
  for (const { name } of all) {
    const c = get(name);
    if (c.legality === 'b') add('BANNED', name);
    else if (c.legality !== 'l') add('NOT_LEGAL', name);
    if ([...c.ci].some(color => !identity.has(color))) add('COLOR_IDENTITY', name);
  }
  const counts = new Map();
  for (const { name, count } of deck) counts.set(name, (counts.get(name) ?? 0) + count);
  for (const [name, count] of counts) {
    const c = get(name);
    const limit = /\bBasic\b/.test(c.type) || c.limit === 999 ? Infinity : c.limit || 1;
    if (count > limit) add('SINGLETON', name);
  }
  if (input.companion) {
    const c = get(input.companion);
    if (counts.has(c.name)) add('SINGLETON', c.name);
    let ok = false;
    if (c.name === 'Lurrus of the Dream-Den') {
      ok = deck.every(({ name }) => { const d = get(name); return !permanent.test(d.frontType) || d.manaValue <= 2; });
    } else if (c.name === 'Yorion, Sky Nomad') {
      ok = total >= 120; // Commander min and max are both 100; cannot satisfy both.
    }
    if (!ok) add('COMPANION', c.name);
  }
  return { legal: errors.length === 0, errors };
}
export default checkDeck;
