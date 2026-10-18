// Record mode: process a video of cards (single cards or binder pages) entirely on the phone.
// Frames come from vsource.js (WebCodecs decode, or watched playback), so nothing depends on the page staying visible;
// progress is checkpointed so a job resumes where it stopped.
// Steps through the video, keeps the sharpest frame of each steady moment, detects every card, identifies, and dedupes.
import { detectCards } from './vision.js';
import { openSource } from './vsource.js';
import { db } from './carddb.js';

export async function processVideo(idf, blob, { step = 0.2, onProgress = () => {}, signal, resume = null, onCheckpoint = () => {}, source = null } = {}) {
  const cv = idf.cv; const t0 = performance.now();
  const src = source || await openSource(blob); const ownSrc = !source;
  try {
    const dur = src.duration; const W = src.width, H = src.height;
    const sc = Math.min(1, 1600 / Math.max(W, H)); const c = document.createElement('canvas'); c.width = W * sc | 0; c.height = H * sc | 0; const g = c.getContext('2d', { willReadFrequently: true });
    let picks, startI = 0, nFrames = 0; const seen = [];
    if (resume?.phase === 2) { picks = resume.picks; startI = resume.i; nFrames = resume.frames; for (const p of resume.seen) { const u = unpackRead(p); if (u) seen.push(u); } }
    else {
      // pass 1: sharpness + motion per sampled frame (cheap, 400px)
      const tiny = document.createElement('canvas'); const ts = 400 / Math.max(c.width, c.height); tiny.width = c.width * ts | 0; tiny.height = c.height * ts | 0; const tg = tiny.getContext('2d', { willReadFrequently: true });
      const frames = [];
      for await (const { t, frame } of src.frames({ step, from: 0.05, signal })) {
        src.draw(tg, frame, tiny.width, tiny.height);
        const { sharp, thumb } = measure(cv, tg, tiny);
        frames.push({ t, sharp, thumb }); onProgress(0.3 * Math.min(1, t / dur), 'Finding sharp frames…');
      }
      const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
      const scenes = []; let cur = [];
      frames.forEach((f, i) => { if (i && diff(f.thumb, frames[i - 1].thumb) > 14) { if (cur.length) scenes.push(cur); cur = []; } cur.push(f); }); if (cur.length) scenes.push(cur);
      const motion = frames.map((f, i) => i ? diff(f.thumb, frames[i - 1].thumb) : 0);
      scenes.forEach((sc, k) => sc.forEach(f => f.scene = k));
      let pk = scenes.map(sc => sc.reduce((a, b) => b.sharp > a.sharp ? b : a));
      for (const sc of scenes) for (let k = 0; k < sc.length; k += 6) { const win = sc.slice(k, k + 6); const b = win.reduce((a, x) => x.sharp > a.sharp ? x : a); if (!pk.includes(b)) pk.push(b); }
      const medSharp = frames.map(f => f.sharp).sort((a, b) => a - b)[frames.length >> 1] || 0;
      picks = pk.filter(f => f.sharp > medSharp * 0.35 && motion[frames.indexOf(f)] < 30).sort((a, b) => a.t - b.t).map(f => ({ t: f.t, scene: f.scene }));
      nFrames = frames.length;
      await onCheckpoint({ phase: 2, picks, i: 0, frames: nFrames, seen: [], pct: 0.3 });
    }
    // pass 2: detect + identify on picked frames (in time order, one decode pass)
    const ctrOf = q => [q.reduce((s, p) => s + p[0], 0) / 4 / c.width, q.reduce((s, p) => s + p[1], 0) / 4 / c.height];
    let i = startI;
    const todoT = picks.slice(startI).map(p => p.t);
    if (todoT.length) for await (const { frame } of src.frames({ times: todoT, signal })) {
      const f = picks[i]; src.draw(g, frame, c.width, c.height); src.pause();
      onProgress(0.3 + 0.7 * i / picks.length, `Reading frame ${i + 1} of ${picks.length}…`);
      const m = cv.matFromImageData(g.getImageData(0, 0, c.width, c.height));
      let quads = []; try { quads = detectCards(cv, m, { maxCards: 12, minAreaFrac: 0.01 }); } catch { } m.delete();
      const todo = [];
      for (const q of quads) { const cc = ctrOf(q); const k = seen.find(x => x.scene === f.scene && x.conf !== 'low' && Math.hypot(x.ctr[0] - cc[0], x.ctr[1] - cc[1]) < 0.06); if (k) seen.push({ ...k, t: f.t, ctr: cc, frame: i, reused: true }); else todo.push(q); } // reused reads are not counted as extra evidence
      if (todo.length) {
        const r = await idf.identifyCanvas(c, { mode: 'multi', quads: todo });
        for (const x of r.results) { if (!x.match) continue; seen.push({ ...x, thumb: thumbURL(x.cardCanvas), cardCanvas: null, t: f.t, ctr: ctrOf(x.quad), frame: i, scene: f.scene }); }
      }
      i++;
      await onCheckpoint({ phase: 2, picks, i, frames: nFrames, seen: seen.map(packRead), pct: 0.3 + 0.7 * i / picks.length });
      if (i >= picks.length) break;
    }
    return { cards: dedupe(seen), frames: nFrames, picked: picks.length, ms: performance.now() - t0, duration: dur, source: src.kind };
  } finally { if (ownSrc) src.close(); }
}
// sharpness (variance of Laplacian) and a 32x24 thumbnail for motion, from a small canvas
function measure(cv, tg, tiny) {
  const m = cv.matFromImageData(tg.getImageData(0, 0, tiny.width, tiny.height)); const gr = new cv.Mat(); cv.cvtColor(m, gr, cv.COLOR_RGBA2GRAY);
  const lap = new cv.Mat(); cv.Laplacian(gr, lap, cv.CV_32F); const mean = new cv.Mat(), sd = new cv.Mat(); cv.meanStdDev(lap, mean, sd); const sharp = sd.data64F[0] ** 2;
  const sm = new cv.Mat(); cv.resize(gr, sm, new cv.Size(32, 24), 0, 0, cv.INTER_AREA); const thumb = Uint8Array.from(sm.data);
  [m, gr, lap, mean, sd, sm].forEach(x => x.delete());
  return { sharp, thumb };
}
export function thumbURL(cc) { if (!cc) return null; const t = document.createElement('canvas'); t.width = 146; t.height = 204; t.getContext('2d').drawImage(cc, 0, 0, 146, 204); return t.toDataURL('image/jpeg', 0.6); }
// reads are checkpointed to IndexedDB as plain data (printing ids, no canvases) so a job can resume after the app is closed
export const packRead = r => ({ id: r.match.id, alts: (r.alts || []).slice(0, 20).map(a => a.id), conf: r.conf, imgSim: r.imgSim, combined: r.combined, printAmbiguous: !!r.printAmbiguous, viaArt: !!r.viaArt, detected: !!r.detected, nameScore: r.nameScore,
  thumb: r.thumb || null, t: r.t, start: r.start, end: r.end, ctr: r.ctr, frame: r.frame, scene: r.scene, reused: !!r.reused, sightings: r.sightings });
export function unpackRead(p) { const m = db().byId.get(p.id); if (!m) return null; return { ...p, match: m, alts: (p.alts || []).map(id => db().byId.get(id)).filter(Boolean) }; }

// Merge sightings of the same physical card. Same name within 3 s => same card, unless they appear in the same frame (duplicates on one page).
export function dedupe(seen) {
  const rank = { high: 3, medium: 2, low: 1 }; const groups = [];
  for (const s of seen.sort((a, b) => a.t - b.t)) {
    const g = groups.find(g => g.scene === s.scene && g.name === s.match.name && s.t - g.lastT < 3 && !g.frames.has(s.frame) && Math.hypot(g.ctr[0] - s.ctr[0], g.ctr[1] - s.ctr[1]) < 0.08);
    if (g) { g.lastT = s.t; g.frames.add(s.frame); g.ctr = s.ctr; if (!s.reused) g.n++; g.hits.push(s); continue; }
    groups.push({ scene: s.scene, name: s.match.name, lastT: s.t, frames: new Set([s.frame]), ctr: s.ctr, n: 1, hits: [s] });
  }
  // a low-confidence one-off next to a confident read of a different card at the same spot is usually a misread: keep it but unchecked
  return groups.map(g => {
    const best = g.hits.reduce((a, b) => ((rank[b.conf] - rank[a.conf]) || ((b.imgSim ?? 0) - (a.imgSim ?? 0))) > 0 ? b : a);
    const votes = {}; for (const h of g.hits.filter(h => !h.reused)) votes[h.match.id] = (votes[h.match.id] || 0) + rank[h.conf];
    const pid = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]; const pick = g.hits.find(h => h.match.id === pid) || best;
    const conf = g.n >= 2 && best.conf !== 'low' ? 'high' : best.conf;
    return { ...pick, conf, sightings: g.n, t: g.hits[0].t };
  });
}

// Deck mode: cards are dealt (or flipped) one at a time under the camera. Every steady "hold" between two movements is one card,
// so runs of the same card (basic lands) are counted correctly. The video is played through once (no seeking: phone videos seek slowly);
// the two sharpest full-size frames of each hold are kept, and the card is read as soon as the hold ends.
export async function processDeck(idf, blob, { step = 0.1, rate = 2, onProgress = () => {}, signal, T = {}, resume = null, onCheckpoint = () => {}, source = null } = {}) {
  const P = { hold: 4.5, bump: 9, minHold: 2, ...T };
  const cv = idf.cv; const t0 = performance.now();
  const src = source || await openSource(blob); const ownSrc = !source;
  try {
    const dur = src.duration; const W = src.width, H = src.height;
    const sc = Math.min(1, 1600 / Math.max(W, H)); const cw = W * sc | 0, ch = H * sc | 0;
    const slots = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return { c, g: c.getContext('2d', { willReadFrequently: true }), sharp: -1 }; });
    const tiny = document.createElement('canvas'); const ts = 320 / Math.max(cw, ch); tiny.width = cw * ts | 0; tiny.height = ch * ts | 0; const tg = tiny.getContext('2d', { willReadFrequently: true });
    const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    // resume: everything before the last finished card is already read; restart at the frame that ended it
    const motion = resume ? [...resume.motion] : [], reads = resume ? resume.reads.map(unpackRead).filter(Boolean) : [];
    let prev = null, n = resume ? resume.n : 0, hold = null, holds = resume ? resume.holds : 0;
    const from = resume ? resume.t : 0;
    const readHold = async h => {
      holds++; let best = null;
      for (const sl of slots.filter(x => x.sharp >= 0).sort((a, b) => b.sharp - a.sharp)) {
        const r = await idf.identifyCanvas(sl.c, { mode: 'single' }); const x = r.results[0];
        if (x?.match && (!best || rank(x) > rank(best))) best = x;
        if (best && best.conf === 'high') break;
        if (!x?.detected && !x?.match) break; // empty table: nothing to read here
      }
      if (window.__deckDbg) window.__deckDbg.push({ k: holds, conf: best?.conf, name: best?.match?.name, altIdx: best?.altIdx, tried: best?.tried, ms: best?.ms | 0 });
      if (best?.match && (best.detected || best.conf !== 'low')) reads.push({ ...best, thumb: thumbURL(best.cardCanvas), cardCanvas: null, t: h.t, start: h.start, end: h.end });
    };
    const sample = async (t, frame) => {
      src.draw(tg, frame, tiny.width, tiny.height);
      const { sharp, thumb } = measure(cv, tg, tiny);
      const mo = prev ? diff(thumb, prev) : 99; prev = thumb; motion[n] = mo; const i = n++;
      if (mo < P.hold) {
        if (!hold) { hold = { start: i, end: i, t, len: 0 }; slots.forEach(s => s.sharp = -1); }
        hold.end = i; hold.len++;
        const worst = slots.reduce((a, b) => a.sharp <= b.sharp ? a : b);
        if (sharp > worst.sharp) { src.draw(worst.g, frame, cw, ch); worst.sharp = sharp; }
      } else if (hold) {
        const h = hold; hold = null;
        if (h.len >= P.minHold) { src.pause(); await readHold(h); await onCheckpoint({ t, n: i, holds, motion: motion.slice(0, i), reads: reads.map(packRead), pct: Math.min(0.99, t / dur) }); }
      }
      else { hold = null; }
      // a hold can start on the moving frame's successor; also seed it with this frame's image
      if (mo >= P.hold) { hold = { start: i, end: i, t, len: 0 }; slots.forEach(s => s.sharp = -1); src.draw(slots[0].g, frame, cw, ch); slots[0].sharp = sharp * 0.5; }
      onProgress(Math.min(0.99, t / dur), `Reading… ${reads.length} card${reads.length === 1 ? '' : 's'} so far`);
    };
    for await (const { t, frame } of src.frames({ step, from, signal, rate })) await sample(t, frame);
    if (hold && hold.len >= P.minHold) { const h = hold; hold = null; await readHold(h); }
    // a hand bump splits one hold in two: same card, tiny gap, small movement => merge
    const out = [];
    for (const r of reads) {
      const prevR = out[out.length - 1];
      if (prevR && prevR.match.name === r.match.name) {
        const gap = motion.slice(prevR.end + 1, r.start + 1);
        if (gap.length <= 1 && Math.max(0, ...gap) < P.bump) { if (rank(r) > rank(prevR)) Object.assign(prevR, { ...r, start: prevR.start }); else prevR.end = r.end; prevR.sightings = (prevR.sightings || 1) + 1; continue; }
      }
      out.push({ ...r, sightings: 1 });
    }
    return { cards: out, frames: motion.length, holds, ms: performance.now() - t0, duration: dur, motion, source: src.kind };
  } finally { if (ownSrc) src.close(); }
}
const rank = x => ({ high: 3, medium: 2, low: 1 }[x.conf] || 0) + (x.imgSim || 0) * 0.5;
