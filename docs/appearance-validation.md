# Appearance infrastructure validation

## Current-main port

The port onto `044b9dcd0409c5b862a77241de6f18311f497f74` was checked on
2026-11-14. These checks use the code submitted in PR #962:

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

Reviewed screenshots are saved in [images/appearance](images/appearance),
including the [enlarged battle map](images/appearance/woodland-map-enlarged-night.png).
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
