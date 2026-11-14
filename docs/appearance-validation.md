# Appearance infrastructure validation

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
