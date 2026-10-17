// Local image index over every printing (PCA int8 of the app's [full, art] feature). Replaces per-printing Scryfall image downloads.
let IDX = null;
export async function loadPrints(url = './data/prints.bin') {
  if (IDX) return IDX;
  const buf = await (await fetch(url)).arrayBuffer(); const dv = new DataView(buf);
  const hl = dv.getUint32(0, true); const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  let o = 4 + hl; const mu = new Float32Array(buf, o, hdr.in); o += hdr.in * 4;
  const P = new Float32Array(buf, o, hdr.d * hdr.in); o += hdr.d * hdr.in * 4;
  const rows = new Uint32Array(buf, o, hdr.n); o += hdr.n * 4;
  const codes = new Int8Array(buf, o, hdr.n * hdr.d);
  const pos = new Map(); for (let i = 0; i < hdr.n; i++) pos.set(rows[i], i);
  IDX = { ...hdr, mu, P, rows, codes, pos };
  return IDX;
}
export const printsReady = () => !!IDX;
// project a raw feature {full, art} into the index space (unit vector)
export function project(f) {
  const { mu, P, d } = IDX; const D = 3024, nf = f.full.length; const z = new Float32Array(d);
  for (let j = 0; j < d; j++) { let s = 0; const off = j * D; for (let i = 0; i < nf; i++) s += (f.full[i] - mu[i]) * P[off + i]; for (let i = 0; i < f.art.length; i++) s += (f.art[i] - mu[nf + i]) * P[off + nf + i]; z[j] = s; }
  let n = 0; for (let j = 0; j < d; j++) n += z[j] * z[j]; n = Math.sqrt(n) || 1; for (let j = 0; j < d; j++) z[j] /= n; return z;
}
// similarity of z to one printing (by DB row), or null when the printing isn't indexed
export function simRow(z, row) { const i = IDX.pos.get(row); if (i === undefined) return null; const { codes, d } = IDX; let s = 0; const off = i * d; for (let j = 0; j < d; j++) s += z[j] * codes[off + j]; return s / 127; }
export function searchPrints(z, k = 20) {
  const { codes, rows, n, d } = IDX; const top = []; let minS = -Infinity;
  for (let r = 0; r < n; r++) {
    let s = 0; const off = r * d; for (let j = 0; j < d; j++) s += z[j] * codes[off + j];
    if (top.length < k || s > minS) { top.push([s, r]); if (top.length > k * 2) { top.sort((a, b) => b[0] - a[0]); top.length = k; } minS = top.length >= k ? top.reduce((m, t) => Math.min(m, t[0]), Infinity) : -Infinity; }
  }
  return top.sort((a, b) => b[0] - a[0]).slice(0, k).map(([s, r]) => ({ row: rows[r], s: s / 127 }));
}
