// Card detection + perspective warp using OpenCV.js. Works on a canvas/ImageData.
export const CARD_W = 488, CARD_H = 680, RATIO = 63 / 88;

function orderQuad(pts) {
  // pts: [[x,y]x4] -> tl,tr,br,bl ; ensure portrait orientation
  const c = pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  const s = pts.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  // s sorted by angle starting from ~-PI (left) going clockwise in image coords: find tl = min x+y
  let k = 0, best = Infinity;
  s.forEach((p, i) => { if (p[0] + p[1] < best) { best = p[0] + p[1]; k = i; } });
  let q = [0, 1, 2, 3].map(i => s[(k + i) % 4]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2, h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  if (w > h) q = [q[3], q[0], q[1], q[2]]; // landscape -> rotate to portrait (top = left edge)
  return q;
}

function quadStats(q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2, h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  return { w, h, ratio: w / h };
}

function polyArea(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; } return Math.abs(a) / 2; }

// Find card-shaped quads. Returns array of quads (in source pixel coords), sorted reading order.
export function detectCards(cv, src, { maxCards = 9, minAreaFrac = 0.02, fast = false, maxSide = 900 } = {}) {
  const scale = Math.min(1, maxSide / Math.max(src.cols, src.rows));
  const small = new cv.Mat(); cv.resize(src, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
  const gray = new cv.Mat(); cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  const area0 = small.cols * small.rows;
  const cands = [];
  const tryEdges = (edges) => {
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const a = cv.contourArea(cnt);
      if (a < area0 * minAreaFrac || a > area0 * 0.97) { cnt.delete(); continue; }
      const peri = cv.arcLength(cnt, true);
      let quad = null;
      for (const eps of [0.02, 0.035, 0.05]) {
        const ap = new cv.Mat(); cv.approxPolyDP(cnt, ap, eps * peri, true);
        if (ap.rows === 4 && cv.isContourConvex(ap)) { quad = []; for (let j = 0; j < 4; j++) quad.push([ap.data32S[j * 2], ap.data32S[j * 2 + 1]]); }
        ap.delete(); if (quad) break;
      }
      if (!quad) { // fall back to min-area rect for rounded/broken contours
        const hull = new cv.Mat(); cv.convexHull(cnt, hull);
        const ha = cv.contourArea(hull);
        const r = cv.minAreaRect(hull); const pts = cv.RotatedRect.points(r);
        const ra = r.size.width * r.size.height;
        if (ha / ra > 0.9) quad = pts.map(p => [p.x, p.y]);
        hull.delete();
      }
      cnt.delete();
      if (!quad) continue;
      quad = orderQuad(quad);
      const mg = Math.max(small.cols, small.rows) * 0.012;
      if (quad.some(p => p[0] < mg || p[1] < mg || p[0] > small.cols - mg || p[1] > small.rows - mg)) continue; // touches frame edge
      const st = quadStats(quad);
      if (st.ratio < 0.58 || st.ratio > 0.86) continue;
      const pa = polyArea(quad);
      if (pa < area0 * minAreaFrac) continue;
      cands.push({ quad, area: pa });
    }
    contours.delete(); hier.delete();
  };
  const blur = new cv.Mat(); cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  const edges = new cv.Mat(); const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  // single-card fast path: stop after the first pass that finds a clear card (most frames), else try harder
  const enough = () => fast && cands.some(c => c.area > area0 * 0.12);
  for (const [lo, hi] of [[30, 90], [12, 40], [60, 160]]) {
    cv.Canny(blur, edges, lo, hi); cv.dilate(edges, edges, k, new cv.Point(-1, -1), 1); tryEdges(edges); if (enough()) break;
  }
  // adaptive threshold pass helps dark backgrounds / sleeves
  if (!enough()) { cv.adaptiveThreshold(blur, edges, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 4);
  cv.bitwise_not(edges, edges); cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k); tryEdges(edges); }
  [small, gray, blur, edges, k].forEach(m => m.delete());
  // non-max suppression: drop quads whose center lies inside a bigger kept quad... prefer the largest
  // non-nested; but a sleeve gives nested quads (sleeve + card) - keep the outer if similar size (>80%).
  cands.sort((a, b) => b.area - a.area);
  const ctrOf = q => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  const insideQ = (pt, q) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += Math.sign((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])); } return Math.abs(s) === 4; };
  if (maxCards > 3) { // binder mode: a quad holding several card-sized quads is the page, not a card
    const drop = new Set();
    for (const c of cands) { const inner = cands.filter(o => o !== c && o.area < c.area * 0.5 && o.area > c.area * 0.04 && insideQ(ctrOf(o.quad), c.quad)); const distinct = []; for (const o of inner) if (!distinct.some(d => insideQ(ctrOf(o.quad), d.quad) || insideQ(ctrOf(d.quad), o.quad))) distinct.push(o); if (distinct.length >= 2) drop.add(c); }
    for (let i = cands.length - 1; i >= 0; i--) if (drop.has(cands[i])) cands.splice(i, 1);
  }
  const kept = [];
  const center = q => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  const inside = (pt, q) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const c = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]); s += Math.sign(c); } return Math.abs(s) === 4; };
  for (const c of cands) {
    const ctr = center(c.quad);
    const host = kept.find(k => inside(ctr, k.quad));
    if (host) {
      // nested: if this one is close in size, it's the card inside a sleeve -> replace with inner (tighter)
      // nested quad: keep the outer outline, remember a close-fitting inner one (card inside a sleeve / inner frame)
      if (c.area > host.area * 0.78 && c.area < host.area * 0.97 && (!host.inner || c.area > host.innerArea)) { host.inner = c.quad; host.innerArea = c.area; }
      continue;
    }
    if (kept.some(k => inside(center(k.quad), { quad: c.quad }.quad))) continue;
    kept.push(c);
  }
  // keep cards of similar size to the biggest (binder pages) and cap the count
  let res = kept;
  if (res.length > 1) { const med = res.map(r => r.area).sort((a, b) => b - a)[Math.min(res.length - 1, 1)]; res = res.filter(r => r.area > med * 0.45); }
  res = res.slice(0, maxCards).map(r => { const q = r.quad.map(p => [p[0] / scale, p[1] / scale]); if (r.inner) q.inner = r.inner.map(p => [p[0] / scale, p[1] / scale]); return q; });
  // reading order: rows by y then x
  res.sort((a, b) => center(a)[1] - center(b)[1]);
  const rows = []; for (const q of res) { const r = rows.find(r => Math.abs(center(r[0])[1] - center(q)[1]) < quadStats(q).h * 0.5); r ? r.push(q) : rows.push([q]); }
  return rows.flatMap(r => r.sort((a, b) => center(a)[0] - center(b)[0]));
}

export function warpCard(cv, src, quad, w = CARD_W, h = CARD_H) {
  const s = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat());
  const d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(s, d); const out = new cv.Mat();
  cv.warpPerspective(src, out, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  s.delete(); d.delete(); M.delete(); return out;
}

// Split an image into an n x m grid (binder fallback); returns axis aligned quads with card ratio inside each cell.
export function gridQuads(W, H, cols, rows, margin = 0.03) {
  const out = []; const gw = W * (1 - 2 * margin) / cols, gh = H * (1 - 2 * margin) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let cw = gw * 0.96, ch = cw / RATIO; if (ch > gh * 0.96) { ch = gh * 0.96; cw = ch * RATIO; }
    const cx = W * margin + gw * (c + 0.5), cy = H * margin + gh * (r + 0.5);
    out.push([[cx - cw / 2, cy - ch / 2], [cx + cw / 2, cy - ch / 2], [cx + cw / 2, cy + ch / 2], [cx - cw / 2, cy + ch / 2]]);
  }
  return out;
}
