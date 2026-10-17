# Commander legality acceptance pack

Run from the repository root with Node 18+:

```sh
node test/commander/run.mjs
node test/commander/run.mjs ./path/to/app-checker.mjs
```

The runner prints each case and a summary, and exits nonzero for mismatches or thrown errors. A checker module exports `checkDeck` (preferred) or a default function:

```js
export async function checkDeck(input, cardData) {
  return { legal: true, errors: [] };
}
```

Synchronous functions work too. `cardData` is loaded once by `data.mjs`; `cardData.byName` is a Map keyed by exact English full card name. An adapter may ignore it and use the app's own database. Checkers receive no fixture IDs or expected outcomes. Input is cloned per case.

```js
{
  commanders: ['Thrasios, Triton Hero', 'Tymna the Weaver'],
  cards: [{ name: 'Sol Ring', count: 1 }],
  fillBasics: [{ name: 'Wastes', count: 97 }],
  companion: 'Lurrus of the Dream-Den' // optional, outside the 100
}
```

`cards` excludes commanders. `fillBasics` adds the specified number of each named basic; it does **not** automatically top up to 100. Treat these entries exactly like ordinary cards for counting, copy limits, and identity. Aggregate repeated rows and commander copies. Companions remain outside the deck but must fit its identity and cannot duplicate a starting-deck name. Names are exact, including Unicode, punctuation, and both faces of a DFC. Counts in this pack are positive integers; malformed input validation and fuzzy name resolution are outside its scope.

## Error contract

Return all independent applicable errors, once per `(type, card)` pair. Error ordering is ignored; missing, additional, or duplicate errors fail. `card` is an exact input name for card-specific errors and `null` for deck-wide errors. Extra diagnostic properties are ignored.

| Type | Meaning | card |
| --- | --- | --- |
| `BANNED` | Commander legality code `b` in app data | offending name |
| `NOT_LEGAL` | Commander code other than `l` or `b` | offending name |
| `COLOR_IDENTITY` | Card or companion has colors outside commander union; includes basic-land restrictions | offending name |
| `DECK_SIZE` | Starting deck including all commanders is not exactly 100 | null |
| `SINGLETON` | Aggregated copies exceed card limit, or companion duplicates deck | offending name |
| `COMMANDER_COUNT` | Fewer than one or more than two commanders | null |
| `COMMANDER_PAIR` | Exactly two commanders lack a compatible pairing ability | null |
| `INVALID_COMMANDER` | Card cannot be designated commander in this configuration | offending name |
| `COMPANION` | Companion condition fails (or unsupported companion in bounded reference) | companion name |
| `UNKNOWN_CARD` | Name lacks app metadata | offending name |

For zero or more than two commanders, emit `COMMANDER_COUNT` rather than `COMMANDER_PAIR`. Still check size, card eligibility, identity against the supplied commanders' union, and individual cards. If a name is unknown, the reference returns size/unknown errors before checks requiring metadata. These are diagnostic conventions of this pack, not CR terminology. `NOT_LEGAL` and `UNKNOWN_CARD` are reserved guards; current fixtures focus on real, known Commander cards.

## Sources and data assumptions

The 103 fixtures pin the **local app snapshot**, built 2026-10-16; they do not download or update a ban list. `public/data/cards.json` has printing data and a `names` dictionary. `public/data/meta.json.info[i]` corresponds to `cards.names[i]`, with column names in `meta.cols`:

- `type`: front type line; `cmc`: mana value; `colors`: colors; `ci`: color identity string such as `WUBRG`.
- `legal`: compact legality string indexed by `meta.formats`; Commander is currently index zero. `l` = legal, `b` = banned, `n` = not legal, `r` = restricted.
- `cmdr`: coarse eligibility flag; `limit`: 0 means ordinary singleton, 999 means unlimited, otherwise explicit copy maximum; `partner`: coarse boolean.

These fields are decoded by name, not hardcoded column offsets. See `build/build_meta.py` for their origin. `bench/cards.json` contains printing/recognition information and cannot establish Commander legality.

The pack deliberately follows local legality even where historical lists differ: Lutri, Coalition Victory, and Braids are legal here. Black Lotus, Mana Crypt, Jeweled Lotus, Dockside, Prophet, Nadu, and Rofellos are banned here. Changing metadata may intentionally fail these pinned expectations; review and update fixtures deliberately.

`ci` already incorporates hybrid, Phyrexian symbols, rules text, color indicators, and alternate/back faces, while excluding reminder text. No rules-text color parser is needed in the checker. Colorless lands referring to colors in words remain colorless. Basic land types still impose CR 903.5d. The pack tests the precomputed identity outcome, not how the build pipeline derived it.

`cmdr` alone is insufficient: the builder marks enchantment Backgrounds eligible even alone and omits Grist's creature characteristic outside the battlefield. `partner` cannot distinguish named pairs, generic partners, backgrounds, or Doctor pairings. For those omitted abilities, `data.mjs` reads the existing local **`build/oracle.jsonl.gz`**, without network calls, using front-face Oracle text and types. Current Oracle calls Friends forever `Partner—Friends forever`; the reference also recognizes the legacy spelling. No hand-authored card metadata overrides or fixture-specific checker branches are used. The bulk file is required; missing data fails visibly.

The reference is intentionally bounded: it covers the fixtures, ordinary Partner, reciprocal Partner with, Friends forever, Choose a Background, and Doctor's companion. Companion conditions implemented are Lurrus and Yorion. Additional companions, other Partner—text groups, chosen color identities (Clara/Faceless One/Prismatic Piper), interchangeable names, and special commander permissions beyond the tested cards need production support and further fixtures. Do not ship this reference as the app's checker. Its `COMPANION` fallback for other companions is not a claim that those cards are illegal. Companion legality remains whatever the app's stored format code says.

Rules citations use the [official Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), linked from [Wizards' rules page](https://magic.wizards.com/en/rules). CR 903 governs Commander construction; CR 702.124 covers partner variants, CR 702.139 companions, and CR 101.1 card-text exceptions. Bans are format policy, not enumerated in CR; their fixtures cite CR 100.6 / 903.1 and use the local legality code. Lurrus checks commanders as part of the starting deck. Yorion needs 120 cards and therefore cannot be a legal companion to an exactly 100-card Commander deck.

`generate-fixtures.mjs` is the optional authoring source. It writes only `fixtures.json` in this directory and contains explicit expected errors independent of the checker:

```sh
node test/commander/generate-fixtures.mjs
```

The checked-in JSON is the acceptance artifact; running the pack never regenerates it. Decks made almost entirely of basics are intentional boundary tests, not playable deck recommendations.

## Existing app tests without changing review files

`npm test` includes an E2E script that writes screenshots to relative `screens/` paths. To preserve the review-only checkout, execute the unchanged npm script from a temporary working directory containing symlinks to this checkout's `package.json`, `node_modules`, `test`, `public`, and `bench`, plus an empty local `screens` directory. The original source and tests are used; screenshots land outside the checkout. The E2E script also expects Chrome at `/usr/bin/google-chrome` and a camera fixture at `/tmp/cam.y4m`.
