// Computes the app's art feature (identify.js feat().art) for every unique artwork, in headless Chrome, so the index matches the app exactly.
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const ids = JSON.parse(fs.readFileSync('build/ua_ids.json')).filter(i => fs.existsSync(`build/art/${i}.jpg`));
const srv = spawn('python3', ['-m', 'http.server', '8767'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 1800000 });
const pg = await br.newPage(); await pg.goto('http://localhost:8767/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
const out = fs.openSync('build/artvec.f32', 'w'); const okIds = [];
for (let i = 0; i < ids.length; i += 400) {
  const r = await pg.evaluate(async (batch) => {
    const res = [];
    await Promise.all(batch.map(async id => { const im = new Image(); im.src = '/build/art/' + id + '.jpg'; try { await im.decode(); } catch { return; } const f = idf.feat(im); res.push([id, Array.from(f.art)]); }));
    return res;
  }, ids.slice(i, i + 400));
  for (const [id, v] of r) { okIds.push(id); fs.writeSync(out, Buffer.from(new Float32Array(v).buffer)); }
  process.stderr.write(`\r${okIds.length}/${ids.length}`);
}
fs.closeSync(out); fs.writeFileSync('build/artvec_ids.json', JSON.stringify(okIds)); await br.close(); srv.kill();
