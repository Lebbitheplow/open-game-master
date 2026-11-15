# Hearth & Haven handoff

Hearth & Haven (`hearth`) adds crafted oak joinery, bead-carved trim, amber
fittings and a welcoming fireside interior to the existing appearance picker.
Day mode uses warm parchment; night mode uses deep brown reading surfaces and
amber ink. It is a fantasy variant selected explicitly, with no genre claim.

## Location and dependency

- Owner: Codex Hearth session `01a1dc7c-174e-7d53-8359-175b5c09ae65`.
- Worktree: `theme-hearth-haven`; branch: `codex/hearth-haven-theme`.
- Corrected implementation commit: `d0f70d3b37779dc9635ef65f2640bb818a60d957`.
- Previous implementation commit: `11ddc89e20c7913c7a79c4ffaf986b566ee9f6ad`
  (initial artwork and treatment: `2b815657967915c4eaf222cd6242425bcd118298`).
- Draft delivery: [PR 967](https://github.com/Lebbitheplow/open-game-master/pull/967).
- Required base: PR 962, commit `cab3070dc96c895a1d8aae8d6dd34b05c1a6ef65`,
  integrated with the shared header/material fixes and November 15 accessibility,
  foe-card and laptop-map corrections.
- Delivery remains draft. Do not merge before the shared framework is ready.
- Browser port: 3031. Preview databases contain only generated fictional data.

The only shared code edits are the catalog entry, `flame` icon mapping and
stylesheet import. The renderer, shared material system, genre defaults and
gameplay code are unchanged. When combining sibling theme branches, retain both
catalog entries, symbols, imports and coordination rows. No shared-framework
extension was needed.

The shared layout now reserves the Back link and title columns through the
neutral `session-back`, `session-heading` and `session-controls` hooks. Hearth's
duplicate positional phone rules have been removed. Its bright player-hand label
remains theme-specific because that label sits over a dark map in both modes.

Hearth supplies oak/amber values for `--material-send-wash`,
`--material-send-edge` and `--material-chosen-wash`. The selected mode's visible
fill is the moving `.motion-pill`; the focused checks read that surface. Healthy
and low-health bars retain the shared semantic styling. The flame mapping and
all original artwork remain, alongside the newly available shared waves icon.

## Artwork and implementation

Production files live in `public/assets/themes/hearth/`:

| File | Dimensions | Bytes | Use |
| --- | --- | --- | --- |
| `carved-oak-frame-v1.webp` | 1254 × 1254 | 724,374 | Frame and four cropped corners; original alpha preserved |
| `honey-oak-v1.webp` | 1254 × 1254 | 269,326 | Opaque restrained wood grain |
| `fireside-haven-v1.webp` | 1536 × 1024 | 361,970 | Opaque fallback tavern scenery |

The total is 1,355,670 bytes. Every file is below 2 MiB. The frame uses the
standard 22% slice and `cornerScale: 4`, displaying the top-left 25% of each
axis for each rotated corner. Table/map corners are 48px on desktop and 32px
on phones; lobby corners are 144px and 88px.

The built-in OpenAI image generator created original artwork without outside
reference images. Full prompts, source filenames, date, encoding and rights
context are in `art-provenance.json`. Frame encoding is lossless WebP; other
images use quality 88. Source PNGs remain in the generating chat and the ignored
local `.theme-preview/hearth/art-source/` directory.

The theme owns `src/app/styles/themes/hearth.css`. It supplies both complete
palettes and material variables. Existing campaign covers and scene paintings
retain priority over fallback scenery. The shared ornament renderer handles
the lobby, story, combat and enlarged-map portal, including forced colors.

This adds one requested choice to the existing picker, rather than a separate
setting. Existing themes do not provide this indoor tavern treatment. Players
who want it select it in the same personal or campaign appearance control;
Follow campaign and all existing defaults retain their behavior.

## November 15 shared CI correction

Implementation `d0f70d3b37779dc9635ef65f2640bb818a60d957` integrates PR 962 through
`cab3070dc96c895a1d8aae8d6dd34b05c1a6ef65`. Hearth's own artwork, palettes, oak action
materials, flame icon and map-hand label rule are unchanged. The imported update:

- Restores readable builder, sheet, menu and encounter-disclosure text.
- Keeps a hostile companion's red border distinct from the party border.
- Removes the duplicate header initiative ribbon below 1440px, leaving more
  room for the map while keeping turn order on the board and turn banner.
- Prevents the empty ornament container from obscuring narration during axe
  checks. Its painted rails and corners remain visible.
- Corrects the shared browser assertions to measure actual background surfaces
  and painted color channels, retaining the contrast and foe-color requirements.

No duplicate Hearth-specific fixes were added. The newer theme-planning records
and shared validation sections were preserved when reconciling the documentation.

## Validation on the integrated source

Checked on 2026-11-15 using a newly built production server and disposable
fictional campaigns. The application source is exactly `d0f70d3b37779dc9635ef65f2640bb818a60d957`.

| Check | Result |
| --- | --- |
| Appearance catalog / artwork contracts | 12 + 5 passed |
| Targeted component suites | Four files passed: adventuring gear, builder gear, builder reselect and possessive title case |
| Full lint | Passed: 0 errors, 313 existing warnings |
| Production build and TypeScript | Passed, with two page workers and `RAYON_NUM_THREADS=2` |
| Existing bundle budgets | Passed: shared CSS 107.5 KiB / 112, rulebook CSS 114.1 KiB / 119; all JS budgets passed |
| Hearth production appearance matrix | 59 passed, 0 failed, including the new visible frame/corner assertions |
| Hearth readability checks | 20 passed: 16 phone headers, 2 map labels, 2 action-contrast cases |
| Affected shared browser cases | 21 passed, 0 failed in one production run |

The shared-browser run covers name menus, day boards, split narration,
companion allegiance, hand-on-board, builder accessibility, spell/identity steps,
character sheets and both fight benches. These repository fixtures use their
default appearance; they are distinct from the Hearth-specific 59 + 20 checks.

The Hearth action checks use an enabled Send control and the actual moving
`.motion-pill` selection surface. Minimum text contrast against the opaque
gradient endpoints remains 7.50:1 for Send and 7.36:1 for the selected mode in both
brightness modes. The material regression preserves low-health styling.

Manual review covers refreshed day/night combat at desktop and laptop widths,
phone titles and enabled action controls, enlarged-map frame clearance and the
selected phone picker. The rails/corners remain visible, the title and Back link
stay separate, and the 1360px combat view has more board space. The 1024px
enlarged-text limitation below remains visible in manual review.

Commands used from this worktree:

- `npm run test:appearance`
- `node node_modules/vitest/vitest.mjs run scripts/test-adventuring-gear.mjs scripts/test-builder-gear.mjs scripts/test-builder-reselect.mjs scripts/test-possessive-title-case.mjs --maxWorkers=2`
- `npm run lint`; `npm run build`; `node scripts/check-bundle-budget.mjs`
- `node scripts/appearance/browser-check.mjs --theme hearth --port 3031`
- `node scripts/appearance/hearth-readability-check.mjs --theme hearth --port 3031`
- `node scripts/browser/run.mjs --only name-menu,day-board,split-line,companion-conduct,hand-on-board,builder-a11y,creator-spells-identity,creator-sheets,fight-bench,fight-bench-2 --out .theme-preview/hearth/shared-ci-fixes`

No full development matrix or full local repository-unit suite was repeated.
On the previous published head `23cfd41cb`, both GitHub builds and all six
Linux/Windows unit-test groups passed; five browser groups failed before this
shared correction. Final published-head CI is a separate result and must still
be checked.

## Earlier failures and current status

The [preceding investigation](https://github.com/Smoebo/open-dungeon-master/tree/2ae5481238a79523421af44028a4f7c6dcc2c55a)
established that 15 of Hearth's earlier 16 browser failures also occurred on the
original shared base. Its focused local rerun passed 6/9, with name-menu contrast
and the day-board background assertion still failing. Those records describe
the earlier source and are retained as history. The selected shared cases now
pass on this integrated build; the 6/9 result is no longer the current result.

The earlier travel abort and table-layout timeout had already passed focused
reruns before this integration. No permanent fix for those intermittent outcomes
is claimed here, and the selected 21-case run is not the full browser suite.

## Remaining shared layout limitation

At 1024 × 900 with 125% text and both side panels open, the combat board is
238 × 172.5px while the hand is 242 × 252px and overlaps most of the map. Its
title passes the header checks; those checks do not establish board usability
at that width. Manual comparison after dismissing the hand tutorial and settling
animations found identical geometry in Hearth and Arcane. The gallery includes
both screenshots and measurements in `narrow-combat-observation.json`.

This needs a shared responsive-layout follow-up, such as allocating more board
room when both side panels and enlarged text are present. No extra Hearth-only
layout override was introduced. It remains a concrete limitation before delivery,
separate from the 21 selected cases that now pass.

## Review evidence and next action

The [current production gallery](https://github.com/Smoebo/open-dungeon-master/tree/ed856d3903aab26717a2026584e573fe514529de) contains 48 refreshed Hearth
screenshots, the 59-check matrix, 20 readability cases, 21-case shared-browser
report, two narrow-layout comparison screenshots and validation summary under `ci-fixes/`. The older root files and
`corrections/` folder are historical. Screenshots remain on the separate
`codex/hearth-haven-review` branch; source artwork/provenance stays with the code.

Next action: coordinate the shared 1024px enlarged-text layout follow-up, inspect
the final GitHub CI results and review PR 967 with its
PR 962 dependency. Native app-shell, real-device/mobile Safari and screen-reader
review remain outstanding. PR 967 stays draft. No merge is authorized.
