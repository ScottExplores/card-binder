// Offline check of Fast-scan readers on crops dumped by bench/fast.mjs (DUMP=dir FASTONLY=1). node bench/fasteval.mjs dir truth.json idOffset
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const [dir, tj, off = '-2'] = process.argv.slice(2); const truth = JSON.parse(fs.readFileSync(tj)).names; const inner = Object.fromEntries(JSON.parse(fs.readFileSync(dir + '/inner.json')));
const port = 8500 + Math.floor(Math.random() * 90);
const srv2 = spawn('python3', ['-m', 'http.server', String(port + 1)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
fs.rmSync('bench/_fe', { recursive: true, force: true }); fs.cpSync(dir, 'bench/_fe', { recursive: true });
const br2 = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 1e7 });
const p2 = await br2.newPage(); await p2.goto(`http://localhost:${port + 1}/bench/bench.html`); await p2.waitForFunction('window.runBench'); await p2.evaluate(() => runBench([]));
const items = Object.keys(inner).map(Number).filter(id => truth[id + +off]).map(id => ({ id, name: truth[id + +off], inner: inner[id], q: fs.existsSync(`${dir}/${String(id).padStart(2, '0')}_q.jpg`) }));
const res = await p2.evaluate(async items => {
  const ld = async u => { const im = new Image(); im.src = u; await im.decode(); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); return c; };
  const out = [];
  for (const it of items) {
    const k = String(it.id).padStart(2, '0'); const card = await ld(`/bench/_fe/${k}_${it.q ? 'q' : 'g'}.jpg`), wide = await ld(`/bench/_fe/${k}_wide.jpg`);
    const r = { id: it.id, truth: it.name }; it.inner = it.inner;
    let t = performance.now(); const f = idf.identifyFast(card); r.fast = f.match?.name || null; r.fastMs = performance.now() - t; r.fs = f.s; r.fm = f.margin;
    for (const [k, o] of [['fr1', { fast: true, maxSide: 640 }], ['fr2', { fast: false, maxSide: 900 }], ['fr3', { fast: true, maxSide: 900 }]]) { t = performance.now(); const x = idf.fastRead(wide, it.inner, o); r[k] = x.match?.name || null; r[k + 'Ms'] = performance.now() - t; }
    t = performance.now(); const c = await idf.identifyCard(card); r.card = c.match?.name; r.cardConf = c.conf; r.cardMs = performance.now() - t;
    const i = it.inner; const ib = [[i[0], i[1]], [i[0] + i[2], i[1]], [i[0] + i[2], i[1] + i[3]], [i[0], i[1] + i[3]]];
    t = performance.now(); const w = (await idf.identifyCanvas(wide, { mode: 'single', guide: ib })).results[0]; r.wide = w?.match?.name; r.wideConf = w?.conf; r.wideMs = performance.now() - t;
    out.push(r);
  }
  return out;
}, items);
await br2.close(); srv2.kill(); fs.rmSync('bench/_fe', { recursive: true, force: true });
const acc = (k, ck) => { const ok = res.filter(r => r[k] === r.truth && (!ck || r[ck] !== 'low')).length; const wrong = res.filter(r => r[k] && r[k] !== r.truth && (!ck || r[ck] !== 'low')).length; return { ok, wrong, low: ck ? res.filter(r => r[ck] === 'low').length : null }; };
const med = a => a.sort((x, y) => x - y)[a.length >> 1] | 0;
console.log(JSON.stringify({ n: res.length, fr1: acc('fr1'), fr2: acc('fr2'), fr3: acc('fr3'), frMs: [med(res.map(r => r.fr1Ms)), med(res.map(r => r.fr2Ms)), med(res.map(r => r.fr3Ms))], fast: acc('fast'), card: acc('card', 'cardConf'), wide: acc('wide', 'wideConf'), ms: { fast: med(res.map(r => r.fastMs)), card: med(res.map(r => r.cardMs)), wide: med(res.map(r => r.wideMs)) } }));
for (const r of res) console.log(r.id, r.truth, '|', r.fast, '|', r.card, r.cardConf, r.cardMs | 0, '|', r.wide, r.wideConf, r.wideMs | 0);
