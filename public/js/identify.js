// Card identification pipeline: detect -> warp -> OCR name -> local fuzzy match -> pick printing by image similarity.
import { detectCards, warpCard, gridQuads, CARD_W, CARD_H, RATIO } from './vision.js';
import { fuzzy } from './scry.js';
import { db, img as imgUrl, isOldFrame } from './carddb.js';
import { kvGet, kvSet } from './db.js';
import { loadArt, artSearch } from './artindex.js';

const NAME_BAND = { x0: 0.055, x1: 0.80, y0: 0.035, y1: 0.098 };

export class Identifier {
  constructor({ cv, Tesseract, names, NameIndex, workers = 2, base = './vendor/' }) {
    this.cv = cv; this.index = new NameIndex(names); this.T = Tesseract; this.nW = workers; this.base = base; this.featCache = new Map();
  }
  async init(progress) {
    this.artReady = loadArt(this.base.replace(/vendor\/?$/, 'data/art.bin')).then(() => true).catch(() => false);
    const T = this.T; this.sched = T.createScheduler();
    const opts = { workerPath: this.base + 'tess/worker.min.js', corePath: this.base + 'tess/', langPath: this.base + 'lang', gzip: true, cacheMethod: 'write' };
    await Promise.all(Array.from({ length: this.nW }, async () => {
      const w = await T.createWorker('eng', 1, opts);
      await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz,'- ", preserve_interword_spaces: '1' });
      this.sched.addWorker(w); progress && progress();
    }));
  }
  // ---------- image helpers
  matToCanvas(m) { const c = mk(m.cols, m.rows); const g = c.getContext('2d'); const id = new ImageData(new Uint8ClampedArray(m.data), m.cols, m.rows); g.putImageData(id, 0, 0); return c; }
  // Build a binarised/normalised crop of the title bar. variant: 'auto' | 'inv' | 'white' | 'dark'
  bandCanvas(card, band, variant = 'auto', rot = false) {
    const W = card.width, H = card.height; const sx = band.x0 * W, sy = band.y0 * H, sw = (band.x1 - band.x0) * W, sh = (band.y1 - band.y0) * H;
    const scale = 64 / sh; const c = mk(Math.round(sw * scale), 64); const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    if (rot) { g.translate(c.width, c.height); g.rotate(Math.PI); g.drawImage(card, W - sx - sw, H - sy - sh, sw, sh, 0, 0, c.width, c.height); g.setTransform(1, 0, 0, 1, 0, 0); }
    else g.drawImage(card, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data, n = d.length / 4; const L = new Uint8Array(n), S = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; L[i] = (r * 0.3 + gg * 0.59 + b * 0.11) | 0; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); S[i] = mx ? ((mx - mn) * 255 / mx) | 0 : 0; }
    const sorted = Array.from(L).sort((a, b) => a - b); const lo = sorted[(n * 0.02) | 0], hi = sorted[(n * 0.98) | 0], med = sorted[n >> 1];
    for (let i = 0; i < n; i++) {
      let v;
      if (variant === 'white') v = (L[i] > Math.max(150, hi - 60) && S[i] < 120) ? 0 : 255; // light text (old frames, dark title bars)
      else if (variant === 'dark') v = L[i] < Math.min(90, lo + 50) ? 0 : 255;           // dark text on light bar
      else { v = (L[i] - lo) * 255 / Math.max(1, hi - lo); v = v < 0 ? 0 : v > 255 ? 255 : v; const inv = variant === 'inv' ? med > 128 : (variant === 'tophat' || variant === 'blackhat') ? false : med < 110; if (inv) v = 255 - v; }
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    if (variant === 'tophat' || variant === 'blackhat') { // remove textured backgrounds: keep thin light (tophat) or dark (blackhat) strokes
      const cv = this.cv; const m = cv.matFromImageData(g.getImageData(0, 0, c.width, c.height)); const gr = new cv.Mat(); cv.cvtColor(m, gr, cv.COLOR_RGBA2GRAY);
      const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(17, 17)); const o = new cv.Mat();
      cv.morphologyEx(gr, o, variant === 'tophat' ? cv.MORPH_TOPHAT : cv.MORPH_BLACKHAT, k);
      cv.threshold(o, o, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      const rgba = new cv.Mat(); cv.cvtColor(o, rgba, cv.COLOR_GRAY2RGBA); g.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), c.width, c.height), 0, 0);
      [m, gr, k, o, rgba].forEach(x => x.delete());
    }
    const p = mk(c.width + 24, c.height + 16); const pg = p.getContext('2d'); pg.fillStyle = '#fff'; pg.fillRect(0, 0, p.width, p.height); pg.drawImage(c, 12, 8); return p;
  }
  async ocr(canvas) { const r = await this.sched.addJob('recognize', canvas); return { text: r.data.text.trim(), conf: r.data.confidence }; }
  feat(img) { // 24x34 RGB, zero-mean/unit-var per channel + art box 16x12
    const a = mk(96, 134); const g = a.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, 96, 134);
    const b = mk(24, 34); const gb = b.getContext('2d', { willReadFrequently: true }); gb.imageSmoothingQuality = 'high'; gb.drawImage(a, 0, 0, 24, 34);
    const full = gb.getImageData(0, 0, 24, 34).data;
    const c = mk(16, 12); const gc = c.getContext('2d', { willReadFrequently: true }); gc.imageSmoothingQuality = 'high'; gc.drawImage(a, 96 * 0.1, 134 * 0.12, 96 * 0.8, 134 * 0.42, 0, 0, 16, 12);
    const art = gc.getImageData(0, 0, 16, 12).data;
    return { full: normVec(full), art: normVec(art) };
  }
  sim(f1, f2) { return 0.45 * dot(f1.full, f2.full) + 0.55 * dot(f1.art, f2.art); }
  async printFeat(card) {
    if (this.featCache.has(card.id)) return this.featCache.get(card.id);
    const p = (async () => {
      const k = 'ft:' + card.id; const c = await kvGet(k); if (c) return { full: new Float32Array(c.full), art: new Float32Array(c.art) };
      if (card.noimg) return null; const url = imgUrl(card, 'small'); if (!url) return null;
      const im = await loadImg(url).catch(() => null); if (!im) return null;
      const f = this.feat(im); kvSet(k, { full: Array.from(f.full), art: Array.from(f.art) }); return f;
    })();
    this.featCache.set(card.id, p); return p;
  }
  // ---------- main
  async identifyCanvas(input, { mode = 'single', guide = null } = {}) {
    const cv = this.cv; const t0 = performance.now();
    const src = toMat(cv, input);
    const n = mode === 'grid3' ? 9 : mode === 'grid2' ? 4 : 1;
    let quads = detectCards(cv, src, { maxCards: n === 1 ? 3 : n + 2, minAreaFrac: n === 9 ? 0.012 : n === 4 ? 0.03 : 0.06 });
    if (n === 1) {
      // choose the most central big quad, else fall back to the guide box
      if (quads.length > 1) quads.sort((a, b) => qarea(b) - qarea(a)); // biggest card in view
      quads = quads.slice(0, 1).map(q => ({ q, detected: true }));
      if (!quads.length) quads = [{ q: guide || centerQuad(src.cols, src.rows), detected: false }];
    } else {
      const cols = Math.sqrt(n), cells = gridQuads(src.cols, src.rows, cols, cols, 0.03);
      const slot = new Array(n).fill(null);
      for (const q of quads) { const c = ctr(q); let bi = -1, bd = 1e9; cells.forEach((cell, i) => { const d = Math.hypot(ctr(cell)[0] - c[0], ctr(cell)[1] - c[1]); if (d < bd) { bd = d; bi = i; } }); if (!slot[bi]) slot[bi] = { q, detected: true }; }
      quads = slot.map((s, i) => s || { q: cells[i], detected: false });
    }
    const tDetect = performance.now() - t0;
    const results = await Promise.all(quads.map(async ({ q, detected }, i) => {
      const w = warpCard(cv, src, q); const card = this.matToCanvas(w); w.delete();
      let r = await this.identifyCard(card); let used = q, cardC = card;
      const alts = [q.inner, shrink(q, 0.03)].filter(Boolean);
      for (const aq of alts) { // sleeve edge / loose crop: retry tighter if not confident
        if (r.conf === 'high') break;
        const w2 = warpCard(cv, src, aq); const c2 = this.matToCanvas(w2); w2.delete();
        const r2 = await this.identifyCard(c2);
        if (r2.match && (!r.match || (r2.combined ?? -9) > (r.combined ?? -9))) { r = r2; used = aq; cardC = c2; }
      }
      return { ...r, quad: used, detected, slot: i, cardCanvas: cardC };
    }));
    src.delete();
    return { results: results.filter(r => r.match || r.detected), ms: performance.now() - t0, tDetect };
  }
  // OCR the title bar with several preprocessing variants and pool the candidate names.
  async readName(card) {
    const B2 = { ...NAME_BAND, y0: 0.025, y1: 0.105 };
    const stages = [
      [['white', NAME_BAND], ['dark', NAME_BAND], ['auto', NAME_BAND]],
      [['tophat', NAME_BAND], ['blackhat', NAME_BAND], ['inv', NAME_BAND], ['white', B2], ['auto', B2]],
      [['white', NAME_BAND, true], ['dark', NAME_BAND, true], ['auto', NAME_BAND, true]],
    ];
    const pool = new Map(); const texts = [];
    const addC = (c, rot) => { const k = c.full; const e = pool.get(k); if (!e) pool.set(k, { full: k, score: c.score, votes: 1, rot }); else { e.votes++; if (c.score < e.score) e.score = c.score; } };
    for (const st of stages) {
      const outs = await Promise.all(st.map(([v, b, rot]) => this.ocr(this.bandCanvas(card, b, v, !!rot)).then(o => ({ ...o, rot: !!rot }))));
      for (const o of outs) { texts.push(o.text); this.index.search(o.text, 2).forEach((c, i) => { if (i === 0 || c.score < 0.3) addC(c, o.rot); }); }
      const ranked = this.rank(pool);
      if (ranked[0] && (ranked[0].eff < 0.06 || (ranked[0].votes >= 2 && ranked[0].score < 0.2))) break;
    }
    return { text: texts.filter(Boolean).join(' | '), cands: this.rank(pool).slice(0, 4), rot: this.rank(pool)[0]?.rot };
  }
  rank(pool) { return [...pool.values()].map(c => ({ ...c, eff: c.score - 0.07 * (c.votes - 1) })).sort((a, b) => a.eff - b.eff); }
  async identifyCard(card) {
    const t0 = performance.now();
    let rd = await this.readName(card);
    if (rd.rot) { const c = mk(card.width, card.height); const g = c.getContext('2d'); g.translate(c.width, c.height); g.rotate(Math.PI); g.drawImage(card, 0, 0); card = c; }
    let cands = rd.cands.filter(c => c.score < 0.5);
    const cf = this.feat(card);
    // art fallback: when the name read is shaky, add names whose artwork looks like this card
    if (!(cands[0] && cands[0].eff < 0.06) && await this.artReady) {
      const have = new Set(cands.map(c => c.full)); const texts = (rd.text || '').split(' | ').filter(t => t.length > 2);
      const P = db().prints;
      for (const h of artSearch(cf.art, 14)) {
        const p = P[h.row]; if (!p || have.has(p.name)) continue; have.add(p.name);
        // how well does the OCR text support this name? (0 = perfect, capped)
        let ts = 0.45; for (const t of texts) { const r = this.index.scoreName(p.name, t); if (r < ts) ts = r; }
        cands.push({ full: p.name, score: ts, eff: Math.min(0.42, ts), art: true });
        if (cands.length >= 10) break;
      }
    }
    if (!cands.length) { // last resort: Scryfall's server-side fuzzy on the longest OCR read
      const t = (rd.text || '').split(' | ').sort((a, b) => b.length - a.length)[0] || '';
      const f = t.replace(/[^A-Za-z ,'-]/g, '').trim().length > 4 && navigator.onLine !== false ? await fuzzy(t).catch(() => null) : null;
      if (!f) return { match: null, ocr: rd.text, ms: performance.now() - t0 };
      cands = [{ full: f.name, score: 0.35, eff: 0.35 }];
    }
    let bestAll = null; const allComb = [];
    for (const nc of cands.slice(0, 10)) {
      const prints = db().byName.get(nc.full) || []; if (!prints.length) continue;
      let scored = (await Promise.all((nc.art ? prints.slice(0, 40) : prints.slice(0, 120)).map(async p => { const f = await this.printFeat(p); const v = f ? this.sim(cf, f) : -1; return { p, s: Number.isFinite(v) ? v : -1 }; }))).sort((a, b) => b.s - a.s);
      const combined = scored[0].s - nc.eff * 1.2 - (nc.art && scored[0].p.fullart && nc.eff > 0.3 ? 0.12 : 0); // borderless art is generic-looking
      allComb.push(combined);
      if (!bestAll || combined > bestAll.combined) bestAll = { nc, scored, combined };
      if (nc.eff < 0.05 && scored[0].s > 0.6) break; // confident text + matching art: done
    }
    if (!bestAll) return { match: null, ocr: rd.text, ms: performance.now() - t0 };
    const { scored, nc } = bestAll;
    const top = scored[0].s;
    // ambiguous printings (same art reprints): lean to old frame, then oldest
    const near = scored.filter(x => x.s >= top - 0.03);
    const pick = near.find(x => isOldFrame(x.p)) || near[0];
    const margin = bestAll.combined - (allComb.sort((a, b) => b - a)[1] ?? -1);
    const conf = nc.art ? (pick.s >= 0.85 && margin > 0.08 ? 'high' : pick.s >= 0.7 && margin > 0.03 ? 'medium' : 'low') : bestAll.scored[0].s < 0.35 && nc.eff > 0.15 ? 'low' : nc.eff < 0.15 && (scored.length === 1 || near.length === 1 || top - (scored.find(x => !near.includes(x))?.s ?? 0) > 0.05) ? 'high' : nc.score < 0.3 ? 'medium' : 'low';
    return { match: pick.p, viaArt: !!nc.art, combined: bestAll.combined, alts: scored.slice(0, 40).map(x => x.p), printAmbiguous: near.length > 1, nameScore: nc.eff, imgSim: pick.s, conf, ocr: rd.text, ms: performance.now() - t0 };
  }
}
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function normVec(d) { const n = d.length / 4, v = new Float32Array(n * 3); for (let ch = 0; ch < 3; ch++) { let m = 0; for (let i = 0; i < n; i++) m += d[i * 4 + ch]; m /= n; let s = 0; for (let i = 0; i < n; i++) { const x = d[i * 4 + ch] - m; v[ch * n + i] = x; s += x * x; } s = Math.sqrt(s) || 1; for (let i = 0; i < n; i++) v[ch * n + i] /= s * Math.sqrt(3); } return v; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
const ctr = q => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
const dc = (q, x, y) => { const c = ctr(q); return Math.hypot(c[0] - x, c[1] - y); };
function centerQuad(W, H) { let h = H * 0.86, w = h * RATIO; if (w > W * 0.9) { w = W * 0.9; h = w / RATIO; } const x = (W - w) / 2, y = (H - h) / 2; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
function toMat(cv, el) { let c = el; if (!(el instanceof HTMLCanvasElement)) { c = mk(el.videoWidth || el.naturalWidth || el.width, el.videoHeight || el.naturalHeight || el.height); c.getContext('2d').drawImage(el, 0, 0, c.width, c.height); } const g = c.getContext('2d', { willReadFrequently: true }); return cv.matFromImageData(g.getImageData(0, 0, c.width, c.height)); }
function qarea(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; } return Math.abs(a) / 2; }
function shrink(q, f) { const c = ctr(q); return q.map(p => [p[0] + (c[0] - p[0]) * f * 2, p[1] + (c[1] - p[1]) * f * 2]); }
