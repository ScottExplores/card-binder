import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process'; import fs from 'fs';
const cards = JSON.parse(fs.readFileSync('bench/cards.json')); const per = +process.argv[2] || 25;
const groups = [...new Set(cards.map(c => c.group))]; const sel = groups.flatMap(g => cards.filter(c => c.group === g).slice(0, per));
const V = ['auto', 'white', 'dark', 'inv', 'tophat', 'blackhat'];
const srv = spawn('python3', ['-m', 'http.server', '8765'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 1800000 });
const pg = await br.newPage(); await pg.goto('http://localhost:8765/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
const res = await pg.evaluate((s, v) => variantBench(s, v), sel, V);
await br.close(); srv.kill();
for (const g of [...groups, 'all']) { const rs = res.filter(r => g === 'all' || r.group === g); const line = V.map(v => v + ' ' + (100 * rs.reduce((a, r) => a + r[v], 0) / rs.length).toFixed(0)); line.push('any ' + (100 * rs.filter(r => V.some(v => r[v])).length / rs.length).toFixed(0)); console.log(g.padEnd(9), rs.length, line.join('  ')); }
