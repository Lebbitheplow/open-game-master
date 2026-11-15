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
  commit `96b5a50b572d8fc9cc80c06f679e25a34b3d26a7`. PR 962 is draft.
- Shared edits are additive: catalog registration, Shield icon mapping and CSS
  import. The picker browser check now waits for artwork to decode before
  capturing: the cold-profile night screenshot otherwise showed empty borders
  while its CSS URL assertions passed. The renderer, material framework and
  other theme files are unchanged.
- The import follows the shared material styles, so theme-owned treatment
  rules can customize primary actions without copying the shared layer.
- Browser preview port: 3032. Windows checks prepend System32 and Windows
  PowerShell to the process PATH; global environment settings are unchanged.

## Validation

Validation and screenshot publication are in progress. The authoring contract
is [Build an appearance theme](appearance-themes.md).

## Choice justification

This adds a choice to the existing appearance control, with no new setting or
campaign-creation step. Players who want royal heraldry and manuscript craft
cannot get that material treatment from the existing three choices.
Campaigns keep their existing genre fallback unless a player or GM explicitly
selects High Kingdoms. Both existing pickers consume the catalog.

## Remaining delivery work

Keep the separate PR draft. Final-commit CI, native app-shell screenshots,
real-device phone testing and screen-reader review remain outstanding.
The disposable Chromium checks do not establish multiplayer or combat-rule
correctness, Safari support, or screen-reader usability.
