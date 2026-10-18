// Probe: what codecs/APIs WebKit (Safari engine) and Chrome have here
import { webkit, chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const port = 8899; const srv = spawn('python3', ['-m', 'http.server', String(port)], { stdio: 'ignore', cwd: process.cwd() }); await new Promise(r => setTimeout(r, 800));
for (const [name, bt] of [['webkit', webkit], ['chrome', chromium]]) {
  const br = await bt.launch(name === 'chrome' ? { executablePath: '/usr/bin/google-chrome' } : {});
  const pg = await br.newPage(); await pg.goto(`http://localhost:${port}/bench/bench.html`);
  const r = await pg.evaluate(async () => {
    const v = document.createElement('video');
    const out = { ua: navigator.userAgent, mp4: v.canPlayType('video/mp4; codecs="avc1.640028"'), hevc: v.canPlayType('video/mp4; codecs="hvc1.1.6.L150.B0"'), webm: v.canPlayType('video/webm; codecs="vp8"'), VideoDecoder: !!window.VideoDecoder, rvfc: !!HTMLVideoElement.prototype.requestVideoFrameCallback, wakeLock: !!navigator.wakeLock, bgfetch: 'BackgroundFetchManager' in window, sync: 'SyncManager' in window, offscreen: !!window.OffscreenCanvas };
    if (window.VideoDecoder) { out.avcDec = (await VideoDecoder.isConfigSupported({ codec: 'avc1.640028' }).catch(e => ({ supported: String(e) }))).supported; out.hevcDec = (await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L150.B0' }).catch(e => ({ supported: String(e) }))).supported; }
    for (const f of ['deck1s_h264.mov', 'deck1s_hevc4k.mov', 'deck1s_frag.mp4']) { const x = document.createElement('video'); x.muted = true; x.src = '/bench/phone/' + f; out[f] = await new Promise(r => { x.onloadedmetadata = () => r(x.duration + ' ' + x.videoWidth + 'x' + x.videoHeight); x.onerror = () => r('err ' + x.error?.code); setTimeout(() => r('timeout'), 8000); }); }
    return out;
  });
  console.log(name, JSON.stringify(r, null, 1)); await br.close();
}
srv.kill();
