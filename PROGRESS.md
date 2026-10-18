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
