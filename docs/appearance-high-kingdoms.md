# High Kingdoms handoff

High Kingdoms (`kingdoms`) adds ivory vellum, royal-blue enamel, gilt fittings
and illuminated manuscript borders to the existing appearance picker.
Day mode uses warm ivory reading panels with blue ink; night mode uses deep
blue panels with ivory text and gilt headings. It claims no genre default.

The original wheat-sheaf shields, banners and council hall distinguish it from
Radiant Heights' sky and marble (formerly Cloud Citadel), Arcane's celestial imagery and Gothic's tracery.
The generated border supplies both the frame and cropped corners. Production
art and complete built-in image-generation prompts are in
[`public/assets/themes/kingdoms/art-provenance.json`](../public/assets/themes/kingdoms/art-provenance.json).
The three WebP files total 1,449,846 bytes; the largest is 890,882 bytes.
The alpha channel is retained without repair, and the artwork contracts pass.

## Location and dependency

- Owner: Codex High Kingdoms session.
- Branch: `codex/high-kingdoms-theme`; worktree: `theme-high-kingdoms`.
- Required base: PR [962](https://github.com/Lebbitheplow/open-game-master/pull/962),
  commit `cab3070dc96c895a1d8aae8d6dd34b05c1a6ef65`. PR 962 is draft.
- Theme-specific shared edits are additive: catalog registration, Shield icon mapping and CSS
  import. The picker browser check now waits for artwork to decode before
  capturing: the cold-profile night screenshot otherwise showed empty borders
  while its CSS URL assertions passed. The updated base supplies the shared
  header hooks, title wrapping, map-frame clearance and material contract.
- The import follows the shared material styles, so theme-owned treatment
  rules can customize primary actions without copying the shared layer.
- Browser preview port: 3032. Windows checks prepend System32 and Windows
  PowerShell to the process PATH; global environment settings are unchanged.

When combining this branch with Hearth & Haven or another theme branch, keep
both catalog entries, icon mappings, stylesheet imports and coordination rows.
The only shared validation adjustment is the four-line image-readiness change in
`scripts/appearance/picker-check.mjs`; theme styles and artwork stay under
`kingdoms`. Preserve the required base dependency when updating the draft PR.

## Latest shared integration, November 15, 2026

Source checkpoint: `3d92137e032048a86a44cad00caef0ad99ca8ecf`, merging PR 962 at
`cab3070dc96c895a1d8aae8d6dd34b05c1a6ef65`. High Kingdoms' CSS, artwork, catalog entry,
Shield mapping and picker image-readiness change are unchanged from the previous
integration. Both Shield and Waves mappings remain. The coordination resolution
preserves the incoming sibling records and new theme proposals.

The shared update fixes menu, sheet, builder and disclosure-label contrast,
restores hostile-card border distinction, removes duplicate initiative chrome
below 1440px, and makes the empty ornament container transparent to accessibility
measurement while its frame and corners remain painted. Shared browser assertions
now accept actual painted solid surfaces and color channels.

The [current immutable gallery](https://github.com/Smoebo/open-dungeon-master/tree/aa2df41bbfe0fc833cbb39fb373cc1e0530b5f39) contains 52 refreshed production
screenshots, geometry/material reports and a sanitized selected-regression report.

| Check | Current result |
| --- | --- |
| Six targeted suites | Passed: appearance, appearance contracts, adventuring gear, builder gear, builder reselect and possessive title case; includes 12+5 appearance checks |
| Production theme browser matrix | 59/59 passed on the first run after the preview was ready |
| Additional action inspection | Four day/night and forced-colors cases passed |
| Selected shared browser regression | 26/26 passed: name-menu, day-board, companion-conduct, split-line, hand-on-board, creator-spells-identity, creator-sheets, builder-a11y, fight-bench, fight-bench-2, world-pack-omissions and table-layout, at their configured widths |
| Prior Windows timeout investigation | Isolated fight-opening suite passed all 13 checks; previous timeout did not reproduce locally |
| Full repository lint | Zero errors, 313 warnings |
| Production build and TypeScript | Passed with two build workers |
| Bundle budgets | Passed: 107.7 KiB shared CSS, 114.3 KiB rulebook CSS; JavaScript within unchanged budgets |
| Diff whitespace check | Passed |

All five shared browser failures recorded at the first integration now pass
locally. The broader 26-case selection includes the shared 21-case follow-up,
three table-layout widths and two fight-bench-2 cases. The [previous Windows run](https://github.com/Lebbitheplow/open-game-master/actions/runs/43674772120)
failed a warm-up cancellation timeout in fight-opening; its isolated local pass
does not establish that final-head CI will pass. No timing limits or gameplay
code were changed here.

Manual review confirms the borders and corners still paint, enlarged-map controls
clear the ornaments, and the wider combat view remains readable. At 1024px with
125% text, the three-pane combat area is still cramped. This remains a shared
layout limitation despite passing title bounds. The disposable preview is stopped.
Keep PR 973 draft pending its dependency, final-head CI and the remaining delivery
checks below. The full 1,218-file coverage later in this document is historical,
not a rerun of this integration.

## First shared integration, historical

Source `4374da3fd66d2d2e38b8b1743f22194df1b73ecf` integrated PR 962 at
`fccee2be4ace16f5b792032bc3292b6679ec5ac2`. It moved the royal-blue send
and selected-action fills to the shared material variables, retaining ivory
labels, forced-colors behavior and semantic health colors. Its
[historical gallery](https://github.com/Smoebo/open-dungeon-master/tree/821dd7e8888abc5dd45c5e16215d0241097dcca5)
records 59/59 on a warmed rerun after one navigation timeout, four action checks,
build/lint/budget passes, and the then-failing five shared browser cases.
Those failures are superseded by the current 26/26 selected-regression result.

## Original validation before the shared corrections

The authoring contract is [Build an appearance theme](appearance-themes.md).
Code/artwork checkpoint: `fbf856bb05bca89b02a34850f2a0efbb3f691662`.
The [immutable review gallery](https://github.com/Smoebo/open-dungeon-master/tree/fde89019d4740df66051b207d139d0e9f8a4161c)
is on the separate `codex/high-kingdoms-review` branch. Its 34 screenshots
include final production lobby, story, combat, enlarged map, dialogs and picker
views in day/night, desktop/phone and enlarged text. JSON reports contain
geometry and check results only. All fixture content is fictional.

| Check | Result |
| --- | --- |
| `npm run test:appearance` | 12 catalog/preference/palette checks and 5 CSS/artwork contracts passed |
| `node scripts/appearance/browser-check.mjs --theme kingdoms --port 3032` | 43 checks passed on development, then 43 on the production build |
| Picker after adding artwork decode readiness | 6 checks passed; also included in the production matrix |
| Full repository lint | Passed, 313 warnings and zero errors |
| Focused lint after picker-check correction | Passed |
| `npm run build` | Passed, including TypeScript; two build workers |
| Bundle budgets | Passed: 107.4 KiB shared CSS, 114.0 KiB rulebook CSS; JavaScript budgets unchanged |
| Name-lookup and text-comparison audits | 4 and 6 checks passed |
| Campaign settings and capability checks | 9 settings checks and capability suite passed |
| Full repository tests | All 1,218 files have passing results across isolated batches and corrective reruns; no unresolved files |
| `git diff --check` | Passed |

Manual inspection confirmed readable ivory/blue text surfaces, original heraldic
art and phone corners clear of headings and close buttons. It found and removed
ambient motes/contours that competed with the manuscript treatment. Cold picker
captures initially missed undecoded borders; the check now awaits image decoding,
and the final screenshots show all four themes' artwork. A final day-mode review
found blue hand labels over the dark battle map; the labels now use gilt and ivory
in both brightness modes. The production matrix and gallery include this fix.
Selection, Follow
campaign, forced-colors ornament hiding, long story scrolling, dice, map zoom,
enlarged-map opening/closing and keyboard card activation are automated checks.

Initial environment attempts encountered restricted build-link creation and a
cold-compilation navigation timeout. The final warmed development and production
matrices both passed. Dependency installation initially skipped the native SQLite
install script, causing broad tests to use the fallback driver; a combat-setup
rerun reproduced its parameter-binding error. The installed native package was
rebuilt using a temporary, version-pinned local approval, then package.json was
restored byte for byte. Both affected suites then passed: narrator 63 checks,
combat setup 14 checks. The initial failures are retained; they were not clean
passing runs.

Full-suite validation uses per-file coverage across batches, not a claim that
one uninterrupted `npm test` passed. Two long Vitest runs were stopped after
373 distinct files had passing results (including the SQLite corrective rerun).
The remaining 845 files run in isolated Node processes, four at a time, using
the repository's documented single-suite entry point. Files requiring Vitest's
mock/JSX handling or module initialization are retried under Vitest. Direct
processes that keep running after their checks finish are also retried there;
the direct runner records termination as failure, never as a pass.

One restricted Vitest attempt could not read its generated temporary files;
placing temporary files inside this worktree resolved that error. Another could
not reach its own local simulated model server (`EACCES`); the corrective run
had local-server access. No external model calls are needed for these checks.
The local logs and `.theme-preview/test-coverage-summary.json` retain the
per-file reconciliation: 373 earlier Vitest passes, 790 successful direct runs,
and 55 direct-run failures or interruptions subsequently passed under Vitest.
All 1,218 expected filenames are accounted for; none remains unresolved.

The initial five-minute direct-run limit interrupted two healthy sweep tests;
it was raised after the authored-card suite passed its longer Vitest run. Those
interrupted sweeps also passed on retry. The last retry collector stopped during
a concurrent progress-file write, so the remaining spotlight suite was run
separately under Vitest and passed all three checks. These local runner failures
are not application fixes. Existing suites may report known gameplay gaps or
skip optional content-pack rows when the pack is absent; a passing file count
does not mean those gaps or optional rows were covered.

## Choice justification

This adds a choice to the existing appearance control, with no new setting or
campaign-creation step. Players who want royal heraldry and manuscript craft
cannot get that material treatment from the existing three choices.
Campaigns keep their existing genre fallback unless a player or GM explicitly
selects High Kingdoms. Both existing pickers consume the catalog.

## Remaining delivery work

[Draft PR 973](https://github.com/Lebbitheplow/open-game-master/pull/973)
is open against `main`. Albert explicitly approved its creation after automatic
approval review had rejected the delegated assignment as publication authority.
The GitHub connector lacked repository write access, so the approved draft was
created through the existing signed-in GitHub CLI.

PR 973 depends on PR 962 and must stay draft. Final-commit CI, native app-shell screenshots,
real-device phone testing and screen-reader review remain outstanding.
The disposable Chromium checks do not establish multiplayer or combat-rule
correctness, Safari support, or screen-reader usability.
