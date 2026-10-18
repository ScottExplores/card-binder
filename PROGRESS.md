# v2 progress (test build: https://next.card-binder-5zt.pages.dev — live site untouched)

## Done (committed)
- Review fixes: atomic binder writes, strict CSV import, cancel-safe jobs, nested-quad top-card detection, printing tie-break
- Deck mode (record/upload a deck video), Decks tab, Commander + Standard/Modern/Pioneer/Legacy/Vintage/Pauper checks with per-card alerts and count over/under
- Ban list verified vs official (Oct 2026): Lutri/Coalition Victory/Braids/Biorhythm legal; Lutri banned as companion
- Unsorted default binder, Last scan pop-up, filters + sorts, fix card/printing picker, one-tap Foil?
- Selling: condition pricing, $5+ tag, Keep/Sell/Trade/Bulk sort, sold log + profit, TCGplayer/eBay CSVs with price rule, spare counter
- No red in UI (amber)
- Tests: unit + unit_v2 (14) + Commander pack 106/106 + e2e + e2e_v2 + e2e_deck all pass; e2e passes against the test URL
- Benches: single 97.5% name / 88.5% exact; grid 94.4% / 78.6% (same as before); paired speed ~7% faster; deck videos 96.4%/98.2%, exact counts; real sample 5/5
- Test deploy (deploy-next.sh, branch next); screens/v2-*.png

## Next / left
- (done) Video-sweep regression: video2 84.1% recall, 0 extras (was 84.1%, 1 extra)
- Not done: real phone photos (none available), eBay sold price API (no free keyless one; link only), TCGplayer product IDs, companion picker UI, price alerts, per-batch condition

## v3 (in progress, branch next) — video hang fix, saved-clip resume, Fast scan
- Root cause of "Reading video… 1%": processDeck played a hidden 2px <video> at 2x and only advanced on requestVideoFrameCallback.
  iOS pauses media on app switch/lock (and can refuse play(); the rejection was swallowed), so the callback never fired again:
  no timer, no error, no resume. Reproduced in WebKit with a phone-like HEVC .mov: hung at ~80% in 2 of 3 runs, 0 cards in the 3rd.
- Fix: public/js/vsource.js — WebCodecs + mp4box.js decode (MP4/MOV, HEVC/H.264, iPhone rotation, fragmented MediaRecorder MP4),
  frame-accurate, any start time; fallback <video> playback with watchdog (re-play, nudge, clear error). record.js uses it, checkpoints.
  WebKit HEVC 4K + rotated iPhone .mov: 13/13 cards (was hang). deck1s Chrome 20 s (was 23 s), same accuracy.
- Jobs (app.js): clip saved to IndexedDB at once, checkpoint after each card, auto-resume on return/reload, 45 s stall watchdog
  with auto-restart from checkpoint (2x) then Retry/Discard sheet, wake lock, recording stops+saves when you leave the app,
  confident cards auto-added to the binder as one batch, unsure ones in the pill; optional notification (Android).
- Fast mode (⚡ Fast chip, 1-card): fixed box, per-camera-frame change/still trigger, Identifier.fastRead = one outline pass +
  picture-index match, no OCR (~45 ms box); misses go to the full reader in the background; boop + haptic.
  bench/fast.mjs (synthetic feed via fake camera, box under heavy load): 4 cards/s fed -> 39/40 correct, 0 wrong, 3.9 cards/s, 41 ms median.
- e2e_videojob (Playwright): reload at 30% -> resumes from 24% checkpoint, 14 cards, no duplicates, clip cleaned up — Chrome (H.264 .mov) and WebKit (rotated HEVC .mov). Clip falls back to 8 MB ArrayBuffer chunks when IDB refuses Blobs.
- All tests pass: unit + Commander 106/106, e2e, e2e_v2 (updated for auto-add), e2e_deck. Fast bench 4/s: 40/40, 0 wrong, 4.0 cards/s, 45 ms median. Screens in qa/v3/.
- Server option: R2 not enabled on the Cloudflare account; would need R2 + Workers Paid/Containers (Scott decision).
- TODO: deploy-next, push to GitHub branch next.
