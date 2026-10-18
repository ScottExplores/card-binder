# Card Binder

A Magic: The Gathering card scanner and digital binder that runs in the browser (a PWA for Android Chrome).
Live: https://card-binder-5zt.pages.dev (Cloudflare Pages project `card-binder`).
Test build of v2: https://next.card-binder-5zt.pages.dev (branch `next`, deployed with `./deploy-next.sh`; the live site is unchanged until approved).

## Using it
Four tabs: **Scan**, **Binder**, **Decks**, **Value**.
- **Scan**: pick 1 card, 4 (2×2) or 9 (3×3), then tap the shutter. **Auto** scans single cards on its own once a card holds still. **Foil** marks the next scans as foil. **Photo** scans a picture from the gallery.
  Confident results go straight into the binder, with an Undo toast. Unsure ones get an amber border and are *not* added; tap one to fix it, by printing picker or name search. Tap any result to change its printing or foil. ✕ removes it.
- **Binder**: search, an "Over $5" filter, sorting (value, name, set, newest), a List view, and a Pages view laid out like a 3×3 binder page (swipe to turn). Tap a card to change quantity, foil/etched, or printing, or to delete it. Every change can be undone.
- **Value**: total value, card count, count over $5, and the most valuable cards. You can refresh prices from Scryfall, export CSV, export for Moxfield, import a ManaBox CSV, and back up to or restore from a JSON file.

## New in v2
- **Into: chip** on Scan picks where cards go: a binder (default **Unsorted**), a deck, or "scan commander". **Last scan** pops up the latest batch (move all, sort into piles, show in Binder).
- **Decks tab / deck check**: pick a format (Commander, Standard, Modern, Pioneer, Legacy, Vintage, Pauper). For Commander, pick the commander first, then **Record deck** (or upload a video) while you deal the deck one card at a time. Alerts name the card: banned, outside color identity, duplicate non-basics, and the count (e.g. "61 short of 100"). Also partner/background rules, restricted cards (Vintage), companion (Lutri is banned only as a companion), mana curve, color pips, type/paste a list, exports for Moxfield, Archidekt and MTGGoldfish. Haptic + beep on a new alert.
- **Filters**: color (any/exact, colorless, multicolor), color identity, type, mana value, rarity, set, format legality, price range, foil, binder, date scanned, pile, last scan, $5+, name search; sorts by value, name, newest, set, mana value, color, rarity, quantity.
- **Fix a mis-scan**: tap a card → *Fix card / printing* opens a picker with images and prices: type the right name, pick the printing, finish and condition, with style chips (Old frame, Borderless, Showcase, Extended, Full art, Retro, Promo, Has foil). Tray items have a one-tap *Foil?* toggle.
- **Selling**: condition NM/LP/MP/HP/DMG adjusts the price; a $5+ tag; *Sort piles* walks through cards one at a time into Keep/Sell/Trade/Bulk with running totals; *Mark sold* logs price and profit (sales CSV); spare counter (own 6, decks use 2 → 4 spare); TCGplayer sell CSV and eBay Seller Hub CSV (drafts, auto titles `<Name> <Set> #<num> <Foil> MTG <Cond>`) with a price rule (market or −5/10/15/20%). eBay sold prices are a link (no free keyless API).
- Format data (legality, color identity, commander rules) is built from Scryfall bulk data into `data/meta.json` (`build/build_meta.py`); no API keys.

## How identification works (all on the phone)
1. **Detect**: OpenCV.js runs Canny/adaptive-threshold contours and approximates quads, filtering by card ratio. It ignores a page outline that contains several cards and drops quads that touch the frame edge. Each card is then perspective-warped to 488×680. Binder modes fall back to grid cells when a pocket isn't found.
2. **Read the name**: Tesseract.js (LSTM) reads the title bar under several preprocessings: light-text mask (old frames), dark-text mask, contrast-normalised, top-hat/black-hat, and a 180° try. It stops early once a read is confident.
3. **Match**: semi-global edit distance against all 33.8k card names (local), with voting across the preprocessings.
4. **Art check / fallback**: the card's art is compared against a PCA-64 int8 index of all 48,430 unique Scryfall artworks (`data/art.bin`, 3.4 MB). It is used when the name read is shaky. Every candidate is then verified by comparing the photo with the Scryfall images of each printing.
5. **Printing**: the most similar printing wins; exact ties prefer the original set over reprint/promo sets (The List, Secret Lair). The picker always shows every printing, closest first, then old frame.
   Deck videos: the pile outline is skipped in favour of the top card (nested-quad check); the video plays once at 2× and each "hold" is identified from its sharpest frames.
6. **Confidence**: high, medium or low. Low isn't auto-added.

Card data (`data/cards.json`) holds every English paper printing (97,399) with prices, built from Scryfall bulk data. Identification needs no API calls. Only images (cards.scryfall.io) and price refreshes go to the network.

## Benchmark (synthetic, honest caveats below)
`npm run bench` runs the real app code in headless Chrome on 470 generated photos made from 400 real Scryfall card images:
90 from 1993 old frame, 60 from 1997 old frame, 60 from 2003, 120 modern, 40 transform/MDFC, 30 showcase/borderless.
Conditions: clean, angled (perspective + rotation up to 20°), glare, sleeves, foil sheen, and combinations, on varied backgrounds. Binder pages are 2×2 (40 pages) and 3×3 (30 pages, about 430px per card) in sleeves.

| Set | Cards | Name correct | Exact printing | Printing in top 5 | Auto-added | Wrong among auto-added |
|---|---|---|---|---|---|---|
| Single cards | 400 | **98.5%** | 90.3% | 98.5% | 96.5% | 0.3% (1 card) |
| 2×2 pages | 160 | 98.1% | 81.2% | — | | |
| 3×3 pages | 270 | 97.0% | 83.3% | — | | |
| All binder pages | 430 | **97.4%** | 82.6% | 96.7% | 95.6% | 0.7% (3 cards) |

Single cards by frame: 1993 old frame 95.6%, 1997 old frame 98.3%, 2003 100%, modern 100%, DFC 100%, showcase 96.7%.
Speed on the box CPU: a single card takes 0.6 s median (1.8 s p90). A 3×3 page takes about 4.5–7 s. Expect a phone to be roughly 1.5–3× slower.

"Exact printing" is capped by same-art reprints, which can't be told apart from a photo. That's why the picker exists.

**Caveats:** these are generated photos, not real phone shots. Real glare, blur, sleeve reflections and lighting will lower the numbers. The art index is built from the same Scryfall scans the test photos came from, which flatters the art fallback. Non-English cards, tokens, art cards and heavily stylised showcase titles are not supported or are weaker.

Deck videos (`npm run bench:deck`, synthetic dealt decks of 56/57 cards from `bench/mkdeck.py`): count exact on both; 96.4% / 98.2% of cards identified (order-aware), about 100 s per 52 s video on the box CPU.

## Dev
- `npm run test:unit`: CSV/import/export, deck check (all formats), filters, deck lists, sell exports, and the Commander test pack (`test/commander/`, 106 decks, ban list as of Oct 2026).
- `node test/e2e_deck.mjs`: Commander deck flow (pick commander, deck video, paste list, alerts, export). Needs `bench/deck1s.mp4` (`python3 bench/mkdeck.py`).
- `bench/real/`: real phone-photo bench; see its README for shooting 50 photos.
- `node test/unit.mjs`: CSV, ManaBox import, Moxfield export, name matching.
- `node test/e2e.mjs [fake-cam.y4m]`: full UI flow with a fake camera (`BASE=https://... ` to test production).
- `cd build && python3 build_db.py` (needs `default.jsonl.gz` from Scryfall bulk). Then `node build/artvec.mjs && python3 build/build_art.py` rebuild the art index.
- `./deploy-next.sh` deploys a test build to the `next` preview branch. `./deploy.sh` deploys production to Cloudflare Pages and stamps the service worker cache version.

Not affiliated with Wizards of the Coast or Scryfall. Card data and images © their owners, via the Scryfall API.
