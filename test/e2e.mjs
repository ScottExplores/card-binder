// End-to-end UI test in headless Chrome with a fake camera feed (Pixel-sized viewport).
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs'; import assert from 'assert';
const y4m = process.argv[2] || '/tmp/cam.y4m', shots = process.argv[3] || 'screens';
const srv = spawn('python3', ['-m', 'http.server', '8766', '-d', 'public'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m] });
const pg = await br.newPage(); await pg.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
await pg.goto(process.env.BASE || 'http://localhost:8766/'); 
await pg.waitForFunction(() => document.querySelector('#scan-status').textContent === 'Ready', { timeout: 120000 });
await pg.click('#btn-startcam'); await pg.waitForFunction(() => document.querySelector('#video').videoWidth > 0);
await new Promise(r => setTimeout(r, 1500));
await pg.click('#btn-shutter');
await pg.waitForFunction(() => document.querySelectorAll('#tray .titem').length > 0, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
const trayName = await pg.$eval('#tray .titem .nm', e => e.textContent); console.log('scanned:', trayName, '|', await pg.$eval('#scan-status', e => e.textContent));
await pg.screenshot({ path: `${shots}/scan.png` });
// binder has the card
await pg.click('.tabs [data-tab=binder]'); await pg.waitForSelector('#list .li');
const n1 = await pg.$$eval('#list .li', l => l.length); assert.equal(n1, 1);
// add a duplicate by scanning again -> qty 2, still one row
await pg.click('.tabs [data-tab=scan]'); await new Promise(r => setTimeout(r, 300)); await pg.click('#btn-shutter');
await pg.waitForFunction(() => document.querySelectorAll('#tray .titem').length > 1, { timeout: 60000 });
await pg.evaluate(() => __app.show('binder')); const q = await pg.evaluate(() => __app.binder.entries()[0].qty); assert.equal(q, 2, 'duplicate merges into qty');
// undo the last scan
await pg.evaluate(async () => { await __app.binder.undo(); }); assert.equal(await pg.evaluate(() => __app.binder.entries()[0].qty), 1, 'undo');
// detail sheet + change printing
await pg.click('#list .li'); await pg.waitForSelector('#chg'); await pg.click('#chg'); await pg.waitForSelector('.pr');
await pg.screenshot({ path: `${shots}/printing.png` });
const prints = await pg.$$eval('.pr', l => l.length); console.log('printings offered:', prints);
await pg.mouse.click(200, 20); await new Promise(r => setTimeout(r, 500)); if (await pg.evaluate(() => !!document.querySelector('#chg'))) { await pg.mouse.click(200, 20); await new Promise(r => setTimeout(r, 500)); } assert.equal(await pg.evaluate(() => __app.binder.entries().length), 1, 'closing sheet keeps card');
// import a ManaBox CSV
const csv = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency\n"Sol Ring",C21,Commander 2021,263,normal,uncommon,2,1,,0,false,false,near_mint,en,USD\nNecropotence,ICE,Ice Age,154,normal,rare,1,2,,0,false,false,near_mint,en,USD\nNot A Real Card,XXX,,1,normal,common,1,3,,0,false,false,near_mint,en,USD\n';
fs.writeFileSync('/tmp/mb.csv', csv);
await pg.click('.tabs [data-tab=value]'); const inp = await pg.$('#imp'); await inp.uploadFile('/tmp/mb.csv'); await new Promise(r => setTimeout(r, 1500));
const ents = await pg.evaluate(() => __app.binder.entries().map(e => [e.name, e.set, e.qty]));
console.log('after import:', JSON.stringify(ents)); assert(ents.some(e => e[0] === 'Sol Ring' && e[2] === 2)); assert.equal(ents.length, 3); assert(ents.some(e => e[0] === 'Necropotence' && e[1] === 'ice'));
await pg.screenshot({ path: `${shots}/value.png` }); if (process.env.DBG) console.log('tabs', await pg.evaluate(() => JSON.stringify(document.querySelector('.tabs [data-tab=binder]')?.getBoundingClientRect())), await pg.evaluate(() => [...document.querySelectorAll('.tabs button')].map(b => b.dataset.tab)));
await pg.click('.tabs [data-tab=binder]'); await new Promise(r => setTimeout(r, 400)); if (process.env.DBG) { await pg.screenshot({ path: '/tmp/dbg.png' }); console.log(await pg.evaluate(() => JSON.stringify(document.querySelector('#view-seg').getBoundingClientRect()))); } await pg.click('#view-seg [data-v=pages]'); await new Promise(r => setTimeout(r, 2500)); await pg.screenshot({ path: `${shots}/binder-pages.png` });
await pg.click('#view-seg [data-v=list]'); await new Promise(r => setTimeout(r, 1500)); await pg.screenshot({ path: `${shots}/binder-list.png` });
// binder page: 3x3 photo through the Photo picker
await pg.click('.tabs [data-tab=scan]'); await pg.click('#mode-seg [data-mode=grid3]');
const before = await pg.evaluate(() => __app.binder.totals().count);
const fi = await pg.$('#file-in'); await fi.uploadFile(process.env.GRID || 'bench/scenes/g3_002.jpg');
await pg.waitForFunction(b => __app.binder.totals().count >= b + 7, { timeout: 90000 }, before).catch(() => {});
const added = (await pg.evaluate(() => __app.binder.totals().count)) - before; console.log('3x3 page added:', added, '|', await pg.$eval('#scan-status', e => e.textContent));
assert(added >= 7, 'binder page scan');
await new Promise(r => setTimeout(r, 1500)); await pg.screenshot({ path: `${shots}/scan-3x3.png` });
console.log('errors:', errs.filter(e => !/favicon|404/.test(e)));
await br.close(); srv.kill(); console.log('E2E OK');
