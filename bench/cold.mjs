// Phone-like cold benchmark: 4x CPU throttle + throttled 4G network, fresh profile, no feature cache.
// Usage: node bench/cold.mjs [mode] [limit] [label]
import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { spawn } from 'child_process';
const truth = JSON.parse(fs.readFileSync('bench/truth.json')); const cards = Object.fromEntries(JSON.parse(fs.readFileSync('bench/cards.json')).map(c => [c.id, c]));
const mode = process.argv[2] || 'single', lim = +process.argv[3] || 40, label = process.argv[4] || 'run';
// spread picks across the set deterministically
const all = truth.filter(t => t.mode === mode); const step = Math.max(1, Math.floor(all.length / lim)); const items = all.filter((_, i) => i % step === 0).slice(0, lim);
const srv = spawn('python3', ['-m', 'http.server', '8768'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 3600000 });
const pg = await br.newPage(); pg.on('pageerror', e => console.error('[pgerr]', e.message));
await pg.goto('http://localhost:8768/bench/bench.html'); await pg.waitForFunction('window.runBench');
await pg.evaluate(() => runBench([])); // warm engine load (not timed)
await pg.evaluate(() => { window.__st = { ocrN: 0, ocrMs: 0, det: 0 }; const o = idf.ocr.bind(idf); idf.ocr = async c => { const t = performance.now(); const r = await o(c); __st.ocrN++; __st.ocrMs += performance.now() - t; return r; }; });
const cdp = await pg.target().createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 4e6 / 8, uploadThroughput: 1e6 / 8 });
const res = []; for (const it of items) { res.push(...await pg.evaluate(b => runBench(b), [it])); process.stderr.write(`\r${res.length}/${items.length}`); }
const st = await pg.evaluate(() => __st); console.error('\nstats', JSON.stringify(st), 'detect ms', res.map(r => r.tDetect | 0).join(','));
await br.close(); srv.kill();
let tot = 0, ok = 0, pr = 0, auto = 0, autoWrong = 0; const times = [];
for (const r of res) { const t = items.find(x => x.file === r.file); times.push(r.ms);
  t.cards.forEach((id, slot) => { const g = r.res?.find(x => mode === 'single' ? true : x.slot === slot); tot++; const n = g?.name === cards[id].name; ok += n; pr += g?.id === id; if (g && g.conf !== 'low') { auto++; if (!n) { autoWrong++; console.error('WRONG', r.file, cards[id].name, '->', g.name); } } }); }
times.sort((a, b) => a - b); const q = f => (times[Math.min(times.length - 1, (times.length * f) | 0)] / 1000).toFixed(2);
const out = { label, mode, n: items.length, cards: tot, name: +(100 * ok / tot).toFixed(1), print: +(100 * pr / tot).toFixed(1), autoAdded: +(100 * auto / tot).toFixed(1), autoWrong, median_s: +q(0.5), p90_s: +q(0.9), max_s: +q(0.999) };
console.log('\n' + JSON.stringify(out)); fs.appendFileSync('bench/cold_results.jsonl', JSON.stringify(out) + '\n');
