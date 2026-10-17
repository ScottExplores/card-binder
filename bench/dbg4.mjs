import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { spawn } from 'child_process';
const truth = JSON.parse(fs.readFileSync('bench/truth.json')).filter(t=>t.mode==='single').filter(t=>t.file.includes(process.env.F||''));
const srv = spawn('python3', ['-m', 'http.server', '8770'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const pg = await br.newPage(); pg.on('console', m => m.text().startsWith('DBG') && console.log(m.text()));
await pg.goto('http://localhost:8770/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([])); await pg.evaluate(()=>window.__dbg=1);
for (const it of truth) { const r = await pg.evaluate(b => runBench(b), [it]); console.log('RES', it.file, it.cond, r[0].res[0]?.name, r[0].res[0]?.conf, r[0].res[0]?.ns, r[0].res[0]?.sim, r[0].res[0]?.art); }
await br.close(); srv.kill();
