// Record mode: process a video of cards (single cards or binder pages) entirely on the phone.
// Steps through the video, keeps the sharpest frame of each steady moment, detects every card, identifies, and dedupes.
import { detectCards } from './vision.js';

export async function processVideo(idf, blob, { step = 0.2, onProgress = () => {}, signal } = {}) {
  const cv = idf.cv; const t0 = performance.now();
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Can’t read that video')); });
  if (!isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => v.ondurationchange = r); } // MediaRecorder webm has no duration until seeked
  const dur = v.duration; const W = v.videoWidth, H = v.videoHeight;
  const sc = Math.min(1, 1600 / Math.max(W, H)); const c = document.createElement('canvas'); c.width = W * sc | 0; c.height = H * sc | 0; const g = c.getContext('2d', { willReadFrequently: true });
  const seek = t => new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } };
    v.onseeked = () => { if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(fin); setTimeout(fin, 400); } else fin(); };
    v.currentTime = Math.min(t, dur - 0.01); });
  document.body.appendChild(v); v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none';
  // pass 1: sharpness + card count per sampled frame (cheap, 400px)
  const tiny = document.createElement('canvas'); const ts = 400 / Math.max(c.width, c.height); tiny.width = c.width * ts | 0; tiny.height = c.height * ts | 0; const tg = tiny.getContext('2d', { willReadFrequently: true });
  const frames = [];
  for (let t = 0.05; t < dur; t += step) {
    if (signal?.aborted) throw new Error('Cancelled');
    await seek(t); tg.drawImage(v, 0, 0, tiny.width, tiny.height);
    const m = cv.matFromImageData(tg.getImageData(0, 0, tiny.width, tiny.height)); const gr = new cv.Mat(); cv.cvtColor(m, gr, cv.COLOR_RGBA2GRAY);
    const lap = new cv.Mat(); cv.Laplacian(gr, lap, cv.CV_32F); const mean = new cv.Mat(), sd = new cv.Mat(); cv.meanStdDev(lap, mean, sd); const sharp = sd.data64F[0] ** 2;
    const sm = new cv.Mat(); cv.resize(gr, sm, new cv.Size(32, 24), 0, 0, cv.INTER_AREA); const thumb = Uint8Array.from(sm.data);
    [m, gr, lap, mean, sd, sm].forEach(x => x.delete());
    frames.push({ t, sharp, thumb }); onProgress(0.3 * t / dur, 'Finding sharp frames…');
  }
  // split into "scenes" where the view barely changes; pick the sharpest frame of each scene
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  const scenes = []; let cur = [];
  frames.forEach((f, i) => { if (i && diff(f.thumb, frames[i - 1].thumb) > 14) { if (cur.length) scenes.push(cur); cur = []; } cur.push(f); }); if (cur.length) scenes.push(cur);
  const motion = frames.map((f, i) => i ? diff(f.thumb, frames[i - 1].thumb) : 0);
  scenes.forEach((sc, k) => sc.forEach(f => f.scene = k));
  let picks = scenes.map(sc => sc.reduce((a, b) => b.sharp > a.sharp ? b : a));
  // long scenes (slow sweep): also take sharp frames every ~1.2 s
  for (const sc of scenes) for (let k = 0; k < sc.length; k += 6) { const win = sc.slice(k, k + 6); const b = win.reduce((a, x) => x.sharp > a.sharp ? x : a); if (!picks.includes(b)) picks.push(b); }
  const medSharp = frames.map(f => f.sharp).sort((a, b) => a - b)[frames.length >> 1] || 0;
  picks = picks.filter(f => f.sharp > medSharp * 0.35 && motion[frames.indexOf(f)] < 30).sort((a, b) => a.t - b.t);
  // pass 2: detect + identify on picked frames
  const seen = []; // {name, print, t, ctr, conf, ...}
  for (let i = 0; i < picks.length; i++) {
    if (signal?.aborted) throw new Error('Cancelled');
    const f = picks[i]; await seek(f.t); g.drawImage(v, 0, 0, c.width, c.height);
    onProgress(0.3 + 0.7 * i / picks.length, `Reading frame ${i + 1} of ${picks.length}…`);
    const src = cv.matFromImageData(g.getImageData(0, 0, c.width, c.height));
    let quads = []; try { quads = detectCards(cv, src, { maxCards: 12, minAreaFrac: 0.01 }); } catch { } src.delete();
    if (!quads.length) continue;
    // skip cards already read confidently at the same spot in this scene; reuse that read as an extra sighting
    const ctrOf = q => [q.reduce((s, p) => s + p[0], 0) / 4 / c.width, q.reduce((s, p) => s + p[1], 0) / 4 / c.height];
    const todo = [];
    for (const q of quads) { const cc = ctrOf(q); const k = seen.find(x => x.scene === f.scene && x.conf !== 'low' && Math.hypot(x.ctr[0] - cc[0], x.ctr[1] - cc[1]) < 0.06); if (k) seen.push({ ...k, t: f.t, ctr: cc, frame: i }); else todo.push(q); }
    if (!todo.length) continue;
    const r = await idf.identifyCanvas(c, { mode: 'multi', quads: todo });
    for (const x of r.results) { if (!x.match) continue; const q = x.quad; const ctr = [q.reduce((s, p) => s + p[0], 0) / 4 / c.width, q.reduce((s, p) => s + p[1], 0) / 4 / c.height]; seen.push({ ...x, t: f.t, ctr, frame: i, scene: f.scene }); }
  }
  v.remove(); if (typeof blob !== 'string') URL.revokeObjectURL(v.src);
  return { cards: dedupe(seen), frames: frames.length, picked: picks.length, ms: performance.now() - t0, duration: dur };
}

// Merge sightings of the same physical card. Same name within 3 s => same card, unless they appear in the same frame (duplicates on one page).
export function dedupe(seen) {
  const rank = { high: 3, medium: 2, low: 1 }; const groups = [];
  for (const s of seen.sort((a, b) => a.t - b.t)) {
    const g = groups.find(g => g.name === s.match.name && s.t - g.lastT < 3 && !g.frames.has(s.frame) && Math.hypot(g.ctr[0] - s.ctr[0], g.ctr[1] - s.ctr[1]) < 0.5);
    if (g) { g.lastT = s.t; g.frames.add(s.frame); g.ctr = s.ctr; g.n++; g.hits.push(s); continue; }
    groups.push({ name: s.match.name, lastT: s.t, frames: new Set([s.frame]), ctr: s.ctr, n: 1, hits: [s] });
  }
  // a low-confidence one-off next to a confident read of a different card at the same spot is usually a misread: keep it but unchecked
  return groups.map(g => {
    const best = g.hits.reduce((a, b) => ((rank[b.conf] - rank[a.conf]) || ((b.imgSim ?? 0) - (a.imgSim ?? 0))) > 0 ? b : a);
    const votes = {}; for (const h of g.hits) votes[h.match.id] = (votes[h.match.id] || 0) + rank[h.conf];
    const pid = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]; const pick = g.hits.find(h => h.match.id === pid) || best;
    const conf = g.n >= 2 && best.conf !== 'low' ? 'high' : best.conf;
    return { ...pick, conf, sightings: g.n, t: g.hits[0].t };
  });
}
