# High Kingdoms handoff

High Kingdoms (`kingdoms`) adds ivory vellum, royal-blue enamel, gilt fittings
and illuminated manuscript borders to the existing appearance picker.
Day mode uses warm ivory reading panels with blue ink; night mode uses deep
blue panels with ivory text and gilt headings. It claims no genre default.

The original wheat-sheaf shields, banners and council hall distinguish it from
Cloud Citadel's sky and marble, Arcane's celestial imagery and Gothic's tracery.
The generated border supplies both the frame and cropped corners. Production
art and complete built-in image-generation prompts are in
[`public/assets/themes/kingdoms/art-provenance.json`](../public/assets/themes/kingdoms/art-provenance.json).
The three WebP files total 1,449,846 bytes; the largest is 890,882 bytes.
The alpha channel is retained without repair, and the artwork contracts pass.

## Location and dependency

- Owner: Codex High Kingdoms session.
- Branch: `codex/high-kingdoms-theme`; worktree: `theme-high-kingdoms`.
- Required base: PR [962](https://github.com/Lebbitheplow/open-game-master/pull/962),
  commit `fccee2be4ace16f5b792032bc3292b6679ec5ac2`. PR 962 is draft.
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

## Shared-correction validation

Correction checkpoint: `4374da3fd66d2d2e38b8b1743f22194df1b73ecf`, merging
the updated PR 962 base above. Both Shield and Waves mappings are retained.
The coordination-board resolution keeps the incoming Tide and Hearth records.

High Kingdoms now sets `--material-send-wash`, `--material-send-edge` and
`--material-chosen-wash` instead of overriding the send and selected-mode
backgrounds and borders directly. Opaque royal blue reaches the moving
`.motion-pill`; ivory foregrounds and forced-colors system colors are retained.
The shared `--material-vital-fill` default and low-health treatment remain intact.
Artwork, image-decode readiness, hand labels and decorative rules are preserved.

The [refreshed immutable gallery](https://github.com/Smoebo/open-dungeon-master/tree/821dd7e8888abc5dd45c5e16215d0241097dcca5)
contains 52 production screenshots and exact geometry/material reports.

| Check | Correction result |
| --- | --- |
| `npm run test:appearance` | 12 appearance checks and 5 CSS/artwork contracts passed |
| Full production browser matrix, port 3032 | 59/59 passed, including all 16 new layout/material checks |
| Additional action inspection | Four day/night and forced-colors cases passed; selected moving highlight is royal blue and labels remain legible |
| Full repository lint | Zero errors, 313 existing warnings |
| Production build and TypeScript | Passed with two build workers |
| Bundle budgets | Passed: 107.6 KiB shared CSS, 114.2 KiB rulebook CSS; JavaScript within unchanged budgets |
| `git diff --check` | Passed |

The first matrix attempt passed 58/59 and timed out on its first story navigation.
Its report is retained; the warmed complete rerun passed 59/59. Manual review
covered phone titles at 320/390px, desktop titles at 1024/1360/1920px, and
phone/desktop enlarged-map frame clearance in both brightness modes. The
1024px/125% combat capture still has a cramped three-pane battle area; the title
checks do not establish usability of every pane. The disposable preview is stopped.

### Remaining CI findings

The [previous PR 973 Linux run](https://github.com/Lebbitheplow/open-game-master/actions/runs/43666785785)
failed 16 browser scenarios. Every failing scenario is also present among the
17 failures on the [original PR 962 base run](https://github.com/Lebbitheplow/open-game-master/actions/runs/43653434657),
before High Kingdoms was added. Previous-head Windows CI passed.

The focused production command
`node scripts/browser/run.mjs --only table-layout,day-board,companion-conduct,name-menu`
passed 4/9 cases: all three table-layout widths and phone day-board. Five failures
remain and are recorded in the gallery's `ci-investigation.json`:

- Name-menu contrast fails by day on desktop and phone.
- Desktop day-board expects a gradient first stop, while the shared painted
  chronicle uses the solid `--material-paper` background. The assertion reads
  `backgroundImage` and receives `none`; its expectation needs shared review.
- Hostile companion borders match ordinary party borders on desktop and phone;
  the shared painted-card treatment loses that semantic distinction.

The previous table-layout desktop timeout was a tooltip intercepting the Notes
click; it did not reproduce in the three-width local rerun. These findings are
not cleared by the 59/59 appearance matrix. Keep the PR draft pending shared
follow-up and final-commit CI. Full-suite file coverage below is historical and
was not repeated for this CSS/layout integration.

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
