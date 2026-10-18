// Video job e2e (Playwright): upload a phone-style clip in 1-card mode, leave mid-way (reload), come back, it resumes and
// finishes; cards land in Unsorted. node test/e2e_videojob.mjs <chrome|webkit> <video> [shotsDir]
import { webkit, chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import assert from 'assert';
const [bn = 'chrome', vid = 'bench/phone/deck1s_h264.mov', shots = 'qa/v3'] = process.argv.slice(2);
const port = 8400 + Math.floor(Math.random() * 90); const srv = spawn('python3', ['-m', 'http.server', String(port), '-d', 'public'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await (bn === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: bn === 'chrome', hasTouch: true });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => /video job|webcodecs|playback/.test(m.text()) && console.log('[pg]', m.text()));
const ready = () => pg.waitForFunction(() => /Ready/.test(document.querySelector('#scan-status').textContent), null, { timeout: 180000 });
await pg.goto(`http://localhost:${port}/`); await ready();
await pg.setInputFiles('#vid-in', vid);
await pg.waitForFunction(() => /Reading video… ([3-9]\d)%/.test(document.querySelector('#job-pill').textContent), null, { timeout: 300000 });
await pg.screenshot({ path: `${shots}/${bn}-job-running.png` });
const before = await pg.evaluate(() => document.querySelector('#job-pill').textContent);
// simulate the app being suspended and killed: reload the page mid-job
await pg.reload(); await pg.waitForFunction(() => /Continuing your video|Reading video/.test(document.body.innerText), null, { timeout: 120000 });
const resumedAt = await pg.evaluate(() => document.querySelector('#job-pill').textContent);
await pg.screenshot({ path: `${shots}/${bn}-job-resumed.png` });
await pg.waitForFunction(() => /Video done/.test(document.querySelector('#toast').textContent) || /to check/.test(document.querySelector('#job-pill').textContent), null, { timeout: 600000 });
await pg.screenshot({ path: `${shots}/${bn}-job-done.png` });
const ents = await pg.evaluate(() => window.__app.binder.entries().map(e => [e.name, e.qty, e.binder || 'Unsorted']));
const clip = await pg.evaluate(async () => { const { kvGet } = await import('./js/db.js'); return !!(await kvGet('clipJob')); });
const total = ents.reduce((a, e) => a + e[1], 0);
console.log(JSON.stringify({ bn, vid, before, resumedAt, cards: total, names: ents.map(e => e[0]), clipLeft: clip, errs }));
assert(total >= 11 && total <= 15, 'cards from the 13-card clip'); assert(!clip, 'clip cleaned up'); assert(ents.every(e => e[2] === 'Unsorted'));
await br.close(); srv.kill();
