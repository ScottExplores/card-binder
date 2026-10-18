// Video frame sources. Reads a recorded or uploaded clip frame by frame WITHOUT depending on real-time playback.
// Why: the old reader played a hidden 2px <video> at 2x and only advanced when the browser delivered a frame callback.
// iOS pauses media when you switch apps or lock the phone (and can refuse play() without telling us), so the callback
// never came again and the job sat at "Reading video... 1%" forever.
//
// 1) WebCodecs (iOS Safari 16.4+, Chrome, Android): demux MP4/MOV with mp4box.js, decode with VideoDecoder, step through
//    frames in order. Works for iPhone HEVC .mov and MediaRecorder MP4, any length, handles rotation, can start at any time
//    (resume), never waits on screen visibility.
// 2) Fallback (WebM, or a codec WebCodecs can't decode): <video> playback with a watchdog that re-plays a paused video,
//    nudges a stalled one, and fails with a clear error instead of hanging.
let mp4boxP = null;
const loadMp4box = () => mp4boxP ??= new Promise((res, rej) => {
  if (self.MP4Box) return res(self.MP4Box);
  const s = document.createElement('script'); s.src = new URL('../vendor/mp4box.all.min.js', import.meta.url).href;
  s.onload = () => self.MP4Box ? res(self.MP4Box) : rej(new Error('mp4box missing')); s.onerror = () => { mp4boxP = null; rej(new Error('Couldn’t load the video reader')); };
  document.head.appendChild(s);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function sniff(blob) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  const tag = String.fromCharCode(...b.slice(4, 8));
  return /^(ftyp|moov|mdat|wide|free|skip|pnot)$/.test(tag) ? 'mp4' : 'other';
}

export async function openSource(blob, { prefer = 'auto', log = () => {} } = {}) {
  if (typeof blob === 'string') blob = await (await fetch(blob)).blob();
  const kind = await sniff(blob);
  if (prefer !== 'playback' && kind === 'mp4' && self.VideoDecoder && self.EncodedVideoChunk) {
    try { return await openWebCodecs(blob, log); } catch (e) { log('webcodecs unavailable: ' + e.message); }
  }
  return openPlayback(blob, log);
}

// ---------- 1) WebCodecs
async function openWebCodecs(blob, log) {
  const MP4Box = await loadMp4box();
  const file = MP4Box.createFile(); let info = null, perr = null;
  file.onReady = i => { info = i; }; file.onError = e => { perr = e; };
  // feed the file to the parser; it skips over the media data and asks for the next box, so only the index is read
  // (a fragmented MediaRecorder MP4 keeps its index spread through the file, so that one is read fully)
  let pos = 0; const CH = 1 << 20; let guard = 0;
  while (pos < blob.size && guard++ < 100000) {
    const buf = await blob.slice(pos, Math.min(blob.size, pos + CH)).arrayBuffer(); buf.fileStart = pos;
    const next = file.appendBuffer(buf);
    if (perr) throw new Error('Bad video file: ' + perr);
    const fragmented = info && info.isFragmented;
    if (info && !fragmented) break;
    pos = next > pos ? next : pos + buf.byteLength;
  }
  file.flush();
  if (!info) throw new Error('No video index found');
  const tr = info.videoTracks[0]; if (!tr) throw new Error('No video track');
  const trak = file.getTrackById(tr.id);
  const samples = trak.samples.map(s => ({ off: s.offset, size: s.size, cts: s.cts, dur: s.duration, sync: s.is_sync, ts: s.timescale }));
  if (!samples.length) throw new Error('Video has no frames');
  let desc;
  for (const e of trak.mdia.minf.stbl.stsd.entries) { const box = e.avcC || e.hvcC || e.vpcC || e.av1C; if (box) { const st = new self.DataStream(undefined, 0, self.DataStream.BIG_ENDIAN); box.write(st); desc = new Uint8Array(st.buffer, 8); break; } }
  const config = { codec: tr.codec.startsWith('vp08') ? 'vp8' : tr.codec, codedWidth: tr.video.width, codedHeight: tr.video.height, ...(desc ? { description: desc } : {}), optimizeForLatency: false };
  const sup = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error('Codec not supported: ' + tr.codec);
  const m = tr.matrix || [65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30];
  const rot = ((Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI) % 360) + 360) % 360; // 90 = iPhone portrait
  const W0 = tr.video.width, H0 = tr.video.height; const swap = rot === 90 || rot === 270;
  samples.sort((a, b) => a.cts - b.cts || a.off - b.off);
  const decodeOrder = trak.samples.map(s => ({ off: s.offset, size: s.size, cts: s.cts, dur: s.duration, sync: s.is_sync, ts: s.timescale }));
  const ts = samples[0].ts; const t0 = samples[0].cts / ts;
  const last = samples[samples.length - 1]; const duration = Math.max(0.01, (last.cts + last.dur) / ts - t0);
  file.stop?.();
  log(`webcodecs ${tr.codec} ${W0}x${H0} rot ${rot} ${samples.length} frames ${duration.toFixed(1)}s`);
  const src = {
    kind: 'webcodecs', codec: tr.codec, duration, width: swap ? H0 : W0, height: swap ? W0 : H0, rotation: rot,
    // draw a frame upright into a canvas context at w x h
    draw(g, f, w, h) {
      if (!rot) return g.drawImage(f, 0, 0, w, h);
      g.save(); g.translate(w / 2, h / 2); g.rotate(rot * Math.PI / 180); const dw = swap ? h : w, dh = swap ? w : h; g.drawImage(f, -dw / 2, -dh / 2, dw, dh); g.restore();
    },
    pause() { }, close() { },
    // yields { t, frame } at roughly every `step` seconds (or at the listed `times`), starting at `from`
    async *frames({ step = 0.1, from = 0, times = null, signal } = {}) {
      const want = times ? [...times].sort((a, b) => a - b) : null; let wi = 0;
      let nextT = want ? want[0] : from;
      // start decoding at the keyframe before `from`
      let start = 0, bestC = -1; for (let i = 0; i < decodeOrder.length; i++) { const s = decodeOrder[i]; if (s.sync && s.cts / ts - t0 <= nextT + 0.001 && s.cts > bestC) { bestC = s.cts; start = i; } }
      const out = []; let err = null, flushed = false;
      const take = f => { // decide whether this decoded frame is one we want
        const t = f.timestamp / 1e6 - t0;
        if (want) { if (wi >= want.length) { f.close(); return null; } if (t + 0.017 < want[wi]) { f.close(); return null; } while (wi < want.length && want[wi] <= t + 0.017) wi++; return t; }
        if (t + 0.004 < nextT) { f.close(); return null; } nextT = t + step - 0.004; return t;
      };
      // unwanted frames are closed the moment they come out: phones have a small pool of decoder frames
      const dec = new VideoDecoder({ output: f => { const t = take(f); if (t != null) out.push({ t, f }); }, error: e => { err = e; } });
      dec.configure(config);
      try {
        let i = start; let buf = null, bufOff = 0, bufEnd = 0;
        const read = async s => { // batched reads (up to 4 MB of consecutive samples)
          if (!buf || s.off < bufOff || s.off + s.size > bufEnd) { let end = s.off + s.size, j = i; while (j + 1 < decodeOrder.length && decodeOrder[j + 1].off >= s.off && decodeOrder[j + 1].off + decodeOrder[j + 1].size - s.off < 4 << 20) { j++; end = Math.max(end, decodeOrder[j].off + decodeOrder[j].size); } bufOff = s.off; bufEnd = end; buf = new Uint8Array(await blob.slice(bufOff, bufEnd).arrayBuffer()); }
          return buf.subarray(s.off - bufOff, s.off - bufOff + s.size);
        };
        while (true) {
          if (signal?.aborted) throw new Error('Cancelled');
          if (err) throw err;
          while (out.length) { const { t, f } = out.shift(); try { yield { t, frame: f }; } finally { f.close(); } if (want && wi >= want.length && !out.length) return; }
          if (i >= decodeOrder.length) { if (!flushed) { flushed = true; await dec.flush(); continue; } break; }
          if (dec.decodeQueueSize > 6 || out.length > 1) { await new Promise(r => { dec.addEventListener?.('dequeue', r, { once: true }); setTimeout(r, 20); }); continue; }
          const s = decodeOrder[i]; const data = await read(s); i++;
          dec.decode(new EncodedVideoChunk({ type: s.sync ? 'key' : 'delta', timestamp: Math.round(s.cts * 1e6 / ts), duration: Math.round(s.dur * 1e6 / ts), data }));
          if (dec.decodeQueueSize > 2 && !out.length) await sleep(0);
        }
        if (err) throw err;
      } finally { out.forEach(f => f.close()); if (dec.state !== 'closed') try { dec.close(); } catch { } }
    }
  };
  return src;
}

// ---------- 2) <video> playback with a watchdog
async function openPlayback(blob, log) {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
  const url = URL.createObjectURL(blob); v.src = url;
  v.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(v);
  const cleanup = () => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); URL.revokeObjectURL(url); };
  const ev = (name, ms, msg) => new Promise((res, rej) => { const t = setTimeout(() => { off(); rej(new Error(msg)); }, ms); const ok = () => { off(); res(); }; const bad = () => { off(); rej(new Error('Can’t read that video (format not supported on this phone)')); }; const off = () => { clearTimeout(t); v.removeEventListener(name, ok); v.removeEventListener('error', bad); }; v.addEventListener(name, ok); v.addEventListener('error', bad); });
  try {
    await ev('loadedmetadata', 20000, 'The video didn’t open (timed out)');
    if (!isFinite(v.duration)) { // MediaRecorder WebM has no duration until you seek to the end
      v.currentTime = 1e9; await ev('durationchange', 15000, 'Couldn’t find the video length').catch(() => {}); v.currentTime = 0; await ev('seeked', 8000, 'seek').catch(() => {});
    }
  } catch (e) { cleanup(); throw e; }
  const duration = isFinite(v.duration) ? v.duration : 0; log(`playback ${v.videoWidth}x${v.videoHeight} ${duration.toFixed(1)}s`);
  let holdPlay = false;
  return {
    kind: 'playback', duration, width: v.videoWidth, height: v.videoHeight, rotation: 0,
    draw(g, f, w, h) { g.drawImage(f, 0, 0, w, h); },
    pause() { holdPlay = true; v.pause(); },
    close: cleanup,
    async *frames({ step = 0.1, from = 0, times = null, signal, rate = 2 } = {}) {
      if (times) { // random access by seeking (used for a short list of picked moments)
        for (const t of [...times].sort((a, b) => a - b)) {
          if (signal?.aborted) throw new Error('Cancelled');
          v.currentTime = Math.min(t, Math.max(0, duration - 0.01)); await ev('seeked', 10000, 'Seeking in the video timed out');
          if (v.requestVideoFrameCallback) await Promise.race([new Promise(r => v.requestVideoFrameCallback(r)), sleep(300)]);
          yield { t: v.currentTime, frame: v };
        }
        return;
      }
      if (from > 0) { v.currentTime = from; await ev('seeked', 10000, 'Seeking in the video timed out'); }
      v.playbackRate = rate; let last = -1, lastProg = performance.now(), lastCT = v.currentTime, stalls = 0, ended = false;
      v.onended = () => { ended = true; };
      const kick = () => v.play().catch(e => log('play() refused: ' + e.name));
      kick();
      while (true) {
        if (signal?.aborted) { v.pause(); throw new Error('Cancelled'); }
        if (document.hidden) { v.pause(); await new Promise(r => { const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } }; document.addEventListener('visibilitychange', f); }); lastProg = performance.now(); kick(); }
        const t = v.currentTime;
        if (t !== lastCT) { lastCT = t; lastProg = performance.now(); stalls = 0; }
        if (t - last >= step - 0.005) { last = t; holdPlay = false; yield { t, frame: v }; if (!ended && (v.paused || holdPlay)) { holdPlay = false; kick(); } }
        if (ended || (duration && t >= duration - 0.02)) break;
        if (v.paused && !ended) kick();
        if (performance.now() - lastProg > 6000) { // stalled: nudge, then give up with a clear error
          stalls++; lastProg = performance.now(); log('stall ' + stalls);
          if (stalls > 3) { v.pause(); throw new Error('The video stopped playing on this phone. Tap Retry.'); }
          try { v.currentTime = t + 0.05; } catch { } kick();
        }
        await Promise.race([new Promise(r => v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : setTimeout(r, 16)), sleep(40)]);
      }
      v.pause();
    }
  };
}
