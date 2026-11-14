# Appearance infrastructure validation

## Follow-up to the theme infrastructure review

Fable's handoff reviewed `e21a63844`. The later painted-theme extension had
already supplied shared material styles, theme-specific emblems and picker
screenshots. This follow-up addresses the remaining extension and validation
gaps while retaining the three themes' artwork:

- Theme-owned motifs, corners and material overrides now live in their registered
  stylesheets. Shared styles read the declared base style instead of theme IDs.
- The catalog declares genre claims and artwork geometry. One typed icon map
  serves the picker and lobby. A new genre-specific entry needs no resolver edit.
- CSS guards reject unscoped selectors, escaping siblings, global at-rules and
  theme IDs in shared styles. Image guards decode the shipped files and check
  transparent interiors and opaque surfaces, using the same crop/inset as rendering.
- Negative fixtures prove the guards reject defective CSS and artwork. The picker
  browser checks cover keyboard selection, Follow campaign, neighboring preview
  isolation, small screens with enlarged text and four/six-choice layouts.
- The [theme progress and ideas list](appearance-theme-ideas.md) records future
  concepts, reported unfinished work, completion criteria and open product decisions.
- The 29 existing review images were preserved byte-for-byte on a dedicated
  [screenshot branch](https://github.com/Smoebo/open-dungeon-master/tree/97ad9ffb8045f4a446e5145021d70c2bfa843a2b),
  alongside the new narrow-phone picker capture. Removing that gallery from the
  app source tree avoids about 20.8 MB of review-only files. Production artwork
  and provenance remain in `public/assets/themes/`.

| Check | Result |
| --- | --- |
| Appearance behavior and catalog checks | 12 passed |
| CSS/artwork contracts, including rejection fixtures | 5 passed |
| Text-comparison and name-lookup audits | 6 and 4 passed |
| Focused ESLint | Passed |
| Woodland browser matrix | 43 passed, including 6 picker checks |
| Arcane browser matrix | 43 passed |
| Gothic browser matrix | 42 passed; enlarged-map timing failure resolved in a 3-check interaction rerun |
| Final picker rerun after aligning preview frame geometry | 6 passed |
| Production build and TypeScript | Passed |
| Bundle budgets | Passed: 106.7 KiB shared CSS, 113.3 KiB rulebook CSS; JavaScript budgets unchanged |
| Full repository lint | Passed with 313 warnings and no errors |
| Full repository test suite | All 1,218 files passed across two batches and a four-file corrective rerun; file coverage reconciled against `scripts/test-*.mjs` |

The picker test uses Space to activate native buttons, waits for the selected
state, and groups grid rows by layout position rather than a hover-transformed
screen coordinate. At 320px the cards stack their thumbnail above the description
to avoid one-word lines with enlarged text. Layout fixture cards are temporary
browser-only copies, not additional registered themes.

Gothic's enlarged-map check first timed out while reopening across breakpoints;
its initial rerun also sampled the opening animation's temporary overshoot.
The harness now waits for the dialog's finite animations to finish and for the
previous portal to unmount before resizing/reopening. All three focused checks
then passed. Full lint excludes `.theme-preview/`, whose disposable Chromium
profiles contain generated third-party extension code rather than app source.

The full suite was completed in batches: 142 files passed in the first run,
then 1,072 passed and four failed in the remaining run. The lobby-arrival source
check still expected the wrapper without its new `lobby-hero-slot` class; its
expectation now includes that class while retaining the same nesting check.
Two backup tests picked up GNU tar, which interpreted a Windows drive path as a
remote host, and the receiver setup test could not find `powershell.exe`.
Putting Windows System32 and Windows PowerShell first on the rerun process's
PATH resolved those three environment failures. All four rerun files passed.
This is complete file coverage with corrective reruns, not a single clean run.
The last crop-guard change also passed the focused appearance checks and lint.

Final-commit CI, native-shell and real-device validation remain outstanding.
The PR stays draft.

## Painted Arcane and Gothic extension

The 2026-11-14 extension gives all three themes painted materials and artwork.
Arcane adds indigo stone, celestial brass and an observatory; Gothic adds
cathedral stone, silver tracery, garnet glass and a moonlit cloister. Both reuse
the shared material styles and ornament renderer, including the portalled map.
Their production WebP assets and generation provenance are committed alongside
the authoring guide. Each asset is below 2 MiB.

| Check | Result |
| --- | --- |
| Appearance catalog, preferences, artwork and palette checks | 11 passed |
| Campaign-creation option coverage | 5 passed; appearance deliberately defaults to genre and is changed later |
| Repository name-lookup audit | 4 passed |
| Repository text-comparison audit | 6 passed |
| Focused ESLint on changed theme components and tests | Passed |
| Arcane browser matrix | 37 passed; 3 focused interaction checks also passed after reducing corner size |
| Gothic browser matrix | 37 passed |
| Production build and TypeScript | Passed; the later phone initiative-label CSS correction was checked in the browser |
| Bundle budgets | Passed: 106.7 KiB shared CSS, 113.3 KiB rulebook CSS; JavaScript budgets unchanged |
| Production day-ink scenarios | 2 of 2 passed, desktop and phone |
| Woodland browser regression | 37 passed in the final warmed run |

Manual inspection found that the new metal corners needed smaller table sizes
than Woodland's open leaves. They now use 48px corners on desktop and 32px on
phones. The enlarged map keeps its own painted border, while its day-mode
surround uses the selected theme's light palette. Only the starfield board keeps
night text; the phone's initiative label outside it uses readable day ink without
the night shadow. The [review gallery](https://github.com/Smoebo/open-dungeon-master/tree/97ad9ffb8045f4a446e5145021d70c2bfa843a2b/images) uses fictional
data and show both brightness modes on desktop and 390px phone viewports.

The preceding PR commit's CI identified the creation-option omission, missing
classifications for fixed theme/storage keys, and faint Arcane hint text on
parchment. This extension addresses those findings; the checks above distinguish
local verification from final-commit CI. Full-suite CI, native-shell and
real-device validation remain required. The PR remains a draft.

The first Woodland regression attempt ran during production compilation and
timed out on its initial lobby, dice dialog and enlarged map. After compilation,
the complete warmed run passed all 37 checks. These timeouts are retained here
to distinguish the successful rerun from the initial attempt.

## Current-main port

The initial port onto `044b9dcd0409c5b862a77241de6f18311f497f74` was checked on
2026-11-14. These are historical results for PR #962 before the extension above:

| Check | Result |
| --- | --- |
| `node scripts/test-appearance.mjs` | 11 checks passed, including older-host compatibility |
| `node scripts/test-capabilities.mjs` | Passed |
| `node scripts/test-table-settings-groups.mjs` | 9 enforced checks passed |
| `npm run lint` | Passed with 313 warnings and no errors |
| `npm run build` | Initial port passed, including TypeScript; final overlay extension still requires CI |
| `node scripts/check-bundle-budget.mjs` | Passed with the documented theme stylesheet allowance |
| Browser layout matrix | 36 checks passed; the remaining enlarged-map check passed after fixing the test's breakpoint handling |
| `theme:check -- --theme woodland --interactions-only` | 3 checks passed, including enlarged-map artwork, desktop/phone geometry and keyboard card activation |

The phone checks cover 320/390px screens and 125% text. They found and verified
fixes for the cramped composer and a non-shrinking combat desk. The enlarged map
now renders its own four corners and frame inside its dialog. Its checks cover
day/night at 390px and desktop, and confirm decorations do not intercept input.
The updated component and browser script also passed focused ESLint.

Reviewed screenshots are preserved in the [review gallery](https://github.com/Smoebo/open-dungeon-master/tree/97ad9ffb8045f4a446e5145021d70c2bfa843a2b/images),
including the [enlarged battle map](https://raw.githubusercontent.com/Smoebo/open-dungeon-master/97ad9ffb8045f4a446e5145021d70c2bfa843a2b/images/woodland-map-enlarged-night.png).
The PR description embeds the desktop and phone captures. All data is fictional.

The production build measured 105.9 KiB of compressed shared CSS and 112.5 KiB
on the rulebook page. The stylesheet budgets are now 112 and 119 KiB to allow
the new palettes, ornaments, picker and Woodland furniture with about 5%
headroom. JavaScript budgets are unchanged. The first Linux CI build completed,
then failed its old CSS budget; the Windows CI build passed.

The full local test suite was interrupted during dependency setup and is not a
passing result. Its three reported failures were rerun individually after setup:
`test-cast-known.mjs` passed 21 checks, `test-enforce-srd-adventuring.mjs` passed
17, and `test-create-chooser.mjs` passed 9. Full CI, native-shell and real-device
validation remain outstanding. Keep the PR in draft until the remaining checks
are resolved.

## Original implementation

The results below were recorded on 2026-11-14 for the original theme
implementation before its port to current main. They are historical evidence,
not validation of the port. Reproduce them using [Build an appearance theme](appearance-themes.md).
This record does not indicate deployment or merge approval.

| Check | Result |
| --- | --- |
| `npm run test:appearance` | 10 checks passed across all registered themes |
| `npx tsc --noEmit` | Passed |
| ESLint on the changed theme components, registry, preferences and preview scripts | Passed |
| `npm run theme:check -- --theme woodland` | 37 browser checks passed, zero failures |
| `git diff --check` | Passed |
| `npm run build` | Passed; emitted 24 bundler warnings |

The original browser run used the repository's disposable SQLite fixture and a fresh
headless Chrome profile. It covered day/night lobby layouts, 125 long story
entries, combat maps at 1360/390/320px widths, 100%/125% text, dice rolling and
dialog dismissal, keyboard map zoom, enlarged maps and keyboard selection of a
Longbow card. It also switched through every registered theme to check artwork
replacement and tested ornament hiding in forced-colors mode.

Manual screenshot inspection confirmed that the shared renderer retains
Woodland's vine border, all four leaf-and-root corners, and readable phone
content. The current preview produces `results.json` and a self-contained
`review.html` under `.theme-preview/woodland/`; these generated files are ignored.

The run does not establish full combat-rule correctness, multiplayer behavior,
mobile Safari compatibility or screen-reader usability. A real-device review
and the normal release checks remain necessary before release.

The production build completed with normal local process access after the first
restricted run stalled. Its warnings included broad file patterns in the
unchanged backup implementation. Those warnings were not resolved by this theme
work.
