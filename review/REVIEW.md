# Independent Card Binder review

Reviewed 2026-10-17. Scope: scan identity/printing correctness, Android resource use, collection integrity, import/backup and video review. No existing source or asset was edited; all suggestions below are **unapplied**. Diffs are independent against this snapshot; overlapping proposals need integration, especially binder serialization/atomicity and the conservative scan/finish gates. They are review sketches with explicit limits, not a tested release patch.

## What is already good

- Detection, perspective warp, several OCR treatments, local fuzzy names, and independent artwork/printing evidence form a sensible layered pipeline. Sleeve-inner retries and rotated-title handling address practical failure modes.
- Compact local print/art indices and cached image features avoid repeated network scans once ready. Live outlines use a worker and small frames.
- Binder keys include printing and finish; duplicate adds merge quantities. Inverse actions support whole-scan Undo. Backups and several CSV exports give users a route out of browser-only storage.
- Low-confidence results stay reviewable, and per-printing alternatives are available. Unit and browser tests already cover useful flows.

No localStorage usage was found in the app JS. Binder and saved video jobs live in IndexedDB; Cache Storage holds shell/index/image assets. Neither IndexedDB nor Cache Storage is a substitute for a downloaded backup, and no persistent-storage request is present.

## Ranked top 15

Ranking combines irreversible collection errors, wrong automatic picks, affected frequency and phone responsiveness. P1 items can silently change or lose collection identity/counts; P2 items primarily affect responsiveness/recovery. Static findings are distinguished from the smoke-test reproduction below.

### 1. P1 — Binder writes are neither atomic nor commit-first

**Location:** `public/js/binder.js:17–20; public/js/db.js:12`.

A multi-card scan or printing change commits one entry per transaction and mutates memory before persistence. A quota error, aborted tab or failed second write leaves a partial scan; a printing change can delete the source before the destination is durable. There is no undo record on failure. An abort without an error event can also leave tx pending. Commit the batch in one transaction before updating memory; retain undo until success.

Suggested patch (not applied):

```diff
--- a/public/js/db.js
+++ b/public/js/db.js
@@ -10,5 +10,5 @@
   return dbp;
 }
-function tx(store, mode, fn) { return db().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); })); }
+function tx(store, mode, fn) { return db().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = t.onabort = () => rej(t.error || new Error('Storage transaction aborted')); })); }
 export const kvGet = k => hasIDB ? tx('kv', 'readonly', s => s.get(k)).catch(() => null) : Promise.resolve(null);
 export const kvSet = (k, v) => hasIDB ? tx('kv', 'readwrite', s => { s.put(v, k); }).catch(() => {}) : Promise.resolve();
@@ -17,3 +17,6 @@
 export const putCards = cs => tx('cards', 'readwrite', s => { cs.forEach(c => s.put(c)); });
 export const delCard = key => tx('cards', 'readwrite', s => { s.delete(key); });
+export const commitChanges = changes => tx('cards', 'readwrite', s => {
+  for (const c of changes) c.after ? s.put(c.after) : s.delete(c.key);
+});
 export const clearCards = () => tx('cards', 'readwrite', s => { s.clear(); });

--- a/public/js/binder.js
+++ b/public/js/binder.js
@@ -1,4 +1,4 @@
 // Binder state: entries keyed by printing+finish, persisted to IndexedDB, with undo.
-import { allCards, putCard, delCard } from './db.js';
+import { allCards, commitChanges } from './db.js';
 import { priceOf, isOldFrame } from './carddb.js';
 export class Binder {
@@ -16,5 +16,6 @@
   // ops are recorded as inverse actions so a whole scan (several cards) can be undone at once
   async apply(changes, label) { // changes: [{key, before, after}]
-    for (const c of changes) { if (c.after) { this.map.set(c.key, c.after); await putCard(c.after); } else { this.map.delete(c.key); await delCard(c.key); } }
+    await commitChanges(changes);
+    for (const c of changes) c.after ? this.map.set(c.key, c.after) : this.map.delete(c.key);
     if (label) { this.undoStack.push({ label, changes }); if (this.undoStack.length > 50) this.undoStack.shift(); }
     this.emit();
@@ -41,7 +42,7 @@
   }
   async undo() {
-    const u = this.undoStack.pop(); if (!u) return null;
+    const u = this.undoStack[this.undoStack.length - 1]; if (!u) return null;
     const inv = u.changes.slice().reverse().map(c => ({ key: c.key, before: c.after, after: c.before }));
-    await this.apply(inv, null); return u.label;
+    await this.apply(inv, null); this.undoStack.pop(); return u.label;
   }
   async updatePrices(fn) { const ch = []; for (const e of this.map.values()) { const p = fn(e); if (p !== undefined && p !== e.price) ch.push({ key: e.key, before: e, after: { ...e, price: p, priced: Date.now() } }); } if (ch.length) await this.apply(ch, null); return ch.length; }
```

### 2. P1 — Correcting one of several copies loses a copy on Undo

**Location:** `public/js/app.js:249`.

With quantity 2, correcting a tray printing first decrements the original with label=null, then records only the destination addition. Undo removes the destination but never restores the original quantity. A failure between the two writes also loses the copy. Use one inverse-action batch (with issue 1 for durable atomicity).

Suggested patch (not applied):

```diff
--- a/public/js/app.js
+++ b/public/js/app.js
@@ -247,5 +247,12 @@
 async function setTrayPrint(t, p, finish) {
   finish = finish || (t.print && p.fin.includes(t.finish[0]) ? t.finish : chooseFinish(p));
-  if (t.added) { const k = Binder.key(t.print.id, t.finish); const cur = binder.get(k); if (cur && cur.qty > 1) { await binder.apply([{ key: k, before: cur, after: { ...cur, qty: cur.qty - 1 } }], null); await binder.add([{ print: p, finish }], 'Changed printing'); } else if (cur) await binder.change(k, p, finish); else await binder.add([{ print: p, finish }], 'Added'); }
+  if (t.added) { const k = Binder.key(t.print.id, t.finish); const cur = binder.get(k); if (cur && cur.qty > 1) { const nk = Binder.key(p.id, finish);
+      if (nk !== k) {
+        const target = binder.get(nk);
+        await binder.apply([
+          { key: k, before: cur, after: { ...cur, qty: cur.qty - 1 } },
+          { key: nk, before: target || null, after: target ? { ...target, qty: target.qty + 1 } : Binder.fromPrint(p, finish) }
+        ], 'Changed printing');
+      } } else if (cur) await binder.change(k, p, finish); else await binder.add([{ print: p, finish }], 'Added'); }
   else await binder.add([{ print: p, finish }], 'Added ' + p.name);
   t.print = p; t.finish = finish; t.added = true; t.conf = 'high'; renderTray(); toast(`${p.name} · ${p.set.toUpperCase()} #${p.cn}`, undoLast);
```

### 3. P1 — Name confidence auto-adds ambiguous exact printings

**Location:** `public/js/identify.js:183–185; public/js/app.js:185–186`.

The early break at line 170 can leave only one name score, so margin compares against -1 rather than another evaluated name. High confidence can coexist with printAmbiguous=true. The UI auto-adds medium too and drops the ambiguity flag. The sample reproduces a high-confidence DOM Drudge Sentinel being replaced by PLST. Conservative patch: review ambiguous printings and require high confidence to auto-add, retaining the ambiguity flag. Threshold calibration needs the real 50-photo set; this patch trades coverage for precision.

Suggested patch (not applied):

```diff
--- a/public/js/app.js
+++ b/public/js/app.js
@@ -165,5 +165,5 @@
     if (auto) {
       const top = found[0];
-      if (!top || top.conf === 'low') { status('Hold steady…'); return; }
+      if (!top || top.conf !== 'high' || top.printAmbiguous) { status('Hold steady…'); return; }
       sawEmpty = false;
       if (top.match.name === lastAutoName && Date.now() - lastAutoT < 2500) { status('Same card — move it away to scan the next'); return; }
@@ -183,6 +183,6 @@
   const items = [];
   const newTray = results.map(r => {
-    const t = { id: Math.random().toString(36).slice(2), print: r.match, alts: r.alts || [], conf: r.match ? r.conf : 'low', ocr: r.ocr, added: false, finish: 'nonfoil', thumb: r.cardCanvas ? r.cardCanvas.toDataURL('image/jpeg', 0.6) : '' };
-    if (t.print) { t.finish = chooseFinish(t.print); if (t.conf !== 'low') { items.push({ print: t.print, finish: t.finish, qty: 1 }); t.added = true; } }
+    const t = { id: Math.random().toString(36).slice(2), print: r.match, alts: r.alts || [], printAmbiguous: !!r.printAmbiguous, conf: r.match ? r.conf : 'low', ocr: r.ocr, added: false, finish: 'nonfoil', thumb: r.cardCanvas ? r.cardCanvas.toDataURL('image/jpeg', 0.6) : '' };
+    if (t.print) { t.finish = chooseFinish(t.print); if (t.conf === 'high' && !t.printAmbiguous) { items.push({ print: t.print, finish: t.finish, qty: 1 }); t.added = true; } }
     return t;
   });
```

### 4. P1 — Restore accepts inconsistent identities and invalid quantities

**Location:** `public/js/app.js:373`.

Restore checks only truthiness and qty>0. A backup can contain id A under key B, fractional/string/infinite quantities, invalid finishes or duplicate keys. Later delete/change operations then target the wrong entry, totals can concatenate strings, and Undo of duplicate keys is inconsistent. Check app/version and all rows before any write; rebuild identity metadata from the local DB. This preserves existing merge/overwrite semantics (entries absent from the backup remain). Unknown DB printings are rejected, not silently dropped.

Suggested patch (not applied):

```diff
--- a/public/js/app.js
+++ b/public/js/app.js
@@ -371,5 +371,12 @@
   <div class="btn-row"><button class="btn big" id="bk">Save backup</button><label class="btn big">Restore<input type="file" id="rs" accept=".json,application/json" hidden></label></div>`, root => {
   root.querySelector('#bk').onclick = () => download(`card-binder-backup-${stamp()}.json`, JSON.stringify({ app: 'card-binder', v: 1, cards: binder.entries() }), 'application/json');
-  root.querySelector('#rs').onchange = async ev => { try { const j = JSON.parse(await ev.target.files[0].text()); const ch = j.cards.filter(c => c.key && c.id && c.qty > 0).map(c => ({ key: c.key, before: binder.get(c.key) || null, after: c })); await binder.apply(ch, 'Restore'); closeSheet(); toast(`Restored ${ch.length} entries`, undoLast); renderValue(); } catch { toast('That file is not a Card Binder backup'); } };
+  root.querySelector('#rs').onchange = async ev => { try { const j = JSON.parse(await ev.target.files[0].text()); if (j.app !== 'card-binder' || j.v !== 1 || !Array.isArray(j.cards)) throw new Error('Invalid backup');
+    const keys = new Set();
+    const ch = j.cards.map(c => {
+      const p = db().byId.get(c.id), f = { nonfoil: 'n', foil: 'f', etched: 'e' }[c.finish];
+      if (!p || !f || !p.fin.includes(f) || !Number.isSafeInteger(c.qty) || c.qty < 1 || c.key !== Binder.key(c.id, c.finish) || keys.has(c.key)) throw new Error('Invalid entry');
+      keys.add(c.key);
+      return { key: c.key, before: binder.get(c.key) || null, after: { ...c, ...Binder.fromPrint(p, c.finish, c.qty) } };
+    }); await binder.apply(ch, 'Restore'); closeSheet(); toast(`Restored ${ch.length} entries`, undoLast); renderValue(); } catch { toast('That file is not a Card Binder backup'); } };
 });
 
```

### 5. P1 — Concurrent binder operations read stale quantities

**Location:** `public/js/binder.js:22–30,35–45`.

Rapid quantity taps, double-clicking video Add, or import while a scan finishes can overlap before await putCard resolves. For a multi-key operation, the first key changes in memory while later keys are still stale; another mutation can read that half-applied state. Undo of the earlier batch can then overwrite the later operation. Before/after snapshots interleave and undo history ceases to describe the actual state. Commit-first alone (issue 1) makes lost-update risk more obvious: two adds can both compute qty+1 from the same old value. Serialize the whole read/compute/write operation. Suggested patch composes with issue 1; internal _apply avoids queue deadlock. Cross-tab edits still need a DB-level read-modify-write or a single-writer tab policy.

Suggested patch (not applied):

```diff
--- a/public/js/binder.js
+++ b/public/js/binder.js
@@ -15,5 +15,5 @@
   get(key) { return this.map.get(key); }
   // ops are recorded as inverse actions so a whole scan (several cards) can be undone at once
-  async apply(changes, label) { // changes: [{key, before, after}]
+  async _apply(changes, label) { // changes: [{key, before, after}]
     for (const c of changes) { if (c.after) { this.map.set(c.key, c.after); await putCard(c.after); } else { this.map.delete(c.key); await delCard(c.key); } }
     if (label) { this.undoStack.push({ label, changes }); if (this.undoStack.length > 50) this.undoStack.shift(); }
@@ -28,8 +28,8 @@
       pending.set(key, after);
     }
-    await this.apply(changes, label); return changes;
+    await this._apply(changes, label); return changes;
   }
-  async setQty(key, qty) { const cur = this.map.get(key); if (!cur) return; await this.apply([{ key, before: cur, after: qty > 0 ? { ...cur, qty, updated: Date.now() } : null }], qty > 0 ? 'Quantity' : 'Removed'); }
-  async remove(key) { const cur = this.map.get(key); if (cur) await this.apply([{ key, before: cur, after: null }], 'Removed ' + cur.name); }
+  async setQty(key, qty) { const cur = this.map.get(key); if (!cur) return; await this._apply([{ key, before: cur, after: qty > 0 ? { ...cur, qty, updated: Date.now() } : null }], qty > 0 ? 'Quantity' : 'Removed'); }
+  async remove(key) { const cur = this.map.get(key); if (cur) await this._apply([{ key, before: cur, after: null }], 'Removed ' + cur.name); }
   // move one copy (or all) to another printing/finish, merging with an existing entry
   async change(key, print, finish) {
@@ -37,5 +37,5 @@
     const tgt = this.map.get(nk);
     const after = tgt ? { ...tgt, qty: tgt.qty + cur.qty, updated: Date.now() } : { ...Binder.fromPrint(print, finish, cur.qty), added: cur.added };
-    await this.apply([{ key, before: cur, after: null }, { key: nk, before: tgt || null, after }], 'Changed printing');
+    await this._apply([{ key, before: cur, after: null }, { key: nk, before: tgt || null, after }], 'Changed printing');
     return nk;
   }
@@ -43,7 +43,17 @@
     const u = this.undoStack.pop(); if (!u) return null;
     const inv = u.changes.slice().reverse().map(c => ({ key: c.key, before: c.after, after: c.before }));
-    await this.apply(inv, null); return u.label;
+    await this._apply(inv, null); return u.label;
   }
-  async updatePrices(fn) { const ch = []; for (const e of this.map.values()) { const p = fn(e); if (p !== undefined && p !== e.price) ch.push({ key: e.key, before: e, after: { ...e, price: p, priced: Date.now() } }); } if (ch.length) await this.apply(ch, null); return ch.length; }
+  async updatePrices(fn) { const ch = []; for (const e of this.map.values()) { const p = fn(e); if (p !== undefined && p !== e.price) ch.push({ key: e.key, before: e, after: { ...e, price: p, priced: Date.now() } }); } if (ch.length) await this._apply(ch, null); return ch.length; }
   totals(list = this.entries()) { let v = 0, n = 0, o5 = 0, o5v = 0; for (const e of list) { const t = (e.price || 0) * e.qty; v += t; n += e.qty; if ((e.price || 0) > 5) { o5 += e.qty; o5v += t; } } return { value: v, count: n, unique: list.length, over5: o5, over5v: o5v }; }
 }
+
+// Serialize state reads and commits, including external apply calls.
+for (const name of ['apply', 'add', 'setQty', 'remove', 'change', 'undo', 'updatePrices']) {
+  const operation = name === 'apply' ? Binder.prototype._apply : Binder.prototype[name];
+  Binder.prototype[name] = function (...args) {
+    const next = (this.writeQueue || Promise.resolve()).then(() => operation.apply(this, args));
+    this.writeQueue = next.catch(() => {});
+    return next;
+  };
+}
```

### 6. P1 — Import silently substitutes a different explicit printing

**Location:** `public/js/csv.js:37–43`.

If a supplied set/collector number fails, the name fallback ignores the missing collector number and ultimately chooses another printing. The row is counted imported, not missing. A valid set/CN paired with a conflicting name is also accepted. Quantities are truncated/clamped and finish support is never checked. Reject conflicting/invalid explicit identifiers before the permissive name-only fallback.

Suggested patch (not applied):

```diff
--- a/public/js/csv.js
+++ b/public/js/csv.js
@@ -37,9 +37,13 @@
     let p = iSid >= 0 && r[iSid] ? db.byId.get(r[iSid].trim()) : null;
     if (!p && iSet >= 0 && iCn >= 0) p = db.bySetCn.get((r[iSet] || '').trim().toLowerCase() + '/' + (r[iCn] || '').trim());
+    if (p && name && p.name !== name && p.name.split(' // ')[0] !== name) { missing.push(r.join(',')); continue; }
+    if (!p && ((iSid >= 0 && r[iSid]?.trim()) || (iSet >= 0 && r[iSet]?.trim()) || (iCn >= 0 && r[iCn]?.trim()))) { missing.push(r.join(',')); continue; }
     if (!p && name) { const l = db.byName.get(name) || [...db.byName.entries()].find(([k]) => k.split(' // ')[0] === name)?.[1]; if (l) { const sv = iSet >= 0 ? (r[iSet] || '').trim().toLowerCase() : ''; const cn = iCn >= 0 ? (r[iCn] || '').trim() : ''; p = (sv && l.find(x => (x.set === sv || x.set_name.toLowerCase() === sv) && (!cn || x.cn === cn))) || (sv && l.find(x => x.set === sv || x.set_name.toLowerCase() === sv)) || l[l.length - 1]; } }
     if (!p) { missing.push(r.join(',')); continue; }
     const fv = iFoil >= 0 ? (r[iFoil] || '').trim().toLowerCase() : '';
     const finish = fv.includes('etched') ? 'etched' : fv === 'foil' || fv === 'true' || fv === 'yes' || fv === 'premium' ? 'foil' : 'nonfoil';
-    items.push({ print: p, finish, qty: Math.max(1, parseInt(iQty >= 0 ? r[iQty] : '1', 10) || 1) });
+    const qty = Number(iQty >= 0 ? r[iQty] : 1);
+    if (!Number.isSafeInteger(qty) || qty < 1 || !p.fin.includes({ nonfoil: 'n', foil: 'f', etched: 'e' }[finish])) { missing.push(r.join(',')); continue; }
+    items.push({ print: p, finish, qty });
   }
   return { items, missing };
```

### 7. P1 — Close matches deliberately favor an old frame over better evidence

**Location:** `public/js/identify.js:180–182`.

Any old-frame printing within 0.03 of the best image score replaces the actual best score, regardless of observed frame. This systemically biases set/CN and frame picks on same-art reprints. Keep the visual winner and expose ambiguity for user review (issue 3). Recognizing collector-number/set text would be the stronger long-term discriminator.

Suggested patch (not applied):

```diff
--- a/public/js/identify.js
+++ b/public/js/identify.js
@@ -180,5 +180,5 @@
     // ambiguous printings (same art reprints): lean to old frame, then oldest
     const near = scored.filter(x => x.s >= top - 0.03);
-    const pick = near.find(x => isOldFrame(x.p)) || near[0];
+    const pick = scored[0];
     const margin = bestAll.combined - (allComb.sort((a, b) => b - a)[1] ?? -1);
     const conf = !nc.art && pick.s >= 0.85 && nc.eff < 0.45 && margin > 0.1 ? 'high' : nc.art ? (pick.s >= 0.85 && margin > 0.08 ? 'high' : pick.s >= 0.7 && margin > 0.03 ? 'medium' : 'low') : bestAll.scored[0].s < 0.35 && nc.eff > 0.15 ? 'low' : nc.eff < 0.15 && (scored.length === 1 || near.length === 1 || top - (scored.find(x => !near.includes(x))?.s ?? 0) > 0.05) ? 'high' : nc.score < 0.3 ? 'medium' : 'low';
```

### 8. P1 — Finish defaults can silently mislabel a foil

**Location:** `public/js/app.js:13,186,196,257`.

No image stage detects foil. With the initial toggle OFF every printing that supports normal and foil is stored normal; after toggling ON, later nonfoils can be stored foil. The UI currently treats that guess as final. Keep an explicit unknown state initially and require finish confirmation for dual-finish cards; users can still explicitly choose a session finish with the existing toggle. This is a conservative partial UX change: video review should likewise require a deliberate finish choice for mixed-finish printings.

Suggested patch (not applied):

```diff
--- a/public/js/app.js
+++ b/public/js/app.js
@@ -11,5 +11,5 @@
 const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 const binder = new Binder();
-const S = { tab: 'scan', mode: 'single', auto: false, foil: false, view: 'list', page: 0, over5: false, sort: 'value', q: '', idf: null, busy: false, stream: null, tray: [] };
+const S = { tab: 'scan', mode: 'single', auto: false, foil: null, view: 'list', page: 0, over5: false, sort: 'value', q: '', idf: null, busy: false, stream: null, tray: [] };
 
 // ---------- tabs
@@ -184,5 +184,6 @@
   const newTray = results.map(r => {
     const t = { id: Math.random().toString(36).slice(2), print: r.match, alts: r.alts || [], conf: r.match ? r.conf : 'low', ocr: r.ocr, added: false, finish: 'nonfoil', thumb: r.cardCanvas ? r.cardCanvas.toDataURL('image/jpeg', 0.6) : '' };
-    if (t.print) { t.finish = chooseFinish(t.print); if (t.conf !== 'low') { items.push({ print: t.print, finish: t.finish, qty: 1 }); t.added = true; } }
+    if (t.print) { t.finish = chooseFinish(t.print);
+      if (S.foil === null && t.print.fin.length > 1) t.conf = 'low'; if (t.conf !== 'low') { items.push({ print: t.print, finish: t.finish, qty: 1 }); t.added = true; } }
     return t;
   });
```

### 9. P1 — Cache-first indices can be mixed with a newer card row ordering

**Location:** `public/sw.js:2,11–13; public/js/printindex.js:10–14`.

Print/art vectors refer to numeric rows in cards.json with no identity validation. V stays cb-v1, vendor/data requests are cache-first indefinitely, while JS is network-first. After an interrupted update or partial cache eviction a newer cards.json can coexist with older indices, producing unrelated printing scores without an error. Minimal mitigation is release-versioned shell/data caching; every database/index release must bump this version and regenerate all three together. A content-hash manifest validated in each loader is still needed for strong integrity.

Suggested patch (not applied):

```diff
--- a/public/sw.js
+++ b/public/sw.js
@@ -1,4 +1,5 @@
 // Offline cache: app shell + scanner engine + card DB (cache-first), Scryfall images (stale-while-revalidate, capped).
-const V = 'cb-v1';
+// Bump on every atomic cards.json + art.bin + prints.bin release.
+const V = 'cb-v2';
 const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'js/app.js', 'js/binder.js', 'js/carddb.js', 'js/csv.js', 'js/db.js', 'js/identify.js', 'js/loadcv.js', 'js/match.js', 'js/scry.js', 'js/vision.js', 'js/artindex.js', 'data/art.bin', 'js/printindex.js', 'js/record.js', 'js/liveworker.js', 'data/prints.bin',
   'vendor/opencv.js', 'vendor/tess/tesseract.min.js', 'vendor/tess/worker.min.js', 'vendor/tess/tesseract-core-simd-lstm.wasm.js', 'vendor/tess/tesseract-core-lstm.wasm.js', 'vendor/lang/eng.traineddata.gz', 'data/cards.json', 'icons/icon-192.png'];
@@ -11,5 +12,5 @@
     // network-first for the shell html/js so updates land quickly; cache fallback offline
     const big = /\/(vendor|data)\//.test(u.pathname);
-    e.respondWith(big ? caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; }))
+    e.respondWith(big ? caches.open(V).then(cache => cache.match(e.request)).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; }))
       : fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
   } else if (u.hostname === 'cards.scryfall.io') {
```

### 10. P1 — Video dedupe merges distinct physical cards across scenes

**Location:** `public/js/record.js:64–66`.

Grouping uses name, <3 seconds and a very loose half-image center distance. Two consecutive cards or two binder pages containing the same name can collapse into qty=1, including different set/CN printings. The scene ID already exists but is ignored. Require the same scene and a tighter position match. This intentionally favors overcounting at scene boundaries, which review can correct, over silent undercounting.

Suggested patch (not applied):

```diff
--- a/public/js/record.js
+++ b/public/js/record.js
@@ -62,7 +62,7 @@
   const rank = { high: 3, medium: 2, low: 1 }; const groups = [];
   for (const s of seen.sort((a, b) => a.t - b.t)) {
-    const g = groups.find(g => g.name === s.match.name && s.t - g.lastT < 3 && !g.frames.has(s.frame) && Math.hypot(g.ctr[0] - s.ctr[0], g.ctr[1] - s.ctr[1]) < 0.5);
+    const g = groups.find(g => g.scene === s.scene && g.name === s.match.name && s.t - g.lastT < 3 && !g.frames.has(s.frame) && Math.hypot(g.ctr[0] - s.ctr[0], g.ctr[1] - s.ctr[1]) < 0.08);
     if (g) { g.lastT = s.t; g.frames.add(s.frame); g.ctr = s.ctr; g.n++; g.hits.push(s); continue; }
-    groups.push({ name: s.match.name, lastT: s.t, frames: new Set([s.frame]), ctr: s.ctr, n: 1, hits: [s] });
+    groups.push({ scene: s.scene, name: s.match.name, lastT: s.t, frames: new Set([s.frame]), ctr: s.ctr, n: 1, hits: [s] });
   }
   // a low-confidence one-off next to a confident read of a different card at the same spot is usually a misread: keep it but unchecked
```

### 11. P1 — Reused video predictions are counted as independent confidence votes

**Location:** `public/js/record.js:51,71–73`.

A medium first read is copied for each nearby frame without OCR/image verification. Two copies then promote the result to high confidence and multiply its printing vote. A wrong read can also be reused after a subtle card swap that fails the scene-motion threshold. Minimal correctness patch removes synthetic sightings and re-identifies each selected frame. It costs CPU; a later implementation can cache pixels and require an independent evidence check before counting another vote.

Suggested patch (not applied):

```diff
--- a/public/js/record.js
+++ b/public/js/record.js
@@ -49,5 +49,5 @@
     const ctrOf = q => [q.reduce((s, p) => s + p[0], 0) / 4 / c.width, q.reduce((s, p) => s + p[1], 0) / 4 / c.height];
     const todo = [];
-    for (const q of quads) { const cc = ctrOf(q); const k = seen.find(x => x.scene === f.scene && x.conf !== 'low' && Math.hypot(x.ctr[0] - cc[0], x.ctr[1] - cc[1]) < 0.06); if (k) seen.push({ ...k, t: f.t, ctr: cc, frame: i }); else todo.push(q); }
+    for (const q of quads) { const cc = ctrOf(q); const k = seen.find(x => x.scene === f.scene && x.conf !== 'low' && Math.hypot(x.ctr[0] - cc[0], x.ctr[1] - cc[1]) < 0.06); todo.push(q); // Re-read pixels; do not manufacture a confirming sighting. }
     if (!todo.length) continue;
     const r = await idf.identifyCanvas(c, { mode: 'multi', quads: todo });
```

### 12. P1 — Video result saves silently succeed when IndexedDB fails

**Location:** `public/js/db.js:14; public/js/app.js:414,437`.

kvSet catches all errors and resolves. Video completion awaits saveJob but cannot detect a quota/IDB failure; the UI promises results are saved until reviewed, then a reload loses them. Settings/cache writes may be best-effort, but irreplaceable video results must surface storage failure. Add an observable variant and catch it in saveJob with a persistent status message; the in-memory review remains usable.

Suggested patch (not applied):

```diff
--- a/public/js/db.js
+++ b/public/js/db.js
@@ -13,4 +13,5 @@
 export const kvGet = k => hasIDB ? tx('kv', 'readonly', s => s.get(k)).catch(() => null) : Promise.resolve(null);
 export const kvSet = (k, v) => hasIDB ? tx('kv', 'readwrite', s => { s.put(v, k); }).catch(() => {}) : Promise.resolve();
+export const kvSetRequired = (k, v) => hasIDB ? tx('kv', 'readwrite', s => { s.put(v, k); }) : Promise.reject(new Error('IndexedDB unavailable'));
 export const allCards = () => tx('cards', 'readonly', s => s.getAll());
 export const putCard = c => tx('cards', 'readwrite', s => { s.put(c); });

--- a/public/js/app.js
+++ b/public/js/app.js
@@ -4,5 +4,5 @@
 import { exportCSV, exportMoxfield, importManaBox, exportGoldfish, exportArchidekt, exportDeckbox, exportManaBoxCSV, exportTCGplayer, exportText } from './csv.js';
 import { collection } from './scry.js';
-import { kvGet, kvSet } from './db.js';
+import { kvGet, kvSet, kvSetRequired } from './db.js';
 import { norm } from './match.js';
 
@@ -412,5 +412,5 @@
 }
 $('#job-pill').onclick = () => openJob();
-const saveJob = () => kvSet('videoJob', JOB.state === 'done' && JOB.items.length ? { at: Date.now(), items: JOB.items.map(i => ({ ...i, print: i.print.id, alts: i.alts.slice(0, 20).map(a => a.id) })) } : null);
+const saveJob = () => kvSetRequired('videoJob', JOB.state === 'done' && JOB.items.length ? { at: Date.now(), items: JOB.items.map(i => ({ ...i, print: i.print.id, alts: i.alts.slice(0, 20).map(a => a.id) })) } : null).catch(() => { status('Video results could not be saved — add or back them up before closing this tab'); toast('Storage full or unavailable: video results are only in memory'); });
 async function loadJob() {
   const j = await kvGet('videoJob'); if (!j?.items?.length) return;
```

### 13. P2 — Ready can precede index readiness and trigger mass downloads

**Location:** `public/js/identify.js:15–24,162–166`.

init starts loading art/prints but waits only for OCR workers. A cold first scan can use printFeat for up to 120 same-name printings and many candidate names. That turns an otherwise local scan into a network fanout and caches many promises. Wait for both index load attempts before declaring Ready. Their existing catch-to-false behavior preserves fallback when assets actually fail; issue 14 adds per-image deadlines.

Suggested patch (not applied):

```diff
--- a/public/js/identify.js
+++ b/public/js/identify.js
@@ -23,4 +23,5 @@
       this.sched.addWorker(w); progress && progress();
     }));
+    await Promise.all([this.printsReady, this.artReady]);
   }
   // ---------- image helpers
```

### 14. P2 — Printing image fetch has no deadline and failures poison the cache

**Location:** `public/js/identify.js:68–77,162–166,191`.

Only the optional four-print refinement is raced against 1.2 seconds. The fallback score path awaits every image indefinitely, so a stalled image can leave the shutter busy and video processing stuck. Failed/null feature promises are retained for the whole session, preventing recovery after connectivity returns. Bound image lifetime, clear the request source on expiry, and evict null/rejected feature promises for retry.

Suggested patch (not applied):

```diff
--- a/public/js/identify.js
+++ b/public/js/identify.js
@@ -72,5 +72,7 @@
       const f = this.feat(im); kvSet(k, { full: Array.from(f.full), art: Array.from(f.art) }); return f;
     })();
-    this.featCache.set(card.id, p); return p;
+    this.featCache.set(card.id, p);
+    p.then(f => { if (!f) this.featCache.delete(card.id); }, () => this.featCache.delete(card.id));
+    return p;
   }
   // ---------- main
@@ -189,5 +191,10 @@
 function normVec(d) { const n = d.length / 4, v = new Float32Array(n * 3); for (let ch = 0; ch < 3; ch++) { let m = 0; for (let i = 0; i < n; i++) m += d[i * 4 + ch]; m /= n; let s = 0; for (let i = 0; i < n; i++) { const x = d[i * 4 + ch] - m; v[ch * n + i] = x; s += x * x; } s = Math.sqrt(s) || 1; for (let i = 0; i < n; i++) v[ch * n + i] /= s * Math.sqrt(3); } return v; }
 function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
-function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
+function loadImg(url) { return new Promise((res, rej) => {
+  const i = new Image(); i.crossOrigin = 'anonymous';
+  const done = (fn, value) => { clearTimeout(timer); i.onload = i.onerror = null; fn(value); };
+  const timer = setTimeout(() => { done(rej, new Error('Image timeout')); i.src = ''; }, 3000);
+  i.onload = () => done(res, i); i.onerror = () => done(rej, new Error('Image unavailable')); i.src = url;
+}); }
 const ctr = q => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
 const dc = (q, x, y) => { const c = ctr(q); return Math.hypot(c[0] - x, c[1] - y); };
```

### 15. P2 — Whole-page recognition retains concurrent work and leaks source Mats on rejection

**Location:** `public/js/identify.js:86–116`.

Nine/twelve cards launch their entire OCR/retry/printing tasks concurrently on a phone, while OpenCV feature extraction and warps remain on the main thread. This retains many canvases and schedules dozens of OCR jobs. Any rejection skips src.delete(), leaking WASM memory until tab reload. Bound whole-card work (sequential is the simplest safe first patch) and release the source in finally. OCR variants still use the scheduler concurrently. More work is needed to put heavy image processing off the main thread and add try/finally within each vision helper; measure throughput before choosing a larger card concurrency limit.

Suggested patch (not applied):

```diff
--- a/public/js/identify.js
+++ b/public/js/identify.js
@@ -94,5 +94,7 @@
     }
     const tDetect = performance.now() - t0;
-    const results = await Promise.all(quads.map(async ({ q, detected }, i) => {
+    const results = [];
+    try {
+    for (const [i, { q, detected }] of quads.entries()) {
       const w = warpCard(cv, src, q); const card = this.matToCanvas(w); w.delete();
       let r = await this.identifyCard(card); let used = q, cardC = card;
@@ -104,7 +106,7 @@
         if (r2.match && (!r.match || (r2.combined ?? -9) > (r.combined ?? -9))) { r = r2; used = aq; cardC = c2; }
       }
-      return { ...r, quad: used, detected, slot: i, cardCanvas: cardC };
-    }));
-    src.delete();
+      results.push({ ...r, quad: used, detected, slot: i, cardCanvas: cardC });
+    }
+    } finally { src.delete(); }
     return { results: results.filter(r => r.match || r.detected), ms: performance.now() - t0, tDetect };
   }
```

## Validation and measured results

All commands used the installed Node v20.19.2 and `/usr/bin/google-chrome` on this host. These are desktop headless timings, not Android measurements. No deploy, push, or source patch was performed. `git diff --exit-code` is clean for tracked files. Unrelated untracked `error.log` and `test/commander/` appeared during the session and were left untouched.

### Existing tests

The existing runners write `screens/*.png` and `bench/last_*.json`. To preserve existing files, `review/test-sandbox/` holds new copies of package.json, test scripts, and benchmark runner/metadata. Its public and node_modules paths link to the originals for reads; scene/card directories link to read-only benchmark inputs. Generated screenshots and benchmark JSON stay under the sandbox. Tests themselves are unchanged.

From `review/test-sandbox/`:

```sh
# Prepare the fake camera required by the existing test; keep aspect ratio:
ffmpeg -y -hide_banner -loglevel error -loop 1 -i bench/scenes/s000.jpg \
  -vf 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2' \
  -r 10 -t 1 -pix_fmt yuv420p -f yuv4mpegpipe /tmp/cam.y4m
npm test
node bench/run.mjs single 12
node bench/run.mjs /g 3
node bench/run.mjs grid3 3
```

`npm test` **passed**, exit 0: all 12 unit-test groups, then E2E OK. UI scanned Tidal Flats, merged a duplicate, undid it, offered 3 printings, imported Sol Ring and Necropotence, and auto-added 8 cards from a 3×3 scene with no captured browser errors. See [successful log](npm-test-rerun.log) and [screenshots](test-sandbox/screens/).

An initial attempt failed waiting for a binder row because the generated fake-camera video stretched a portrait photo to landscape. Preserving its aspect ratio fixed the fixture; no app/test code changed. The failed attempt remains in [npm-test.log](npm-test.log). This failure is not counted as an app regression.

The `npm run bench` package script requests 400 singles plus 70 grid images. A short subset was used: grid scenes measured about 3–5 seconds/image, implying several minutes for the configured full run. These are the same runner/Identifier paths as that script, not a replacement algorithm.

| Existing benchmark subset | Cards | Name | Exact printing | Printing top-5 | Median / p90 ms per image |
|---|---:|---:|---:|---:|---:|
| `single 12` | 12 | 100% | 91.7% | 100% | 352 / 413 |
| `/g 3` (first three grid2 scenes) | 12 | 91.7% | 66.7% | 91.7% | 3581 / 4118 |
| `grid3 3` | 27 | 92.6% | 88.9% | 92.6% | 3759 / 5485 |

Logs: [singles](bench-single.log), [grid2](bench-grid.log), [grid3](bench-grid3.log). The singles subset contains only old93 cards; do not extrapolate it to all eras. Some checks overlapped, so timing comparisons are indicative, not controlled device performance. Existing benchmark logs include a harmless favicon 404 and OCR diagnostics. None of these scenes are real phone captures.

### New real-photo harness smoke test

From repository root:

```sh
node --check bench/real/run.mjs
node bench/real/run.mjs bench/real/sample --offline > review/sample-results.json
node bench/real/check.mjs > review/harness-check.log
```

Five images were copied byte-for-byte from the existing synthetic scenes, with truth set/CN resolved against the bundled app DB. This proves end-to-end harness integration; **no actual phone photos were supplied**, so no real-world accuracy claim is made. Finish labels are intentionally omitted because synthetic foil/glare effects do not prove physical finish.

Name accuracy **100% (5/5)**; exact printing **80% (4/5)**; top-5 printing **100% (5/5)**. Auto-add coverage **100% (5/5)**; auto-add error rate **20% (1/5 automatic additions)**; wrong-name auto-add rate **0%**. Average Identifier time **382.4 ms/card**, average decode+prepare+identify **395.2 ms/card**, separate initialization **1260.8 ms**. Zero processing exceptions. Finish accuracy is null (zero labeled finishes).

| Truth frame era | Cards | Name | Exact printing | Top-5 | Auto-add errors |
|---|---:|---:|---:|---:|---:|
| old frame (1993) | 3 | 100% | 100% | 100% | 0% |
| modern (2015) | 1 | 100% | 0% | 100% | 100% |
| full-art/borderless (combined DB flag) | 1 | 100% | 100% | 100% | 0% |

Concrete failure: `s210.jpg` is **Drudge Sentinel, DOM #89**. Identifier chose **PLST #DOM-89**, `conf=high`, `printAmbiguous=true`, with the true DOM printing second in alternatives. The current medium/high gate would store PLST automatically. See [full JSON](sample-results.json); this is direct evidence for issue 3, independent of the proposed threshold change.

`bench/real/check.mjs` independently recomputed summary metrics, checked auto-add policy/top-5 membership and verified all five sample assets against their sources: **passed** ([log](harness-check.log)). An invalid-column CSV was rejected before browser launch with exit 1 ([error](invalid-input/stderr.log)). A corrupt JPEG produced exit 2 with one failed row, zero accuracy/coverage, null auto-add error rate, and no lost denominator ([report](corrupt-input/results.json)).

Every suggested unified diff passes `git apply --check` independently against the original snapshot ([log](diff-check.log)). This checks patch context/syntax only. Suggested changes were **not applied or behavior-tested**. Integrate overlapping diffs and add targeted regressions for transaction abort/quota, interleaved mutations, duplicate correction Undo, strict restore/import, same-art printings, physical finish, and video card swaps before releasing them.

Instructions for Scott's 50-photo collection, CSV format, metric denominators, finish handling, network mode and metadata limitations are in [bench/real/README.md](../bench/real/README.md).
