# Real phone-photo benchmark

Scott: from the repository root, run:

```sh
node bench/real/run.mjs bench/real/sample --offline > review/sample-results.json
node bench/real/run.mjs /path/to/phone-photos > review/phone-results.json
# Optional explicit CSV path and Chrome binary:
CHROME_BIN=/usr/bin/google-chrome node bench/real/run.mjs /path/to/photos /path/to/truth.csv
```

Uses installed `puppeteer-core`, Chrome, and the existing `bench/bench.html` loader. It imports the real app Identifier, OpenCV, OCR, card DB and image indices; it does not substitute an OCR implementation or feed truth to recognition. A loopback server on an ephemeral port serves the repo and selected photos. Browser/server close on success and failure. No binder writes or deployments. Run from any working directory. JSON goes to stdout and progress to stderr; redirect output only to `review/` or `bench/real/` in this review copy.

Default behavior allows the app's Scryfall fuzzy/printing-image requests. `--offline` blocks external requests and sets navigator.onLine=false; bundled scanner assets and indices still load. Use the same mode for comparisons. A fresh browser profile starts each run; caches warm within a run, as in bench/run.mjs. Initialization is reported separately, and the loader's four OCR workers match bench/run.mjs (phone UI may select two). This measures desktop Chrome unless you port the runner to an actual device; do not call these Android latency measurements.

One card per image, processed with `mode=single` and Photo import's 4000px longest-edge cap. No ground-truth quads or pre-crops. Whole binder pages with several cards need a different schema with per-slot truth; for this harness photograph a single pocket/card while retaining the surrounding plastic and page edges. Image decode failures count as incorrect and cause exit code 2 after the report. Invalid CSV, unknown DB printings, duplicate filenames, unsupported finish values, or photos outside the folder fail before scanning. Nested relative filenames are supported.

## Truth CSV

```csv
filename,name,set,collector_number,foil
001.jpg,"Thalia, Guardian of Thraben",dka,24,false
002.jpg,Lightning Bolt,m11,146,true
```

Columns are case sensitive. Use the exact full bundled DB/Scryfall name (including ` // ` for two-faced cards), lowercase set code, and collector number **as text**, including letters, stars and leading zeroes. Quote names containing commas; doubled quotes escape quotes. UTF-8, CRLF and BOM work. Optional `foil`: `true/false`, `yes/no`, `1/0`, `foil/nonfoil/normal`, or `etched`. Omit or leave blank if unknown. Do not infer finish from artificial glare in the sample.

Name accuracy is exact full-name equality. Exact printing accuracy compares the Scryfall printing ID resolved from set and collector number; finish is reported separately. Top-5 is whether the true printing is among the first five app `alts`, matching bench/run.mjs; these are printings of the winning name, not five independent name candidates. No-match and exceptions count as misses.

Auto-add uses the current app rule: a match at **medium or high** confidence (`app.js:186`), including manual Photo scans. Auto-add error rate divides wrong printing **or labeled finish** by number auto-added; null means no auto-adds. Separate wrong-name and wrong-printing rates plus coverage make the denominator explicit. Finish selection mirrors initial `S.foil=false` and `defaultFinish`, not foil detection. Labeled foils that default to nonfoil count as finish errors. This does not model camera stability gates, repeated scans, video deduplication, or someone changing the foil toggle.

`avgIdentifyMs` averages successful Identifier calls (failed calls excluded, count reported); `avgTotalMs` includes decode, canvas preparation and failed attempts for every row, excludes initialization and Node/browser transport. Per-frame-era groups come from truth printing data, not predictions: old 1993/1997, modern by frame code, and full-art/borderless. The bundled `fullart` flag merges borderless and full art, so these cannot be distinguished reliably; showcase treatments are also not separately encoded. No release-date guessing is used.

## Shoot 50 photos

1. Choose 25 physical cards, two photos each. Include roughly 8 old-frame cards (1993 and 1997), 8 modern ordinary-frame, 5 borderless/full-art/showcase and 4 unusual layouts or same-art reprints. Include at least 8 foils/etched cards across those groups. Include same-name printings from different sets and different collector numbers within a set. Keep a written inventory so you know which physical copy each shot depicts.
2. First shot per card: diffuse daylight or two lamps from opposite sides, no flash, upright, sharp title, whole card visible with a small margin. Tap focus and hold still. Keep the phone parallel; use a plain contrasting background.
3. Second shot: vary realistic challenges across cards—warm/dim room light, clear sleeves, glossy binder pockets, page seams, small glare across text or art, 15–30 degree tilt, some sideways/upside-down cards. Keep at least 10 shots through binder plastic and at least 10 through sleeves (can overlap). Do not intentionally make every shot unreadable. For foils, vary the light angle to show both subdued and strong reflections.
4. Use the normal rear camera at native resolution. Transfer original JPG/PNG/WebP files without messaging-app compression, filters or edits. Convert unsupported HEIC to JPEG first and retain the originals separately. Photograph one card/pocket per file; no cropping that removes the challenge you want to measure.
5. Name files `001.jpg` through `050.jpg` (or keep original names), one CSV row each. Manually inspect the set symbol, printed set code and collector number. Verify finish from the physical card. Do not copy the scanner's prediction into truth. Use full names from the database; for an absent printing, report the coverage gap separately rather than assigning a different set.
6. Record phone model, Android/Chrome versions, resolution, capture conditions and which two images share a physical card in a separate notes file. Keep paired images in the same train/test partition if later tuning. Freeze CSV before running. Report all 50, including failures; show subgroup counts, not just percentages.

## Included smoke sample

Five files copied byte-for-byte from existing `bench/scenes/`, with provenance in `sample/SOURCE.json`. These are **synthetically composed scenes from reference card images, not phone photos**. The CSV omits finish because simulated glare is not physical finish truth. They demonstrate integration only. A real 50-photo set has not been supplied. Results and the existing suite logs are in `review/`.
