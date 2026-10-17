# Card Binder review handoff

- This is `/workspace/card-binder-review`, a review copy of the live project at
  `/workspace/card-binder`. Keep review findings distinct from shipped fixes.
- Card Binder is an MTG scanner/binder PWA for Android Chrome: OpenCV detection,
  Tesseract OCR, local name/art/printing matching, binder management and CSV/JSON IO.
- Read `review/REVIEW.md` for findings, proposed diffs, evidence and test logs;
  proposed patches there have not been applied to the app.

## Commands (from repository root unless noted)

- Dependencies: `npm ci` (requires package downloads if not cached).
- Preview: `python3 -m http.server 8080 --bind 127.0.0.1 --directory public`.
- No JS bundler or `npm run build`: `public/` is the runnable static PWA.
- DB build: `npm run build:db` runs `cd build && python3 build_db.py`, reading
  `build/default.jsonl.gz` and overwriting `public/data/cards.json`.
- Art rebuild: `node build/artvec.mjs`, then `(cd build && python3 build_art.py)`;
  needs local `build/art/` images, Chrome and Python NumPy. Preserve row alignment
  across generated DB/indices; do not casually regenerate the review snapshot.
- Unit tests: `node test/unit.mjs`; `npm test` runs units then `node test/e2e.mjs`.
- E2E: `node test/e2e.mjs /tmp/cam.y4m screens`; requires Python 3,
  `/usr/bin/google-chrome`, an existing screenshot directory and a valid Y4M feed.
- Generate the default feed (ffmpeg required; preserve portrait aspect ratio):
  `ffmpeg -y -hide_banner -loglevel error -loop 1 -i bench/scenes/s000.jpg -vf 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2' -r 10 -t 1 -pix_fmt yuv420p -f yuv4mpegpipe /tmp/cam.y4m`
- E2E defaults to localhost:8766; `BASE` overrides the URL, `GRID` the grid photo.
  It writes `screens/*.png` and `/tmp/mb.csv`; a distorted feed can fail recognition.
- `npm run bench`: 400 singles then 70 grid scenes; overwrites
  `bench/last_results.json` and `bench/last_fails.json` on each invocation.
- Short runs: `node bench/run.mjs single 12`, `node bench/run.mjs /g 3`,
  `node bench/run.mjs grid3 3`. Needs Chrome/Python; serves repo on port 8765.
- Existing browser tests/bench can request Scryfall; they are not offline checks.
  Use the documented `review/test-sandbox/` workflow to preserve original outputs.
- Real-photo harness: `node bench/real/run.mjs bench/real/sample --offline`;
  JSON on stdout, progress on stderr. See `bench/real/README.md` for truth CSV,
  metric definitions and phone-photo collection; bundled sample is synthetic.
- Commander pack: `node test/commander/run.mjs`; see `test/commander/README.md`.
  Requires local Oracle bulk data; reference checker is bounded, not production.
- Deployment (reference only; do not run for review): `npm run deploy` or
  `bash deploy.sh`. Script recreates `dist/` from `public/`, stamps SW/app versions,
  then uses Wrangler 3 to deploy Cloudflare Pages project `card-binder`, branch main.
  It uses `CLOUDFLARE_API_TOKEN` or `/workspace/.secrets/cloudflare_token`.

## Folder and data map

- `public/`: HTML/CSS, manifest/service worker, bundled scanner libraries/assets.
- `public/js/`: UI (`app.js`), binder/IndexedDB, CSV, recognition and index loaders.
- `public/data/`: `cards.json` printings/prices, `meta.json` rules/legality snapshot,
  `art.bin` and `prints.bin` recognition indices; snapshots are not live rules data.
- `build/`: Python/Node data builders, bulk `default.jsonl.gz`/`oracle.jsonl.gz`,
  IDs and intermediate feature vectors; download helpers may use the network.
- `bench/`: synthetic scenes, source cards, truth and runners; `test/`: unit/E2E;
  `screens/`: generated UI captures; `review/`: review reports and isolated outputs.
- User binder records live in browser IndexedDB `card-binder`, scoped to origin;
  they are not files in `public/data/`. Browser SW caches can retain old assets.
- Synthetic desktop benchmark accuracy/timing does not establish phone performance;
  same-art printings and physical foil identification remain important limitations.
