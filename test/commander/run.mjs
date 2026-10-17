import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadCardData } from './data.mjs';
const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url)));
const data = await loadCardData();
const moduleURL = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('./checker.reference.mjs', import.meta.url);
const mod = await import(moduleURL.href);
const check = mod.checkDeck ?? mod.default;
if (typeof check !== 'function') throw new Error('Checker must export checkDeck or a default function');
const normalize = result => {
  if (typeof result?.legal !== 'boolean' || !Array.isArray(result.errors)) throw new Error('Expected {legal:boolean, errors:Array}');
  const errors = result.errors.map(({ type, card }) => {
    if (typeof type !== 'string' || !(card === null || typeof card === 'string')) throw new Error('Errors need type and card (string or null)');
    return { type, card };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { legal: result.legal, errors };
};
let passed = 0;
const ids = new Set();
for (const fixture of fixtures) {
  if (ids.has(fixture.id) || !fixture.description || !fixture.rule) throw new Error(`Invalid fixture: ${fixture.id}`);
  ids.add(fixture.id);
  try {
    const actual = normalize(await check(structuredClone(fixture.input), data));
    const expected = normalize(fixture.expected);
    if (!isDeepStrictEqual(actual, expected)) throw new Error(`expected ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
    console.log(`PASS ${fixture.id}: ${fixture.description}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${fixture.id}: ${error.stack ?? error}`);
  }
}
console.log(`\n${passed}/${fixtures.length} passed; ${fixtures.length - passed} failed (app data built ${data.built})`);
process.exitCode = passed === fixtures.length ? 0 : 1;
