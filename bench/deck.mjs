// Deck-mode benchmark: node bench/deck.mjs bench/deck1 [cpuThrottle] [json-thresholds]
import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { spawn } from 'child_process';
const base = process.argv[2] || 'bench/deck1', thr = +process.argv[3] || 1, T = JSON.parse(process.argv[4] || '{}');
const truth = JSON.parse(fs.readFileSync(base + '.json'));
const port = 8780 + Math.floor(Math.random() * 100);
const srv = spawn('python3', ['-m', 'http.server', String(port)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 3600000 });
const pg = await br.newPage(); pg.on('pageerror', e => console.error('[pgerr]', e.message));
await pg.goto(`http://localhost:${port}/bench/bench.html`); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
if (thr > 1) { const cdp = await pg.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); }
await pg.evaluate(() => window.__deckDbg = []);
const r = await pg.evaluate(async (url, T) => { const { processDeck } = await import('/public/js/record.js'); const r = await processDeck(idf, await (await fetch(url)).blob(), { T }); return { ...r, motion: r.motion.map(x => +x.toFixed(1)), cards: r.cards.map(c => ({ name: c.match.name, id: c.match.id, conf: c.conf, t: +c.t.toFixed(2) })) }; }, '/' + base + '.mp4', T);
const dbg = await pg.evaluate(() => window.__deckDbg);
await br.close(); srv.kill();
// order-aware alignment (LCS) between truth names and found names
const A = truth.names, B = r.cards.map(c => c.name);
const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) L[i][j] = A[i - 1] === B[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
const matched = L[A.length][B.length];
const autoOK = r.cards.filter(c => c.conf !== 'low');
const want = {}; A.forEach(n => want[n] = (want[n] || 0) + 1); const got = {}; B.forEach(n => got[n] = (got[n] || 0) + 1);
let multi = 0; for (const [n, k] of Object.entries(want)) multi += Math.min(k, got[n] || 0);
const out = { video: base, thr, T, duration: +r.duration.toFixed(1), truth: A.length, found: B.length, count_exact: A.length === B.length, correct_in_order: matched, recall: +(100 * matched / A.length).toFixed(1), precision: +(100 * matched / Math.max(1, B.length)).toFixed(1), unsure: r.cards.length - autoOK.length, process_s: +(r.ms / 1000).toFixed(1), holds: r.holds, frames: r.frames };
console.log(JSON.stringify(out)); fs.appendFileSync('bench/deck_results.jsonl', JSON.stringify(out) + '\n');
const miss = Object.entries(want).filter(([n, k]) => (got[n] || 0) < k).map(([n, k]) => `${n} (${got[n] || 0}/${k})`); console.log('missed', miss.join('; '));
console.log('extra', Object.entries(got).filter(([n, k]) => k > (want[n] || 0)).map(([n, k]) => `${n} (${k}/${want[n] || 0})`).join('; '));
if (process.env.DBG) console.log(JSON.stringify(dbg));
if (process.env.DUMP) fs.writeFileSync('/tmp/deck_dump.json', JSON.stringify({ r, truth }));
