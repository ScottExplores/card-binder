// Reproduce the "Reading video… 1%" hang in WebKit (Safari engine) with a phone-like HEVC .mov.
// node test/ios/repro.mjs <webkit|chrome> <video under /bench/phone> <scenario: none|pause|hidden>
import { webkit, chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const [bn = 'webkit', file = 'deck1s_hevc4k.mov', scen = 'none', fn = 'processDeck'] = process.argv.slice(2);
const port = 8800 + Math.floor(Math.random() * 90); const srv = spawn('python3', ['-m', 'http.server', String(port)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await (bn === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] }) : webkit.launch());
const pg = await br.newPage(); pg.on('pageerror', e => console.error('[pgerr]', e.message));
await pg.goto(`http://localhost:${port}/bench/bench.html`); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
await pg.evaluate(u => { window.__prog = []; window.__asUrl = u; }, !!process.env.ASURL);
const run = pg.evaluate(async ([url, fn]) => { const m = await import('/public/js/record.js'); const t0 = performance.now();
  try { const r = await m[fn](idf, window.__asUrl ? url : await (await fetch(url)).blob(), { onProgress: (f, msg) => window.__prog.push([+(f * 100).toFixed(1), msg, (performance.now() - t0) | 0]) }); return { ok: true, n: r.cards.length, names: r.cards.map(c => c.match.name), s: +(r.ms / 1000).toFixed(1) }; }
  catch (e) { return { ok: false, err: String(e) }; } }, ['/bench/phone/' + file, fn]);
let done = null; run.then(r => done = r);
const t0 = Date.now(); let paused = false;
while (!done && Date.now() - t0 < 120000) {
  await new Promise(r => setTimeout(r, 1000));
  const p = await pg.evaluate(() => window.__prog.at(-1));
  if (!paused && scen !== 'none' && p && p[0] > 0.5) { paused = true; console.log('-> simulating iOS app switch: media paused' + (scen === 'hidden' ? ' + visibilitychange' : ''));
    await pg.evaluate(hidden => { document.querySelectorAll('video').forEach(v => v.pause()); if (hidden) { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); setTimeout(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, 3000); } }, scen === 'hidden'); }
  console.log(((Date.now() - t0) / 1000 | 0) + 's', JSON.stringify(p));
}
console.log('RESULT', JSON.stringify(done || { hung: true, after_s: 120 }));
await br.close(); srv.kill(); process.exit(0);
