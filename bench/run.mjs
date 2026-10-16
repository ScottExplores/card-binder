// Usage: node bench/run.mjs [filter] [limit]  — runs the real browser pipeline in headless Chrome.
import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { spawn } from 'child_process';
const truth = JSON.parse(fs.readFileSync('bench/truth.json')); const cards = Object.fromEntries(JSON.parse(fs.readFileSync('bench/cards.json')).map(c => [c.id, c]));
const filt = process.argv[2] || ''; const lim = +process.argv[3] || 1e9;
const items = truth.filter(t => t.file.includes(filt) || t.mode === filt || t.cond === filt).slice(0, lim);
const srv = spawn('python3', ['-m', 'http.server', '8765'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 1800000 });
const pg = await br.newPage(); pg.on('requestfailed', r => console.error('[fail]', r.url())); pg.on('response', r => r.status() >= 400 && console.error('[http]', r.status(), r.url())); pg.on('pageerror', e => console.error('[pgerr]', e.message)); pg.on('console', m => console.error('[page]', m.text()));
await pg.goto('http://localhost:8765/bench/bench.html'); await pg.waitForFunction('window.runBench');
const t0 = Date.now(); const res = [];
for (let i = 0; i < items.length; i += 10) { res.push(...await pg.evaluate(b => runBench(b), items.slice(i, i + 10))); process.stderr.write(`\r${res.length}/${items.length}`); }
await br.close(); srv.kill();
// score
const by = {}; let tot = 0, nameOk = 0, printOk = 0, top5 = 0; const fails = [];
const add = (k, n, p) => { by[k] ??= { n: 0, name: 0, print: 0 }; by[k].n++; by[k].name += n; by[k].print += p; };
const times = [];
for (const r of res) {
  const t = items.find(x => x.file === r.file); times.push(r.ms);
  t.cards.forEach((id, slot) => {
    const g = r.res?.find(x => (t.mode === 'single' ? true : x.slot === slot)); const truthC = cards[id];
    const n = g && g.name === truthC.name ? 1 : 0, p = g && g.id === id ? 1 : 0; tot++; nameOk += n; printOk += p; if (g?.alts?.includes(id)) top5++;
    add(t.mode, n, p); add(t.mode + ':' + t.cond, n, p); add('group:' + truthC.group, n, p);
    if (!n) fails.push({ file: t.file, slot, want: truthC.name, got: g?.name, ocr: g?.ocr, det: g?.detected, ns: g?.ns, sim: g?.sim, art: g?.art });
  });
}
const pct = x => (100 * x).toFixed(1) + '%';
console.log(`\ncards ${tot}  name ${pct(nameOk / tot)}  exact printing ${pct(printOk / tot)}  printing in top5 ${pct(top5 / tot)}`);
times.sort((a, b) => a - b); console.log(`per-image ms: median ${times[times.length >> 1] | 0}, p90 ${times[(times.length * 0.9) | 0] | 0}; wall ${(Date.now() - t0) / 1000}s`);
for (const [k, v] of Object.entries(by).sort()) console.log(k.padEnd(28), String(v.n).padStart(4), 'name', pct(v.name / v.n).padStart(6), 'print', pct(v.print / v.n).padStart(6));
fs.writeFileSync('bench/last_fails.json', JSON.stringify(fails, null, 1)); fs.writeFileSync('bench/last_results.json', JSON.stringify(res));
