import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const srv = spawn('python3', ['-m', 'http.server', '8765'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
const pg = await br.newPage(); pg.on('console', m => console.error('[page]', m.text()));
await pg.goto('http://localhost:8765/bench/bench.html'); await pg.waitForFunction('window.runBench');
await pg.evaluate(() => runBench([]));
const out = await pg.evaluate(async (f, mode) => {
  const img = new Image(); img.src = '/bench/' + f; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
  const { detectCards, warpCard } = await import('/public/js/vision.js');
  const src = idf.cv.matFromImageData(c.getContext('2d').getImageData(0, 0, c.width, c.height));
  const qs = detectCards(idf.cv, src, { maxCards: mode === 'single' ? 3 : 11, minAreaFrac: mode=='single'?0.06:0.012 });
  const warps = qs.map(q => { const w = warpCard(idf.cv, src, q); const cc = idf.matToCanvas(w); w.delete(); return cc; });
  const bands = warps.map(w => idf.bandCanvas(w, { x0: 0.055, x1: 0.80, y0: 0.035, y1: 0.098 }).toDataURL());
  const texts = []; for (const w of warps) texts.push(await idf.readName(w).then(r => [r.text, r.cands.slice(0,2).map(x=>x.full+':'+x.score.toFixed(2))]));
  let err = null; try { await idf.identifyCard(warps[0]); } catch (e) { err = e.stack; }
  return { qs, texts, warps: warps.map(w => w.toDataURL('image/jpeg')), bands, err };
}, process.argv[2], process.argv[3] || 'single');
fs.mkdirSync('/tmp/dbg', { recursive: true });
out.warps.forEach((d, i) => fs.writeFileSync(`/tmp/dbg/w${i}.jpg`, Buffer.from(d.split(',')[1], 'base64')));
out.bands.forEach((d, i) => fs.writeFileSync(`/tmp/dbg/b${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
console.log(JSON.stringify({ n: out.qs.length, texts: out.texts, err: out.err }, null, 1));
await br.close(); srv.kill();
