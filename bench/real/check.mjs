// Validate a saved run and sample provenance without asserting a fixed accuracy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const report = JSON.parse(await fs.readFile(process.argv[2] || root + 'review/sample-results.json', 'utf8'));
const { results: rows, summary: s } = report;
assert.equal(s.cards, rows.length);
for (const [metric, field] of [['nameAccuracy', 'nameOK'], ['exactPrintingAccuracy', 'exactOK'], ['top5PrintingAccuracy', 'top5OK']]) {
  assert.equal(s[metric], rows.filter(r => r[field]).length / rows.length);
}
const auto = rows.filter(r => r.autoAdded);
assert.equal(s.autoAdded, auto.length);
assert.equal(s.autoAddErrorRate, auto.length ? auto.filter(r => !r.exactOK || r.finishOK === false).length / auto.length : null);
assert.equal(s.autoAddCoverage, auto.length / rows.length);
assert.equal(Object.values(report.byFrameEra).reduce((n, v) => n + v.cards, 0), rows.length);
for (const r of rows) {
  assert.equal(r.autoAdded, !!r.prediction.id && ['medium', 'high'].includes(r.prediction.conf));
  assert.equal(r.exactOK, r.prediction.id === r.truth.id);
  assert.equal(r.top5OK, r.prediction.top5?.includes(r.truth.id) || false);
}
const sources = JSON.parse(await fs.readFile(root + 'bench/real/sample/SOURCE.json', 'utf8'));
for (const t of sources) {
  assert.deepEqual(await fs.readFile(root + 'bench/' + t.file), await fs.readFile(root + 'bench/real/sample/' + t.file.split('/').at(-1)));
}
console.log(`Report arithmetic/auto-add policy and ${sources.length} byte-identical sample assets: OK`);
