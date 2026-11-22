## Wasteland (`wasteland`)

A theme for post-apocalyptic tables, built by the guide in `docs/appearance-themes.md`.
It suits `post_apocalyptic` and claims no genre default.

### Look

The idea is salvage.

- **Day** is the natural home: sun-bleached canvas under hard noon light, with a
  wrecked horizon and a scrap lean-to as the fallback scenery.
- **Night** is the camp after dark: cooled gunmetal with almost no colour in it,
  bone-pale lamplit ink, and a campfire and lamp under a crowded sky.
- **Corners** are heavy welded scrap plate: overlapping mismatched plates, fat
  weld beads, a washer plate with a hex bolt, and a torn inner edge. The piece
  is the same across its diagonal, so the mirrored lower corners read upright.
- **Rails** are plain bent sheet with flaking teal paint. The dents, tears and
  bolts sit at the frame's corners; nothing repeats at an even pitch.
- **Shapes** are sheet cut by hand: near-square, slightly uneven, never rounded.
- **Symbol**: a wrench (new `wrench` key in `APPEARANCE_ICONS` and `ThemeIcon.tsx`).

### The two constraints from the board

**Rust, scratches and grime stay off reading surfaces.** `--material-inset` and
`--material-paper` are flat opaque colours in both modes. The textures under
panels were painted clean (brushed steel, plain canvas weave), had their
saturation lowered, and sit under washes that are 88 to 94 percent opaque. All
wear lives in the frame, the corners and the scenery.

**Nothing competes with real warnings or selected states.** The app's own
signals were read first: warnings are amber (`#f59e0b`), the low-health bar is
orange (`#c65a24` to `#ff9d5c`) and danger is red. A safety orange, an ochre or
a hazard yellow would each sit beside one of them. The accent is therefore
**sun-bleached teal paint** (about hue 190), bluer and chalkier than Sunken
Tide's sea-glass. Rust appears only as a dark, dull edge colour and never fills
a key. The health bar keeps the shared green.

Hazard stripes appear in exactly one place: a small patch on the corner piece,
painted as worn cream and charcoal, not yellow and black. There are none on
rails, keys, alerts, bars or cards.

### One art set or two

Two, in part. The scrap frame and corner serve both modes, because rust reads
on bone and on steel alike. The texture and the scenery differ by mode
(`artDay`), because day and night are different hours of one place: canvas and
noon, steel and a fire.

### Assets and provenance

All six images are in `public/assets/themes/wasteland/`, generated on
2026-11-22 with OpenAI image generation through the Codex CLI, with no
reference images. Prompts, encoding and edits are in `art-provenance.json`.
Each image is the first the generator returned.

| File | Slot | Size |
| --- | --- | --- |
| `bent-sheet-frame-v1.webp` | frame, both modes | 146 KiB |
| `welded-scrap-corner-v1.webp` | corner, both modes | 131 KiB |
| `cooled-steel-v1.webp` | texture, night | 17 KiB |
| `bleached-canvas-v1.webp` | texture, day | 89 KiB |
| `starlit-camp-v1.webp` | scenery, night | 130 KiB |
| `wrecked-horizon-v1.webp` | scenery, day | 158 KiB |

No named settings, characters, vehicles, brands or landmarks; no lettering.

### Checks

Run on 2026-11-22 on Windows, on the final stylesheet unless a row says otherwise.

| Check | Result |
| --- | --- |
| `npm run test:appearance` | **Fails at one shared assertion**, then stops: `scripts/test-appearance.mjs` line 70 expects no shortlist for high fantasy. Any third theme that does not suit high fantasy makes the shortlist appear, which is the shortlist working as designed. With that one line set aside locally: 15 of 15 and 7 of 7 contract checks pass. The test file is unchanged on this branch. |
| `npx tsc --noEmit` | Passes |
| `npm run lint` | 0 errors, 350 warnings (none in theme files) |
| `node scripts/test-name-lookups.mjs` | 4 of 4 |
| `node scripts/test-text-comparisons.mjs` | 6 of 6 |
| `npm run build` | Passes |
| `node scripts/check-bundle-budget.mjs` | Shared CSS 119.7 KiB gzip (budget 120). Rulebook CSS 126.2 KiB (budget 126): **0.2 over**. Budgets left alone for the coordinator. |
| `theme:check -- --theme wasteland --port 3043` | 56 of 59, twice. Two are the known shared failures (Long story 320px scale 1.25, dark and light, 137.9px against 140px). The third, "Dice dialog 1360px dark large text", timed out waiting 20 seconds for the roll result in both full runs and passed in `--dice-only` (17 of 17) straight after. |
| `theme:check --layout-only` | 15 of 16; the miss was the first page timing out while the dev server compiled. The same check passes inside both full runs. |
| Browser scenarios `theme-corners`, `phone-frame`, `day-inks` | 5 of 5 (desktop and phone where each runs) |

Not run: the full `npm test`, CI, the app shells, a real phone.

### Shared files touched

- `src/lib/appearance-themes.ts`: one catalog entry after `fey`, and `wrench` appended to `APPEARANCE_ICONS`.
- `src/components/ThemeIcon.tsx`: `Wrench` in the import and the map.
- `src/app/globals.css`: one import after `inferno.css`.

Not touched: the bundle budget numbers and note, and the symbol sentence in `docs/appearance-themes.md`.

### Limits

- Each image is a first generation. Albert has not reviewed the art yet.
- The table corner is 96px and the table rail 30px on desktop, both larger than the shared sizes. Phones keep the shared sizes.
- The lower lobby corners were checked by the `theme-corners` scenario and on the table screenshots, not in a lobby screenshot scrolled to its foot.
- The picker card shows the frame and the wrench, not the corner piece, as for every theme.
- The teal accent shares a hue family with Sunken Tide. They suit different genres, so the shortlist does not show them together.
- Screenshots are in `theme-review/screens/` and comparison sheets against Deep Forge and Inferno in `theme-review/compare/`.
