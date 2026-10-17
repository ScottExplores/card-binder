// Record-mode benchmark: node bench/video.mjs bench/video1 [cpuThrottle]
import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { spawn } from 'child_process';
const base = process.argv[2] || 'bench/video1', thr = +process.argv[3] || 1;
const truth = JSON.parse(fs.readFileSync(base + '.json')); const cards = Object.fromEntries(JSON.parse(fs.readFileSync('bench/cards.json')).map(c => [c.id, c]));
const srv = spawn('python3', ['-m', 'http.server', '8769'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 3600000 });
const pg = await br.newPage(); pg.on('pageerror', e => console.error('[pgerr]', e.message)); pg.on('console', m => m.type() === 'error' && console.error('[page]', m.text()));
await pg.goto('http://localhost:8769/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
if (thr > 1) { const cdp = await pg.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); }
const r = await pg.evaluate(async (url) => { const { processVideo } = await import('/public/js/record.js'); const r = await processVideo(idf, await (await fetch(url)).blob(), {}); return { ...r, cards: r.cards.map(c => ({ name: c.match.name, id: c.match.id, conf: c.conf, n: c.sightings, t: c.t })) }; }, '/' + base + '.mp4');
await br.close(); srv.kill();
const want = {}; for (const id of truth.cards) { const n = cards[id].name; want[n] = (want[n] || 0) + 1; }
const got = {}; for (const c of r.cards.filter(c => c.conf !== 'low')) got[c.name] = (got[c.name] || 0) + 1;
const gotAll = {}; for (const c of r.cards) gotAll[c.name] = (gotAll[c.name] || 0) + 1;
let hit = 0, hitAll = 0; for (const [n, k] of Object.entries(want)) { hit += Math.min(k, got[n] || 0); hitAll += Math.min(k, gotAll[n] || 0); }
const nGot = Object.values(got).reduce((a, b) => a + b, 0);
const out = { video: base, thr, duration: +r.duration.toFixed(1), truth: truth.cards.length, found_checked: nGot, correct_checked: hit, extra_checked: nGot - hit, found_any: r.cards.length, correct_any: hitAll, recall_checked: +(100 * hit / truth.cards.length).toFixed(1), process_s: +(r.ms / 1000).toFixed(1), frames: r.frames, picked: r.picked };
console.log(JSON.stringify(out)); fs.appendFileSync('bench/video_results.jsonl', JSON.stringify(out) + '\n');
const miss = Object.entries(want).filter(([n, k]) => (got[n] || 0) < k).map(([n]) => n); console.log('missed', miss.join('; ')); console.log('extra', Object.keys(got).filter(n => !want[n]).join('; '));
