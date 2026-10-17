// Live-outline benchmark: detection time per frame (4x CPU throttle) and hit rate vs truth quads on single-card scenes.
// node bench/live.mjs [variant] [n]   variant: old | new
import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { spawn } from 'child_process';
const variant = process.argv[2] || 'old', N = +process.argv[3] || 120;
const truth = JSON.parse(fs.readFileSync('bench/truth.json')).filter(t => t.mode === 'single'); const items = truth.filter((_, i) => i % Math.floor(truth.length / N) === 0).slice(0, N);
const srv = spawn('python3', ['-m', 'http.server', '8773'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 1800000 });
const pg = await br.newPage(); pg.on('pageerror', e => console.error(e.message));
await pg.goto('http://localhost:8773/bench/bench.html'); await pg.waitForFunction('window.runBench');
await pg.evaluate(async () => { const { loadCV } = await import('/public/js/loadcv.js'); window.cv = await loadCV('/public/vendor/opencv.js'); window.V = await import('/public/js/vision.js?' + Date.now()); });
const cdp = await pg.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const r = await pg.evaluate(async (items, variant) => {
  const out = [];
  for (const it of items) {
    const im = new Image(); im.src = '/bench/' + it.file; await im.decode();
    const big = Math.max(im.naturalWidth, im.naturalHeight);
    const sz = variant === 'old' || variant === 'new640' ? 640 : 480; const sc = sz / big; const c = document.createElement('canvas'); c.width = im.naturalWidth * sc | 0; c.height = im.naturalHeight * sc | 0;
    const t0 = performance.now(); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, c.width, c.height);
    const src = cv.matFromImageData(g.getImageData(0, 0, c.width, c.height));
    const qs = variant === 'old' ? V.detectCards(cv, src, { maxCards: 1, minAreaFrac: 0.08 }) : V.detectLive(cv, src); src.delete();
    const ms = performance.now() - t0; const q = qs[0]?.map(p => [p[0] / sc, p[1] / sc]);
    out.push({ ms, q, truth: it.quads[0], W: im.naturalWidth, H: im.naturalHeight });
  }
  return out;
}, items, variant);
await br.close(); srv.kill();
// hit = all 4 corners within 4% of image size of a truth corner (outer card edge)
let hit = 0; const ms = r.map(x => x.ms).sort((a, b) => a - b);
for (const x of r) { if (!x.q) continue; const tol = 0.04 * Math.max(x.W, x.H); if (x.q.every(p => x.truth.some(t => Math.hypot(t[0] - p[0], t[1] - p[1]) < tol))) hit++; }
const med = ms[ms.length >> 1], p90 = ms[(ms.length * 0.9) | 0];
const out = { variant, n: r.length, hitRate: +(100 * hit / r.length).toFixed(1), found: +(100 * r.filter(x => x.q).length / r.length).toFixed(1), detect_med_ms: +med.toFixed(0), detect_p90_ms: +p90.toFixed(0) };
console.log(JSON.stringify(out)); fs.appendFileSync('bench/live_results.jsonl', JSON.stringify(out) + '\n');
