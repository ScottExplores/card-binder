// Local fuzzy matching of OCR'd text to the Scryfall card-name catalog.
export const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

export class NameIndex {
  constructor(names) {
    this.entries = []; // {key, name(full), face}
    for (const full of names) {
      const faces = full.includes(' // ') ? full.split(' // ') : [full];
      faces.forEach((f, i) => { const key = norm(f); if (key.length) this.entries.push({ key, full, face: i }); });
    }
    // bucket by first 2 letters isn't safe for OCR errors; use length buckets for speed
    this.byLen = new Map();
    for (const e of this.entries) { const L = e.key.length; if (!this.byLen.has(L)) this.byLen.set(L, []); this.byLen.get(L).push(e); }
    this.buf = new Uint16Array(256);
  }
  // Semi-global edit distance: name must be fully matched, OCR text may have junk before/after.
  dist(name, text) {
    const n = name.length, m = text.length; let prev = this.buf.subarray(0, m + 1), cur = new Uint16Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j * 0.5 | 0; // leading junk cheap-ish (half cost)
    for (let i = 1; i <= n; i++) {
      cur[0] = i; const c = name.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        const sub = prev[j - 1] + (c === text.charCodeAt(j - 1) ? 0 : 1);
        const del = prev[j] + 1, ins = cur[j - 1] + 1;
        cur[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
      }
      const t = prev; prev = cur; cur = t;
    }
    let best = 1e9, bj = 0; for (let j = 0; j <= m; j++) { const v = prev[j]; if (v < best) { best = v; bj = j; } }
    return { d: best, end: bj };
  }
  search(raw, k = 5) {
    const text = norm(raw); if (text.length < 3) return [];
    const m = text.length, res = [];
    for (const [L, list] of this.byLen) {
      if (L > m + 4 || L < Math.min(3, m)) continue;
      for (const e of list) {
        const { d, end } = this.dist(e.key, text);
        if (d > L * 0.45) continue;
        const trailing = m - end;
        const score = (d + 0.12 * trailing) / L + (L < 5 ? 0.15 : 0); // short names are risky
        res.push({ ...e, d, score });
      }
    }
    res.sort((a, b) => a.score - b.score);
    const out = [], seen = new Set();
    for (const r of res) { if (seen.has(r.full)) continue; seen.add(r.full); out.push(r); if (out.length >= k) break; }
    return out;
  }
}
