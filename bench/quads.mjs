import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const srv = spawn('python3', ['-m', 'http.server', '8765'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
const pg = await br.newPage(); await pg.goto('http://localhost:8765/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
const files = process.argv.slice(3), maxC = +process.argv[2];
const out = await pg.evaluate(async (files, maxC) => {
  const { detectCards } = await import('/public/js/vision.js?' + Date.now()); const r = {};
  for (const f of files) { const img = new Image(); img.src = '/bench/' + f; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    const src = idf.cv.matFromImageData(c.getContext('2d').getImageData(0, 0, c.width, c.height)); r[f] = detectCards(idf.cv, src, { maxCards: maxC, minAreaFrac: maxC > 4 ? 0.012 : maxC > 3 ? 0.03 : 0.06 }); src.delete(); }
  return r; }, files, maxC);
fs.writeFileSync('/tmp/quads.json', JSON.stringify(out)); await br.close(); srv.kill();
