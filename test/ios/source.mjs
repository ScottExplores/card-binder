// Frame-source check: node test/ios/source.mjs <webkit|chrome> <file in bench/phone> [prefer]
import { webkit, chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
const [bn = 'webkit', file = 'deck1s_iphone_hevc.mov', prefer = 'auto'] = process.argv.slice(2);
const port = 8700 + Math.floor(Math.random() * 90); const srv = spawn('python3', ['-m', 'http.server', String(port)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 700));
const br = await (bn === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
const pg = await br.newPage(); pg.on('console', m => console.log('[pg]', m.text())); pg.on('pageerror', e => console.error('[pgerr]', e.message));
await pg.goto(`http://localhost:${port}/bench/bench.html`);
const r = await pg.evaluate(async ([url, prefer]) => {
  const { openSource } = await import('/public/js/vsource.js'); const t0 = performance.now();
  const blob = await (await fetch(url)).blob();
  const src = await openSource(blob, { prefer, log: m => console.log(m) }); const tOpen = performance.now() - t0;
  const c = document.createElement('canvas'); const sc = 400 / Math.max(src.width, src.height); c.width = src.width * sc | 0; c.height = src.height * sc | 0; const g = c.getContext('2d');
  let n = 0, snap = null, ts = [];
  for await (const { t, frame } of src.frames({ step: 0.1 })) { n++; ts.push(+t.toFixed(2)); if (!snap && t > 3.3) { src.draw(g, frame, c.width, c.height); snap = c.toDataURL('image/jpeg', 0.7); } }
  // resume from the middle
  let n2 = 0, first2 = null; for await (const { t } of src.frames({ step: 0.1, from: 6 })) { n2++; first2 ??= t; }
  let n3 = 0; for await (const { t } of src.frames({ times: [1, 2.5, 7.25] })) n3++;
  src.close();
  return { kind: src.kind, w: src.width, h: src.height, rot: src.rotation, dur: src.duration, n, first: ts.slice(0, 4), lastT: ts.at(-1), n2, first2, n3, openMs: tOpen | 0, ms: (performance.now() - t0) | 0, snap };
}, ['/bench/phone/' + file, prefer]);
fs.writeFileSync(`/tmp/snap_${bn}_${file}.jpg`, Buffer.from(r.snap.split(',')[1], 'base64')); delete r.snap;
console.log(JSON.stringify(r)); await br.close(); srv.kill();
