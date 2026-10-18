// Fast-scan benchmark: the real app in headless Chrome, phone-sized screen, fake camera playing a synthetic "slide cards into
// the box" feed (bench/mkfeed.py). Usage: node bench/fast.mjs /tmp/feed3 [cpuThrottle]
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const base = process.argv[2] || '/tmp/feed3', thr = +process.argv[3] || 1; const truth = JSON.parse(fs.readFileSync(base + '.json'));
const port = 8600 + Math.floor(Math.random() * 90); const srv = spawn('python3', ['-m', 'http.server', String(port), '-d', 'public'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + base + '.y4m', '--autoplay-policy=no-user-gesture-required'] });
const pg = await br.newPage(); await pg.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
pg.on('pageerror', e => console.error('[pgerr]', e.message));
await pg.goto(`http://localhost:${port}/`);
await pg.waitForFunction(() => document.querySelector('#scan-status').textContent === 'Ready', { timeout: 180000 });
if (thr > 1) { const cdp = await pg.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); }
await pg.click('#btn-startcam'); await pg.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
if (process.env.DUMP) await pg.evaluate(() => window.__fastDbg = []);
await pg.evaluate(f => { window.__fast.trace = []; window.__fastNoFull = f; }, !!process.env.FASTONLY);
await pg.click('#tg-fast'); const t0 = Date.now();
await new Promise(r => setTimeout(r, truth.seconds * 1000 - 300));
const shot = process.env.SHOT; if (shot) await pg.screenshot({ path: shot });
await new Promise(r => setTimeout(r, 4000)); // let queued reads finish (no new captures counted after the loop point)
const log = await pg.evaluate(() => window.__fast.log);
if (process.env.TRACE) fs.writeFileSync(process.env.TRACE, JSON.stringify(await pg.evaluate(() => window.__fast.trace)));
if (process.env.DUMP) { const d = await pg.evaluate(() => window.__fastDbg); fs.mkdirSync(process.env.DUMP, { recursive: true }); fs.writeFileSync(process.env.DUMP + '/inner.json', JSON.stringify(d.map(x => [x.id, x.inner]))); d.forEach((x) => { const i = x.id; fs.writeFileSync(`${process.env.DUMP}/${String(i).padStart(2, '0')}_${x.quad ? 'q' : 'g'}.jpg`, Buffer.from(x.img.split(',')[1], 'base64')); fs.writeFileSync(`${process.env.DUMP}/${String(i).padStart(2, '0')}_wide.jpg`, Buffer.from(x.wide.split(',')[1], 'base64')); }); }
await br.close(); srv.kill();
const inWin = log.filter(l => l.t - log[0]?.t <= (truth.seconds - 0.5) * 1000);
const got = inWin.filter(l => l.name && l.conf !== 'low');
const A = truth.names, B = got.map(l => l.name);
const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) L[i][j] = A[i - 1] === B[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
const inOrder = L[A.length][B.length]; const want = {}; A.forEach(n => want[n] = (want[n] || 0) + 1); let ok = 0; for (const n of B) if (want[n] > 0) { want[n]--; ok++; } /* multiset: slow full-reader results land a few seconds later, out of order */ const med = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null; const p90 = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.9)] : null;
const span = got.length > 1 ? (got.at(-1).t - got[0].t) / 1000 : 0;
const out = { feed: base, rate_fed: truth.rate, thr, cards_fed: A.length, captures: inWin.length, added: got.length, correct: ok, correct_in_order: inOrder, recall: +(100 * ok / A.length).toFixed(1), wrong_added: got.length - ok,
  unsure: inWin.filter(l => l.name && l.conf === 'low').length, empty: inWin.filter(l => !l.name).length, fast_path: got.filter(l => l.path === 'fast').length, full_path: got.filter(l => l.path === 'full').length,
  cards_per_s: span ? +((got.length - 1) / span).toFixed(2) : null, ms_capture_to_result_median: med(got.map(l => l.ms)) | 0, ms_p90: p90(got.map(l => l.ms)) | 0, ms_fast_median: med(got.filter(l => l.path === 'fast').map(l => l.ms)) | 0 };
console.log(JSON.stringify(out)); fs.appendFileSync('bench/fast_results.jsonl', JSON.stringify(out) + '\n');
if (process.env.DBG) console.log(JSON.stringify(inWin.map(l => [l.path, l.name, l.conf, l.ms | 0, l.fname, +(l.fs || 0).toFixed(3), +(l.fm || 0).toFixed(3)])));
if (process.env.LOGJ) fs.writeFileSync(process.env.LOGJ, JSON.stringify({ truth: truth.names, log: inWin }));
