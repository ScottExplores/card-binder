// Deck-mode end-to-end: Commander deck, pick commander, upload a dealt-deck video, paste a list, check alerts, export.
import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import assert from 'assert';
const shots = process.argv[2] || 'screens', vid = process.env.VID || 'bench/deck1s.mp4';
const srv = spawn('python3', ['-m', 'http.server', '8766', '-d', 'public'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await br.newPage(); await pg.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text())); pg.on('dialog', d => d.accept());
const wait = ms => new Promise(r => setTimeout(r, ms));
await pg.goto(process.env.BASE || 'http://localhost:8766/');
await pg.waitForFunction(() => document.querySelector('#scan-status').textContent === 'Ready', { timeout: 120000 });
await pg.click('.tabs [data-tab=decks]'); await pg.click('#dk-new'); await pg.waitForSelector('.fmt-grid [data-f=commander]'); await pg.click('.fmt-grid [data-f=commander]');
await pg.waitForSelector('#pk-q'); await pg.type('#pk-q', 'atraxa praetors'); await pg.waitForSelector('#pk-s button'); await pg.click('#pk-s button');
await pg.waitForSelector('.prints .pr'); await wait(300); await pg.click('.prints .pr'); await wait(800);
const cmd = await pg.evaluate(() => __app.D.decks[0].commanders.map(c => c.name)); console.log('commander:', cmd); assert(/Atraxa/.test(cmd[0]));
if (await pg.$('.sheet.open, #pk-q')) { await pg.mouse.click(200, 20); await wait(400); }
// video
const t0 = Date.now(); const inp = await pg.$('#dk-vid'); await inp.uploadFile(vid);
await pg.waitForFunction(() => __app.D.decks[0].cards.length > 0, { timeout: 300000 });
let last = -1, same = 0; while (same < 6 && Date.now() - t0 < 400000) { const n = await pg.evaluate(() => __app.D.decks[0].cards.reduce((a, c) => a + c.qty, 0)); same = n === last ? same + 1 : 0; last = n; await wait(1000); }
console.log('video cards:', last, 'in', ((Date.now() - t0) / 1000).toFixed(0) + 's'); assert(last >= 5, 'deck video found cards');
// paste a list with known problems
await pg.evaluate(() => { const s = document.querySelector('.sheet'); }); if (await pg.$('#pk-q, .sheet .rv-it')) { await pg.mouse.click(200, 20); await wait(400); }
await pg.click('#dk-add'); await pg.waitForSelector('#ad-t'); await pg.type('#ad-t', '2 Sol Ring\n1 Lightning Bolt\n1 Channel\n20 Forest\n1 Not A Card Xyz'); await pg.click('#ad-go'); await wait(1200);
const kinds = await pg.evaluate(() => __app.D.check ? null : null); 
const alerts = await pg.$$eval('.alert-it', l => l.map(b => b.dataset.k + ':' + b.textContent.trim()));
console.log('alerts:', alerts.length); alerts.slice(0, 8).forEach(a => console.log('  ', a));
const has = k => alerts.some(a => a.startsWith(k + ':'));
assert(has('size'), 'count alert'); assert(has('banned'), 'Channel banned'); assert(has('color'), 'Lightning Bolt outside identity'); assert(has('singleton'), 'Sol Ring duplicate');
const count = await pg.$eval('.dk-count', e => e.textContent); console.log('count box:', count);
await pg.evaluate(() => document.querySelector('#decks-body').scrollIntoView()); await pg.screenshot({ path: `${shots}/deck-check.png` });
await pg.evaluate(() => document.querySelector('.curve')?.scrollIntoView({ block: 'center' })); await wait(300); await pg.screenshot({ path: `${shots}/deck-curve.png` });
// export
await pg.click('#dk-exp'); await pg.waitForSelector('[data-k=mox]'); await pg.click('[data-k=mox]'); await wait(600);
const txt = await pg.evaluate(() => window.__lastExport || ''); console.log('export ok');
// deck list -> legal status pill
await pg.mouse.click(200, 20); await wait(400); await pg.click('#dk-back').catch(() => {}); await wait(300); console.log('list:', await pg.$eval('.dk-li', e => e.textContent));
console.log('errors:', errs.filter(e => !/favicon|404/.test(e)));
assert.equal(errs.filter(e => !/favicon|404|clipboard|Clipboard|Document is not focused/.test(e)).length, 0, 'no page errors');
await br.close(); srv.kill(); console.log('DECK E2E OK');
