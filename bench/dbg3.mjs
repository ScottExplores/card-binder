import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const srv = spawn('python3', ['-m', 'http.server', '8765'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
const pg = await br.newPage(); await pg.goto('http://localhost:8765/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
fs.mkdirSync('/tmp/dbg', { recursive: true });
for (const f of process.argv.slice(2)) {
  const out = await pg.evaluate(async (f) => {
    const img = new Image(); img.src = '/bench/' + f; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    const { detectCards, warpCard } = await import('/public/js/vision.js');
    const src = idf.cv.matFromImageData(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    const qs = detectCards(idf.cv, src, { maxCards: 3, minAreaFrac: 0.06 });
    if (!qs.length) return null;
    const w = warpCard(idf.cv, src, qs[0]); const cc = idf.matToCanvas(w);
    const B = { x0: 0.055, x1: 0.80, y0: 0.035, y1: 0.098 };
    const bands = ['auto', 'white', 'dark'].map(v => idf.bandCanvas(cc, B, v).toDataURL());
    return { w: cc.toDataURL('image/jpeg'), bands };
  }, f);
  if (!out) { console.log(f, 'no quad'); continue; }
  const b = f.split('/').pop().replace('.jpg', '');
  fs.writeFileSync(`/tmp/dbg/${b}_w.jpg`, Buffer.from(out.w.split(',')[1], 'base64'));
  out.bands.forEach((d, i) => fs.writeFileSync(`/tmp/dbg/${b}_b${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
}
await br.close(); srv.kill();
