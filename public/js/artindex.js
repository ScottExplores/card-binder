// Compact art index over every unique artwork (PCA-64, int8). Built by build/build_art.py from the app's own feature code.
let IDX = null;
export async function loadArt(url = './data/art.bin') {
  if (IDX) return IDX;
  const buf = await (await fetch(url)).arrayBuffer(); const dv = new DataView(buf);
  const hl = dv.getUint32(0, true); const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  let o = 4 + hl; const mu = new Float32Array(buf, o, hdr.in); o += hdr.in * 4;
  const P = new Float32Array(buf, o, hdr.d * hdr.in); o += hdr.d * hdr.in * 4;
  const rows = new Uint32Array(buf, o, hdr.n); o += hdr.n * 4;
  const codes = new Int8Array(buf, o, hdr.n * hdr.d);
  IDX = { ...hdr, mu, P, rows, codes };
  return IDX;
}
export function artSearch(vec, k = 12) {
  const { mu, P, rows, codes, n, d } = IDX; const D = vec.length;
  const z = new Float32Array(d); for (let j = 0; j < d; j++) { let s = 0; const off = j * D; for (let i = 0; i < D; i++) s += (vec[i] - mu[i]) * P[off + i]; z[j] = s; }
  let nz = 0; for (let j = 0; j < d; j++) nz += z[j] * z[j]; nz = Math.sqrt(nz) || 1; for (let j = 0; j < d; j++) z[j] /= nz;
  const top = []; let minS = -Infinity;
  for (let r = 0; r < n; r++) {
    let s = 0; const off = r * d; for (let j = 0; j < d; j++) s += z[j] * codes[off + j];
    if (top.length < k || s > minS) { top.push([s, r]); if (top.length > k) { top.sort((a, b) => b[0] - a[0]); top.length = k; } minS = top.length === k ? top[top.length - 1][0] : -Infinity; }
  }
  return top.sort((a, b) => b[0] - a[0]).map(([s, r]) => ({ row: rows[r], s: s / 127 }));
}
