from pathlib import Path
import difflib
issues=[]
def issue(title,where,why,patches):
 diffs=[]
 for file,changes in patches:
  src=Path(file).read_text();new=src
  for a,b in changes:
   assert a in new,(title,a[:80]);new=new.replace(a,b,1)
  diffs.append(''.join(difflib.unified_diff(src.splitlines(True),new.splitlines(True),fromfile='a/'+file,tofile='b/'+file,n=2)))
 issues.append((title,where,why,'\n'.join(diffs)))
issue('P1 — Binder writes are neither atomic nor commit-first','public/js/binder.js:17–20; public/js/db.js:12',
'A multi-card scan or printing change commits one entry per transaction and mutates memory before persistence. A quota error, aborted tab or failed second write leaves a partial scan; a printing change can delete the source before the destination is durable. There is no undo record on failure. An abort without an error event can also leave tx pending. Commit the batch in one transaction before updating memory; retain undo until success.',[
('public/js/db.js',[("t.onerror = () => rej(t.error);", "t.onerror = t.onabort = () => rej(t.error || new Error('Storage transaction aborted'));"),("export const clearCards", "export const commitChanges = changes => tx('cards', 'readwrite', s => {\n  for (const c of changes) c.after ? s.put(c.after) : s.delete(c.key);\n});\nexport const clearCards")]),
('public/js/binder.js',[("allCards, putCard, delCard", "allCards, commitChanges"),("    for (const c of changes) { if (c.after) { this.map.set(c.key, c.after); await putCard(c.after); } else { this.map.delete(c.key); await delCard(c.key); } }", "    await commitChanges(changes);\n    for (const c of changes) c.after ? this.map.set(c.key, c.after) : this.map.delete(c.key);"),("const u = this.undoStack.pop();", "const u = this.undoStack[this.undoStack.length - 1];"),("await this.apply(inv, null); return u.label;", "await this.apply(inv, null); this.undoStack.pop(); return u.label;")])])
issue('P1 — Correcting one of several copies loses a copy on Undo','public/js/app.js:249',
'With quantity 2, correcting a tray printing first decrements the original with label=null, then records only the destination addition. Undo removes the destination but never restores the original quantity. A failure between the two writes also loses the copy. Use one inverse-action batch (with issue 1 for durable atomicity).',[
('public/js/app.js',[("await binder.apply([{ key: k, before: cur, after: { ...cur, qty: cur.qty - 1 } }], null); await binder.add([{ print: p, finish }], 'Changed printing');", "const nk = Binder.key(p.id, finish);\n      if (nk !== k) {\n        const target = binder.get(nk);\n        await binder.apply([\n          { key: k, before: cur, after: { ...cur, qty: cur.qty - 1 } },\n          { key: nk, before: target || null, after: target ? { ...target, qty: target.qty + 1 } : Binder.fromPrint(p, finish) }\n        ], 'Changed printing');\n      }")])])
issue('P1 — Name confidence auto-adds ambiguous exact printings','public/js/identify.js:183–185; public/js/app.js:185–186',
'The early break at line 170 can leave only one name score, so margin compares against -1 rather than another evaluated name. High confidence can coexist with printAmbiguous=true. The UI auto-adds medium too and drops the ambiguity flag. The sample reproduces a high-confidence DOM Drudge Sentinel being replaced by PLST. Conservative patch: review ambiguous printings and require high confidence to auto-add, retaining the ambiguity flag. Threshold calibration needs the real 50-photo set; this patch trades coverage for precision.',[
('public/js/app.js',[("alts: r.alts || [], conf: r.match ? r.conf : 'low'", "alts: r.alts || [], printAmbiguous: !!r.printAmbiguous, conf: r.match ? r.conf : 'low'"),("if (t.conf !== 'low') { items.push", "if (t.conf === 'high' && !t.printAmbiguous) { items.push"),("if (!top || top.conf === 'low')", "if (!top || top.conf !== 'high' || top.printAmbiguous)")])])
issue('P1 — Restore accepts inconsistent identities and invalid quantities','public/js/app.js:373',
'Restore checks only truthiness and qty>0. A backup can contain id A under key B, fractional/string/infinite quantities, invalid finishes or duplicate keys. Later delete/change operations then target the wrong entry, totals can concatenate strings, and Undo of duplicate keys is inconsistent. Check app/version and all rows before any write; rebuild identity metadata from the local DB. This preserves existing merge/overwrite semantics (entries absent from the backup remain). Unknown DB printings are rejected, not silently dropped.',[
('public/js/app.js',[("const ch = j.cards.filter(c => c.key && c.id && c.qty > 0).map(c => ({ key: c.key, before: binder.get(c.key) || null, after: c }));", "if (j.app !== 'card-binder' || j.v !== 1 || !Array.isArray(j.cards)) throw new Error('Invalid backup');\n    const keys = new Set();\n    const ch = j.cards.map(c => {\n      const p = db().byId.get(c.id), f = { nonfoil: 'n', foil: 'f', etched: 'e' }[c.finish];\n      if (!p || !f || !p.fin.includes(f) || !Number.isSafeInteger(c.qty) || c.qty < 1 || c.key !== Binder.key(c.id, c.finish) || keys.has(c.key)) throw new Error('Invalid entry');\n      keys.add(c.key);\n      return { key: c.key, before: binder.get(c.key) || null, after: { ...c, ...Binder.fromPrint(p, c.finish, c.qty) } };\n    });")])])
# Serialize the entire operation, not just its already-computed changes.
binder=Path('public/js/binder.js').read_text()
changes=[('  async apply(changes, label)', '  async _apply(changes, label)'),('this.apply(', 'this._apply(')]
# replace all internal references in a single replacement
new=binder.replace('  async apply(changes, label)', '  async _apply(changes, label)').replace('this.apply(', 'this._apply(')
new+='''\n// Serialize state reads and commits, including external apply calls.\nfor (const name of ['apply', 'add', 'setQty', 'remove', 'change', 'undo', 'updatePrices']) {\n  const operation = name === 'apply' ? Binder.prototype._apply : Binder.prototype[name];\n  Binder.prototype[name] = function (...args) {\n    const next = (this.writeQueue || Promise.resolve()).then(() => operation.apply(this, args));\n    this.writeQueue = next.catch(() => {});\n    return next;\n  };\n}\n'''
issue('P1 — Concurrent binder operations read stale quantities','public/js/binder.js:22–30,35–45',
'Rapid quantity taps, double-clicking video Add, or import while a scan finishes can overlap before await putCard resolves. For a multi-key operation, the first key changes in memory while later keys are still stale; another mutation can read that half-applied state. Undo of the earlier batch can then overwrite the later operation. Before/after snapshots interleave and undo history ceases to describe the actual state. Commit-first alone (issue 1) makes lost-update risk more obvious: two adds can both compute qty+1 from the same old value. Serialize the whole read/compute/write operation. Suggested patch composes with issue 1; internal _apply avoids queue deadlock. Cross-tab edits still need a DB-level read-modify-write or a single-writer tab policy.',[('public/js/binder.js',[(binder,new)])])
issue('P1 — Import silently substitutes a different explicit printing','public/js/csv.js:37–43',
'If a supplied set/collector number fails, the name fallback ignores the missing collector number and ultimately chooses another printing. The row is counted imported, not missing. A valid set/CN paired with a conflicting name is also accepted. Quantities are truncated/clamped and finish support is never checked. Reject conflicting/invalid explicit identifiers before the permissive name-only fallback.',[
('public/js/csv.js',[("    if (!p && name) {", "    if (p && name && p.name !== name && p.name.split(' // ')[0] !== name) { missing.push(r.join(',')); continue; }\n    if (!p && ((iSid >= 0 && r[iSid]?.trim()) || (iSet >= 0 && r[iSet]?.trim()) || (iCn >= 0 && r[iCn]?.trim()))) { missing.push(r.join(',')); continue; }\n    if (!p && name) {"),("    items.push({ print: p, finish, qty: Math.max(1, parseInt(iQty >= 0 ? r[iQty] : '1', 10) || 1) });", "    const qty = Number(iQty >= 0 ? r[iQty] : 1);\n    if (!Number.isSafeInteger(qty) || qty < 1 || !p.fin.includes({ nonfoil: 'n', foil: 'f', etched: 'e' }[finish])) { missing.push(r.join(',')); continue; }\n    items.push({ print: p, finish, qty });")])])
issue('P1 — Close matches deliberately favor an old frame over better evidence','public/js/identify.js:180–182',
'Any old-frame printing within 0.03 of the best image score replaces the actual best score, regardless of observed frame. This systemically biases set/CN and frame picks on same-art reprints. Keep the visual winner and expose ambiguity for user review (issue 3). Recognizing collector-number/set text would be the stronger long-term discriminator.',[
('public/js/identify.js',[("    const pick = near.find(x => isOldFrame(x.p)) || near[0];", "    const pick = scored[0];")])])
issue('P1 — Finish defaults can silently mislabel a foil','public/js/app.js:13,186,196,257',
'No image stage detects foil. With the initial toggle OFF every printing that supports normal and foil is stored normal; after toggling ON, later nonfoils can be stored foil. The UI currently treats that guess as final. Keep an explicit unknown state initially and require finish confirmation for dual-finish cards; users can still explicitly choose a session finish with the existing toggle. This is a conservative partial UX change: video review should likewise require a deliberate finish choice for mixed-finish printings.',[
('public/js/app.js',[("auto: false, foil: false", "auto: false, foil: null"),("if (t.print) { t.finish = chooseFinish(t.print);", "if (t.print) { t.finish = chooseFinish(t.print);\n      if (S.foil === null && t.print.fin.length > 1) t.conf = 'low';")])])
issue('P1 — Cache-first indices can be mixed with a newer card row ordering','public/sw.js:2,11–13; public/js/printindex.js:10–14',
'Print/art vectors refer to numeric rows in cards.json with no identity validation. V stays cb-v1, vendor/data requests are cache-first indefinitely, while JS is network-first. After an interrupted update or partial cache eviction a newer cards.json can coexist with older indices, producing unrelated printing scores without an error. Minimal mitigation is release-versioned shell/data caching; every database/index release must bump this version and regenerate all three together. A content-hash manifest validated in each loader is still needed for strong integrity.',[
('public/sw.js',[("const V = 'cb-v1';", "// Bump on every atomic cards.json + art.bin + prints.bin release.\nconst V = 'cb-v2';"),("const big = /\\/(vendor|data)\\//.test(u.pathname);", "const big = /\\/(vendor|data)\\//.test(u.pathname);"),("caches.match(e.request).then(r => r || fetch(e.request)", "caches.open(V).then(cache => cache.match(e.request)).then(r => r || fetch(e.request)")])])
issue('P1 — Video dedupe merges distinct physical cards across scenes','public/js/record.js:64–66',
'Grouping uses name, <3 seconds and a very loose half-image center distance. Two consecutive cards or two binder pages containing the same name can collapse into qty=1, including different set/CN printings. The scene ID already exists but is ignored. Require the same scene and a tighter position match. This intentionally favors overcounting at scene boundaries, which review can correct, over silent undercounting.',[
('public/js/record.js',[("g => g.name === s.match.name &&", "g => g.scene === s.scene && g.name === s.match.name &&"),("< 0.5);", "< 0.08);"),("groups.push({ name: s.match.name,", "groups.push({ scene: s.scene, name: s.match.name,")])])
issue('P1 — Reused video predictions are counted as independent confidence votes','public/js/record.js:51,71–73',
'A medium first read is copied for each nearby frame without OCR/image verification. Two copies then promote the result to high confidence and multiply its printing vote. A wrong read can also be reused after a subtle card swap that fails the scene-motion threshold. Minimal correctness patch removes synthetic sightings and re-identifies each selected frame. It costs CPU; a later implementation can cache pixels and require an independent evidence check before counting another vote.',[
('public/js/record.js',[("if (k) seen.push({ ...k, t: f.t, ctr: cc, frame: i }); else todo.push(q);", "todo.push(q); // Re-read pixels; do not manufacture a confirming sighting.")])])
issue('P1 — Video result saves silently succeed when IndexedDB fails','public/js/db.js:14; public/js/app.js:414,437',
'kvSet catches all errors and resolves. Video completion awaits saveJob but cannot detect a quota/IDB failure; the UI promises results are saved until reviewed, then a reload loses them. Settings/cache writes may be best-effort, but irreplaceable video results must surface storage failure. Add an observable variant and catch it in saveJob with a persistent status message; the in-memory review remains usable.',[
('public/js/db.js',[("export const allCards", "export const kvSetRequired = (k, v) => hasIDB ? tx('kv', 'readwrite', s => { s.put(v, k); }) : Promise.reject(new Error('IndexedDB unavailable'));\nexport const allCards")]),
('public/js/app.js',[("import { kvGet, kvSet }", "import { kvGet, kvSet, kvSetRequired }"),("const saveJob = () => kvSet('videoJob',", "const saveJob = () => kvSetRequired('videoJob',"),("} : null);\nasync function loadJob", "} : null).catch(() => { status('Video results could not be saved — add or back them up before closing this tab'); toast('Storage full or unavailable: video results are only in memory'); });\nasync function loadJob")])])
issue('P2 — Ready can precede index readiness and trigger mass downloads','public/js/identify.js:15–24,162–166',
'init starts loading art/prints but waits only for OCR workers. A cold first scan can use printFeat for up to 120 same-name printings and many candidate names. That turns an otherwise local scan into a network fanout and caches many promises. Wait for both index load attempts before declaring Ready. Their existing catch-to-false behavior preserves fallback when assets actually fail; issue 14 adds per-image deadlines.',[
('public/js/identify.js',[("      this.sched.addWorker(w); progress && progress();\n    }));", "      this.sched.addWorker(w); progress && progress();\n    }));\n    await Promise.all([this.printsReady, this.artReady]);")])])
issue('P2 — Printing image fetch has no deadline and failures poison the cache','public/js/identify.js:68–77,162–166,191',
'Only the optional four-print refinement is raced against 1.2 seconds. The fallback score path awaits every image indefinitely, so a stalled image can leave the shutter busy and video processing stuck. Failed/null feature promises are retained for the whole session, preventing recovery after connectivity returns. Bound image lifetime, clear the request source on expiry, and evict null/rejected feature promises for retry.',[
('public/js/identify.js',[("    this.featCache.set(card.id, p); return p;", "    this.featCache.set(card.id, p);\n    p.then(f => { if (!f) this.featCache.delete(card.id); }, () => this.featCache.delete(card.id));\n    return p;"),("function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; }); }", "function loadImg(url) { return new Promise((res, rej) => {\n  const i = new Image(); i.crossOrigin = 'anonymous';\n  const done = (fn, value) => { clearTimeout(timer); i.onload = i.onerror = null; fn(value); };\n  const timer = setTimeout(() => { done(rej, new Error('Image timeout')); i.src = ''; }, 3000);\n  i.onload = () => done(res, i); i.onerror = () => done(rej, new Error('Image unavailable')); i.src = url;\n}); }")])])
src=Path('public/js/identify.js').read_text()
start=src.index('    const results = await Promise.all(quads.map(')
end=src.index('\n  // OCR the title bar',start)
old=src[start:end]
new=old.replace('    const results = await Promise.all(quads.map(async ({ q, detected }, i) => {', '    const results = [];\n    try {\n    for (const [i, { q, detected }] of quads.entries()) {').replace('      return { ...r, quad: used, detected, slot: i, cardCanvas: cardC };', '      results.push({ ...r, quad: used, detected, slot: i, cardCanvas: cardC });').replace('    }));\n    src.delete();','    }\n    } finally { src.delete(); }')
issue('P2 — Whole-page recognition retains concurrent work and leaks source Mats on rejection','public/js/identify.js:86–116',
'Nine/twelve cards launch their entire OCR/retry/printing tasks concurrently on a phone, while OpenCV feature extraction and warps remain on the main thread. This retains many canvases and schedules dozens of OCR jobs. Any rejection skips src.delete(), leaking WASM memory until tab reload. Bound whole-card work (sequential is the simplest safe first patch) and release the source in finally. OCR variants still use the scheduler concurrently. More work is needed to put heavy image processing off the main thread and add try/finally within each vision helper; measure throughput before choosing a larger card concurrency limit.',[('public/js/identify.js',[(old,new)])])
intro='''# Independent Card Binder review

Reviewed 2026-10-17. Scope: scan identity/printing correctness, Android resource use, collection integrity, import/backup and video review. No existing source or asset was edited; all suggestions below are **unapplied**. Diffs are independent against this snapshot; overlapping proposals need integration, especially binder serialization/atomicity and the conservative scan/finish gates. They are review sketches with explicit limits, not a tested release patch.

## What is already good

- Detection, perspective warp, several OCR treatments, local fuzzy names, and independent artwork/printing evidence form a sensible layered pipeline. Sleeve-inner retries and rotated-title handling address practical failure modes.
- Compact local print/art indices and cached image features avoid repeated network scans once ready. Live outlines use a worker and small frames.
- Binder keys include printing and finish; duplicate adds merge quantities. Inverse actions support whole-scan Undo. Backups and several CSV exports give users a route out of browser-only storage.
- Low-confidence results stay reviewable, and per-printing alternatives are available. Unit and browser tests already cover useful flows.

No localStorage usage was found in the app JS. Binder and saved video jobs live in IndexedDB; Cache Storage holds shell/index/image assets. Neither IndexedDB nor Cache Storage is a substitute for a downloaded backup, and no persistent-storage request is present.

## Ranked top 15

Ranking combines irreversible collection errors, wrong automatic picks, affected frequency and phone responsiveness. P1 items can silently change or lose collection identity/counts; P2 items primarily affect responsiveness/recovery. Static findings are distinguished from the smoke-test reproduction below.

'''
text=intro
for i,(title,where,why,diff) in enumerate(issues,1):
 text+=f'### {i}. {title}\n\n**Location:** `{where}`.\n\n{why}\n\nSuggested patch (not applied):\n\n```diff\n{diff}```\n\n'
Path('review/REVIEW.md').write_text(text)
Path('review/proposed-diffs.json').write_text(__import__('json').dumps([d for *_,d in issues]))
import json
r=json.loads(Path('review/sample-results.json').read_text());s=r['summary']
validation='''## Validation and measured results

All commands used the installed Node v20.19.2 and `/usr/bin/google-chrome` on this host. These are desktop headless timings, not Android measurements. No deploy, push, or source patch was performed. `git diff --exit-code` is clean for tracked files. Unrelated untracked `error.log` and `test/commander/` appeared during the session and were left untouched.

### Existing tests

The existing runners write `screens/*.png` and `bench/last_*.json`. To preserve existing files, `review/test-sandbox/` holds new copies of package.json, test scripts, and benchmark runner/metadata. Its public and node_modules paths link to the originals for reads; scene/card directories link to read-only benchmark inputs. Generated screenshots and benchmark JSON stay under the sandbox. Tests themselves are unchanged.

From `review/test-sandbox/`:

```sh
# Prepare the fake camera required by the existing test; keep aspect ratio:
ffmpeg -y -hide_banner -loglevel error -loop 1 -i bench/scenes/s000.jpg \\
  -vf 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2' \\
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

'''
validation+=f"Name accuracy **{s['nameAccuracy']:.0%} (5/5)**; exact printing **{s['exactPrintingAccuracy']:.0%} (4/5)**; top-5 printing **{s['top5PrintingAccuracy']:.0%} (5/5)**. Auto-add coverage **100% (5/5)**; auto-add error rate **20% (1/5 automatic additions)**; wrong-name auto-add rate **0%**. Average Identifier time **{s['avgIdentifyMs']:.1f} ms/card**, average decode+prepare+identify **{s['avgTotalMs']:.1f} ms/card**, separate initialization **{r['initMs']:.1f} ms**. Zero processing exceptions. Finish accuracy is null (zero labeled finishes).\n\n"
validation+='| Truth frame era | Cards | Name | Exact printing | Top-5 | Auto-add errors |\n|---|---:|---:|---:|---:|---:|\n'
for era,v in r['byFrameEra'].items():
 validation+=f"| {era} | {v['cards']} | {v['nameAccuracy']:.0%} | {v['exactPrintingAccuracy']:.0%} | {v['top5PrintingAccuracy']:.0%} | {v['autoAddErrorRate']:.0%} |\n"
validation+='''
Concrete failure: `s210.jpg` is **Drudge Sentinel, DOM #89**. Identifier chose **PLST #DOM-89**, `conf=high`, `printAmbiguous=true`, with the true DOM printing second in alternatives. The current medium/high gate would store PLST automatically. See [full JSON](sample-results.json); this is direct evidence for issue 3, independent of the proposed threshold change.

`bench/real/check.mjs` independently recomputed summary metrics, checked auto-add policy/top-5 membership and verified all five sample assets against their sources: **passed** ([log](harness-check.log)). An invalid-column CSV was rejected before browser launch with exit 1 ([error](invalid-input/stderr.log)). A corrupt JPEG produced exit 2 with one failed row, zero accuracy/coverage, null auto-add error rate, and no lost denominator ([report](corrupt-input/results.json)).

Every suggested unified diff passes `git apply --check` independently against the original snapshot ([log](diff-check.log)). This checks patch context/syntax only. Suggested changes were **not applied or behavior-tested**. Integrate overlapping diffs and add targeted regressions for transaction abort/quota, interleaved mutations, duplicate correction Undo, strict restore/import, same-art printings, physical finish, and video card swaps before releasing them.

Instructions for Scott's 50-photo collection, CSV format, metric denominators, finish handling, network mode and metadata limitations are in [bench/real/README.md](../bench/real/README.md).
'''
with Path('review/REVIEW.md').open('a') as f:f.write(validation)
