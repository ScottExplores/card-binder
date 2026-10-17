#!/usr/bin/env node
// Real-photo evaluation through the same browser Identifier used by bench/run.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { parseCSV } from '../../public/js/csv.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const positional = args.filter(x => x !== '--offline');
if (!positional[0] || positional.length > 2) {
  console.error('Usage: node bench/real/run.mjs PHOTO_FOLDER [truth.csv] [--offline]');
  process.exit(1);
}
const folder = await fs.realpath(path.resolve(positional[0]));
const csvPath = path.resolve(positional[1] || path.join(folder, 'truth.csv'));
const rows = parseCSV(await fs.readFile(csvPath, 'utf8'));
const headers = rows.shift()?.map(x => x.trim());
for (const field of ['filename', 'name', 'set', 'collector_number']) {
  if (!headers?.includes(field)) throw new Error(`Missing CSV column: ${field}`);
}
if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV columns');
const j = JSON.parse(await fs.readFile(path.join(root, 'public/data/cards.json'), 'utf8'));
const col = Object.fromEntries(j.cols.map((x, i) => [x, i]));
const prints = j.rows.map(r => Object.fromEntries(j.cols.map(k => [k, k === 'name' ? j.names[r[col[k]]] : r[col[k]]])));
const lookup = new Map(prints.map(p => [`${p.set}/${p.cn}`, p]));
const used = new Set();
const items = [];
for (const [i, row] of rows.entries()) {
  if (row.length !== headers.length) throw new Error(`Row ${i + 2}: wrong column count`);
  const t = Object.fromEntries(headers.map((h, k) => [h, row[k].trim()]));
  if (!t.filename || used.has(t.filename)) throw new Error(`Row ${i + 2}: empty/duplicate filename`);
  used.add(t.filename);
  const photo = await fs.realpath(path.resolve(folder, t.filename));
  if (!photo.startsWith(folder + path.sep)) throw new Error('Photo must be inside PHOTO_FOLDER');
  const p = lookup.get(`${t.set.toLowerCase()}/${t.collector_number}`);
  if (!p || p.name !== t.name) throw new Error(`Row ${i + 2}: name/set/collector_number not in bundled DB`);
  let finish = null;
  if (t.foil) {
    const f = t.foil.toLowerCase();
    if (['true', 'yes', '1', 'foil'].includes(f)) finish = 'foil';
    else if (['false', 'no', '0', 'normal', 'nonfoil'].includes(f)) finish = 'nonfoil';
    else if (f === 'etched') finish = 'etched';
    else throw new Error(`Row ${i + 2}: unsupported foil value`);
    if (!p.fin.includes({ nonfoil: 'n', foil: 'f', etched: 'e' }[finish])) throw new Error(`Row ${i + 2}: finish unavailable for this printing`);
  }
  const era = p.fullart ? 'full-art/borderless (combined DB flag)' : ['1993', '1997'].includes(p.frame) ? `old frame (${p.frame})` : `modern (${p.frame || 'unknown'})`;
  items.push({ ...t, photo, truthId: p.id, finish, era });
}
if (!items.length) throw new Error('CSV contains no photos');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    let file;
    if (u.pathname === '/photo') {
      const index = Number(u.searchParams.get('i'));
      if (!Number.isInteger(index) || !items[index]) throw new Error('Unknown photo');
      file = items[index].photo;
    } else {
      file = await fs.realpath(path.resolve(root, '.' + decodeURIComponent(u.pathname)));
      if (!file.startsWith(root)) throw new Error('Outside repo');
    }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('[page]', e.message));
  if (offline) {
    await page.setRequestInterception(true);
    page.on('request', r => r.url().startsWith(origin) || /^(data:|blob:)/.test(r.url()) ? r.continue() : r.abort());
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  }
  await page.goto(origin + '/bench/bench.html');
  await page.waitForFunction('window.runBench');
  const initAt = performance.now();
  await page.evaluate(() => window.runBench([]));
  const initMs = performance.now() - initAt;
  const results = [];
  for (const [i, truth] of items.entries()) {
    console.error(`${i + 1}/${items.length}: ${truth.filename}`);
    const r = await page.evaluate(async i => {
      const im = new Image(); im.src = `/photo?i=${i}`;
      const start = performance.now();
      try {
        await im.decode();
        // Match app Photo import's 4000px cap, not camera capture's 1920px cap.
        const c = document.createElement('canvas'), scale = Math.min(1, 4000 / Math.max(im.naturalWidth, im.naturalHeight));
        c.width = im.naturalWidth * scale; c.height = im.naturalHeight * scale;
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const r = await window.idf.identifyCanvas(c, { mode: 'single' });
        const x = r.results.find(x => x.match);
        return { ms: r.ms, totalMs: performance.now() - start, id: x?.match?.id, name: x?.match?.name, set: x?.match?.set, collector_number: x?.match?.cn, fin: x?.match?.fin, conf: x?.conf, ambiguous: x?.printAmbiguous, top5: (x?.alts || []).slice(0, 5).map(p => p.id) };
      } catch (e) { return { error: String(e), totalMs: performance.now() - start }; }
    }, i);
    // chooseFinish with the app's initial S.foil=false; finish is a user toggle, not inferred.
    const finish = r.fin?.includes('n') ? 'nonfoil' : r.fin?.includes('f') ? 'foil' : r.fin ? 'etched' : null;
    const nameOK = r.name === truth.name, exactOK = r.id === truth.truthId;
    const autoAdded = !!r.id && ['medium', 'high'].includes(r.conf);
    results.push({ filename: truth.filename, era: truth.era, truth: { id: truth.truthId, name: truth.name, set: truth.set, collector_number: truth.collector_number, finish: truth.finish }, prediction: { ...r, finish }, nameOK, exactOK, top5OK: r.top5?.includes(truth.truthId) || false, autoAdded, finishOK: truth.finish === null ? null : finish === truth.finish });
  }
  const summarize = list => {
    const n = list.length, auto = list.filter(r => r.autoAdded), knownFinish = list.filter(r => r.finishOK !== null);
    const rate = (count, denom) => denom ? count / denom : null;
    return { cards: n, nameAccuracy: rate(list.filter(r => r.nameOK).length, n), exactPrintingAccuracy: rate(list.filter(r => r.exactOK).length, n), top5PrintingAccuracy: rate(list.filter(r => r.top5OK).length, n), autoAdded: auto.length, autoAddErrorRate: rate(auto.filter(r => !r.exactOK || r.finishOK === false).length, auto.length), autoAddWrongNameRate: rate(auto.filter(r => !r.nameOK).length, auto.length), autoAddWrongPrintingRate: rate(auto.filter(r => !r.exactOK).length, auto.length), autoAddCoverage: rate(auto.length, n), finishLabeled: knownFinish.length, finishAccuracy: rate(knownFinish.filter(r => r.finishOK).length, knownFinish.length), avgIdentifyMs: rate(list.reduce((s, r) => s + (r.prediction.ms || 0), 0), list.filter(r => Number.isFinite(r.prediction.ms)).length), avgTotalMs: rate(list.reduce((s, r) => s + r.prediction.totalMs, 0), n), errors: list.filter(r => r.prediction.error).length };
  };
  console.log(JSON.stringify({ mode: 'single photo; initial foil toggle OFF', offline, workers: 4, initMs, summary: summarize(results), byFrameEra: Object.fromEntries([...new Set(items.map(t => t.era))].map(era => [era, summarize(results.filter(r => r.era === era))])), results }, null, 2));
  if (results.some(r => r.prediction.error)) process.exitCode = 2;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
