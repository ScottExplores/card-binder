import puppeteer from 'puppeteer-core'; import { spawn } from 'child_process';
const srv = spawn('python3', ['-m', 'http.server', '8765'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 600000 });
const pg = await br.newPage(); pg.on('pageerror', e => console.log('ERR', e.message));
await pg.goto('http://localhost:8765/bench/bench.html'); await pg.waitForFunction('window.runBench'); await pg.evaluate(() => runBench([]));
console.log(await pg.evaluate(process.argv[2]));
await br.close(); srv.kill();
