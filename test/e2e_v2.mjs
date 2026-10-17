// New-feature E2E: live lock timing, price check, background video job (close, navigate, reload, reopen, cancel), export sheet, Back closes sheets.
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import assert from 'assert';
const y4m = process.argv[2] || '/tmp/cam.y4m', vid = process.argv[3] || 'bench/video2.mp4';
const srv = spawn('python3', ['-m', 'http.server', '8774', '-d', 'public'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const BASE = process.env.BASE || 'http://localhost:8774/';
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m] });
const pg = await br.newPage(); await pg.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && !/scryfall|Failed to load resource/i.test(m.text()) && errs.push(m.text()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await pg.goto(BASE); await pg.waitForFunction(() => document.querySelector('#scan-status').textContent === 'Ready', { timeout: 120000 });
const cdp = await pg.target().createCDPSession();
if (!process.env.SKIP_LOCK) {
  await pg.click('#btn-startcam').catch(() => {}); await pg.waitForFunction(() => window.__live.ready, { timeout: 60000 }); await sleep(1000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const w of pg.workers()) { try { await w.client.send('Emulation.setCPUThrottlingRate', { rate: 4 }); console.log('throttled worker', w.url().split('/').pop()); } catch (e) { console.log('worker throttle n/a', e.message); } }
  const lock = [];
  for (let k = 0; k < 5; k++) {
    await pg.evaluate(() => { window.__live.reset(); window.__live.ms = []; });
    await pg.waitForFunction(() => window.__live.lockAt > 0, { timeout: 30000 });
    lock.push(await pg.evaluate(() => { const L = window.__live; const m = L.ms.slice().sort((a, b) => a - b); return { first: Math.round(L.firstAt - L.camAt), lock: Math.round(L.lockAt - L.camAt), detMs: Math.round(m[m.length >> 1] || 0) }; }));
    await sleep(400);
  }
  console.log('live lock (4x throttle):', JSON.stringify(lock));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
} else { await pg.click('#btn-startcam').catch(() => {}); await sleep(1500); }
// price check
const before = await pg.evaluate(() => window.__app.binder.entries().length);
await pg.click('#tg-price'); await pg.click('#btn-shutter');
await pg.waitForFunction(() => !document.querySelector('#pcard').hidden, { timeout: 60000 }); await sleep(2500);
const pc = await pg.$eval('#pcard', e => e.innerText); console.log('price card:', pc.replace(/\s+/g, ' ').slice(0, 160));
assert.match(pc, /\$\d/); assert.equal(await pg.evaluate(() => window.__app.binder.entries().length), before, 'price check must not add');
await pg.screenshot({ path: 'screens/price-check.png' }); await pg.click('#tg-price');
// background video job
const inp = await pg.$('#vid-in'); await inp.uploadFile(vid);
await pg.waitForSelector('#rh'); await sleep(800); await pg.click('#sheet-x');
assert(await pg.$eval('#sheet', e => e.hidden), 'sheet closes while running');
await pg.click('.tabs [data-tab=binder]'); await sleep(1500);
const pillTxt = await pg.$eval('#job-pill', e => !e.hidden && e.textContent); console.log('pill while running:', pillTxt); assert.match(pillTxt, /Reading video/);
await pg.screenshot({ path: 'screens/job-pill.png' });
await pg.click('#job-pill'); await pg.waitForSelector('#rh'); await pg.click('#rh');
await pg.waitForFunction(() => /to review/.test(document.querySelector('#job-pill').textContent), { timeout: 600000 });
console.log('pill when done:', await pg.$eval('#job-pill', e => e.textContent));
await pg.reload(); await pg.waitForFunction(() => /to review/.test(document.querySelector('#job-pill').textContent) && !document.querySelector('#job-pill').hidden, { timeout: 60000 });
console.log('pill after reload:', await pg.$eval('#job-pill', e => e.textContent));
await pg.click('#job-pill'); await pg.waitForSelector('#rv-add'); await sleep(1500); await pg.screenshot({ path: 'screens/video-review.png' });
const n0 = await pg.evaluate(() => window.__app.binder.totals().count);
await pg.click('#rv-add'); await sleep(800);
const n1 = await pg.evaluate(() => window.__app.binder.totals().count); console.log('binder count', n0, '->', n1); assert(n1 > n0);
assert(await pg.$eval('#job-pill', e => e.hidden), 'pill gone after adding');
await pg.waitForFunction(() => document.querySelector('#scan-status').textContent.length > 0);
await pg.click('.tabs [data-tab=scan]'); const inp2 = await pg.$('#vid-in'); await inp2.uploadFile(vid); await pg.waitForSelector('#rc'); await sleep(1500); await pg.click('#rc'); await sleep(2000);
assert(await pg.$eval('#job-pill', e => e.hidden), 'pill gone after cancel'); console.log('cancel ok');
await pg.click('.tabs [data-tab=value]'); await pg.click('#btn-export'); await pg.waitForSelector('.exp button');
console.log('export options:', await pg.$$eval('.exp button', b => b.map(x => x.textContent).join(' | ')));
await pg.screenshot({ path: 'screens/export.png' });
await pg.goBack(); await sleep(500); assert(await pg.$eval('#sheet', e => e.hidden), 'back button closes sheet'); console.log('back closes sheet ok');
console.log('errors:', errs); assert(!errs.length);
await br.close(); srv.kill(); console.log('E2E v2 OK');
