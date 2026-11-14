# Appearance themes: progress and pending ideas

A shared coordination board for people and sessions building appearance themes,
starting with [PR 962](https://github.com/Lebbitheplow/open-game-master/pull/962).
Check active work before starting, claim the theme you will work on, and leave
its location and next step for whoever follows. Use
[Build an appearance theme](appearance-themes.md) for implementation
and [the validation record](appearance-validation.md) for completed checks.

Last reconciled: 2026-11-14. Suggested priorities and genre claims below are
proposals until agreed.

## Active work and handoffs

Keep this table current while work is underway. An owner identifies the person
or session to coordinate with; it does not mean that session is still running.

| Work | Owner / last contributor | Branch, commit or work location | State and next step | Last update |
| --- | --- | --- | --- | --- |
| Shared framework; Arcane, Woodland, Gothic | Codex, PR 962 session | `codex/genre-appearance-themes`, PR 962; local worktree `theme-infrastructure-pr` | Ready for review. Local build, lint, theme checks and all 1,218 test files passed across batches/reruns; see validation record. Final CI, native-shell and real-device checks remain before delivery. | 2026-11-14 |
| Deep Forge | Fable; successor not yet assigned | Reported commit `c92039a08`; reference repo `C:\dev\tabletop-companion`, worktree `C:\dev\ogm-appearance-themes` | Groundwork already exists. Continue from Fable's implementation and port to the current framework; locate that work before starting another version. | 2026-11-14 |
| Sunken Tide | Fable; successor not yet assigned | Stopped session; worktree/branch and handoff link still to record | Groundwork already exists per Albert/Fable. Next session should locate and preserve that work, then record what remains. | 2026-11-14 |

### Starting, coordinating and handing off

1. Read this table and the theme row. If an owner is listed, coordinate with
   them or read their handoff before taking over. An old date alone is not a
   reason to assume work has been abandoned.
2. Claim the work here before implementation: record your name/session, branch
   or worktree, intended scope and next step. Publish that small update to the
   shared branch/PR so other sessions can see the claim.
3. Keep theme assets and styles in the theme's own files. If shared framework
   changes are needed, record them here and coordinate with its owner. Identify
   the required base commit when a theme depends on an unmerged framework change.
4. Before stopping, update status and location, save a recoverable commit or
   worktree, and leave checks run, remaining issues and one concrete next action.
   Link the PR or handoff. Mark work paused, ready for review or available for
   pickup explicitly; retain the last contributor when ownership changes.

## Status and delivery

| Status | Meaning | Evidence to record |
| --- | --- | --- |
| **idea** | A proposed look; no implementation verified | Brief and distinguishing features |
| **started** | Some work exists, but the theme is unfinished | Branch/worktree or handoff, what exists, next step |
| **built** | Complete on a separate branch, outside the delivery PR | Commit, assets/provenance and validation results |
| **shipped** | Registered in the catalog on the PR branch or main | PR or main commit and remaining delivery checks |

Here, **shipped does not mean merged or released**. Track delivery separately.
When evidence comes from a handoff and cannot be inspected, say so rather than
silently treating its status as verified.

## Shipped

| ID | Name | Look | Genres it suggests itself for | Delivery |
| --- | --- | --- | --- | --- |
| `arcane` | Arcane | Indigo stone, celestial brass, amethyst | Every genre no other theme claims | PR 962, draft |
| `woodland` | Ancient Woodland | Carved oak, living ivy, silver leaf | None; selected explicitly | PR 962, draft |
| `gothic` | Gothic | Cathedral stone, silver tracery, garnet glass | Dark fantasy, horror | PR 962, draft |

All three have painted textures, borders, corners and fallback scenery. Their
artwork reaches the lobby, active session and enlarged battle-map dialog, in
both brightness modes. Campaign covers and scene paintings retain priority over
fallback scenery. Current screenshots live in the separate
[review gallery](https://github.com/Smoebo/open-dungeon-master/tree/97ad9ffb8045f4a446e5145021d70c2bfa843a2b/images).

PR 962's current focus is the shared framework and validation. Its follow-up
isolates theme-owned CSS, checks image transparency, centralizes genre and icon
selection, and exercises the picker with additional choices. Consult the
validation record for exact results; full final-commit CI, native-shell and
real-device checks must not be inferred from this table.

## Fantasy themes

| ID | Name | Look | Status | Evidence and next step |
| --- | --- | --- | --- | --- |
| `forge` | Deep Forge | Dark basalt, hammered bronze bands, ember light; square-cut keys | **built**, reported | Fable's handoff identifies `c92039a08`, built on `e75ec96ae`, with four images and prompts. That commit is not available in this checkout. Recover and inspect it, then port its own styles/assets to PR 962's current catalog and material variables. Rerun current checks; the old reference had two narrow-combat failures. |
| `tide` | Sunken Tide | Sea-glass teal, pale driftwood, verdigris bronze, pearl | **started**, reported | Fable reports a stopped session with no commit. No working files have been verified here. Preserve the brief; locate recoverable files before treating this as more than an idea. |
| `kingdoms` | High Kingdoms | Ivory, royal blue, heraldry, illuminated manuscript borders | **idea** | From the original session list. Emphasize banners, heraldic fittings and manuscript ornament; keep it distinct from Cloud Citadel's airy marble and sky imagery. No owner yet. |
| `hearth` | Hearth & Haven | Warm parchment, amber, oak, cosy tavern atmosphere | **idea** | From the original session list. Use crafted indoor woodwork and warm lamplight, distinct from Ancient Woodland's living vines and forest canopy. No owner yet. |
| `frost` | Frostbound | Blue-white ice, pale steel, aurora green accent | **idea** | Day mode is the natural starting point. Give night mode a cold steel/aurora identity distinct from Arcane's indigo and amethyst. |
| `dunes` | Sunscorched | Sandstone, turquoise inlay, beaten gold or bronze, carved geometric borders | **idea** | Also covers the original **Lost Empires** proposal (sandstone, bronze, turquoise, carved borders). Keep one work item while these briefs overlap; settle the display name and metal treatment when claimed. Use stone relief to distinguish it from Arcane's brass fittings. |
| `skyhold` | Cloud Citadel | White marble, sky blue, gilt | **idea** | Lightest of the set. Check text, disabled controls and selected states against pale surfaces before adding ornament. |

These are additional fantasy settings, not automatic genre claims. In
particular, Deep Forge should not acquire steampunk by default merely because
both use metal.

The original six-theme list is now accounted for: Arcane, Ancient Woodland and
Gothic are in PR 962; High Kingdoms and Hearth & Haven are pending above; Lost
Empires is carried under Sunscorched rather than becoming a duplicate assignment.

## Genre themes

The app's genres are high fantasy, dark fantasy, mystery, horror, cyberpunk,
steampunk, post-apocalyptic and custom. The four non-fantasy genres below
currently fall back to Arcane and are candidates for more specific visual
identities. Proposed claims are not active defaults.

| ID | Name | Look | Proposed genre claim | Status | Next design check |
| --- | --- | --- | --- | --- | --- |
| `neon` | Neon District | Black glass, magenta/cyan signage, brushed steel | Cyberpunk | **idea** | Fine illuminated lines may suit SVG. Keep the glow decorative, preserve semantic warning colors, and design a readable day mode. |
| `brassworks` | Brassworks | Riveted brass, oxblood leather, gauge glass | Steampunk | **idea** | Keep it mechanical and precise, distinct from Deep Forge's hammered metal and basalt. Decorative gauges must not look like controls. |
| `wasteland` | Wasteland | Rusted sheet metal, hazard yellow, sun-bleached canvas | Post-apocalyptic | **idea** | Keep rust and scratches off reading surfaces. Hazard stripes must not compete with real warnings or selected states. |
| `gaslight` | Gaslight | Dark walnut, green baize, brass lamp glow | Mystery | **idea** | Use restrained joinery and lamp fittings, distinct from Woodland's living vines and Gothic's cathedral tracery. |

**Science fiction** was also mentioned as a later direction in the original
discussion, but has no named theme or visual brief yet. Define that brief before
creating a separate theme row; Neon District covers cyberpunk, not all science
fiction. Science fiction is not currently a built-in genre, so this direction
does not claim a genre default.

## Suggested build order

1. Finish PR 962's validation and settle the reusable theme contracts.
2. Recover Deep Forge and port it as the first independent extension. Existing
   work makes it a useful check that the authoring guide is sufficient.
3. Build one genre theme. Neon District would exercise a visibly different
   material family and mixed vector/painted artwork; this is a recommendation,
   not a committed priority.
4. Revisit Tide if its work is recoverable, then choose further themes according
   to interest and the remaining gaps in the picker.

## Before a row moves to started

- The look must read as different from every shipped theme at picker size, in
  both night and day. Record its materials, border shapes and accent colors.
- Avoid named settings, characters and creatures from published games in the
  name, description and artwork. Record asset sources and generation prompts.
- A genre belongs to at most one theme. A theme with no natural genre claims
  none. Discuss changes to existing genre defaults before adding claims.
- Record the worker/owner, branch or worktree, and the next concrete step in the
  row or a linked handoff. Preserve unfinished work before handing it off.
- Parallel themes own separate asset folders and stylesheets. Coordinate their
  small shared catalog/import edits. Reuse the material system; introduce a new
  shared hook only when an existing one cannot express the needed surface.

## Before a row moves to built or shipped

- The catalog entry, stylesheet import, artwork and provenance are present at
  the recorded commit. Every production image stays below the per-file limit.
- `npm run test:appearance` passes, including CSS ownership, genre claims and
  alpha checks. Type checking, lint and relevant production checks pass.
- The documented browser preview passes for the theme. Inspect the picker,
  lobby, story, combat, enlarged map and dialogs in day/night, at desktop/phone
  widths and with enlarged text. Check actual readability, not only geometry.
- Borders do not cover headings or controls, capture input or introduce focus
  stops. Theme switching clears absent artwork; forced-colors mode hides it.
- Screenshots use fictional data and a separate review branch with immutable
  links. Record automated results, manual inspection and remaining limitations.
- **Built** requires a recoverable branch/commit. **Shipped** additionally
  requires catalog registration on the delivery branch; mark draft, merged and
  released states separately and leave outstanding delivery checks visible.

## Open decisions

| Decision | Suggested direction | Still to settle |
| --- | --- | --- |
| Add themes to PR 962 or separate PRs? | Keep PR 962 focused on the three existing themes and framework. Add each later theme in its own PR after the framework settles. | Maintainer's preferred sequence; a dependent PR can identify its base explicitly. |
| When does a genre theme become the default? | Register the visual theme first; make a genre-default change an explicit reviewed decision. Existing campaigns following genre will change appearance. | Maintainer agreement for each claim. |
| How many themes before grouping the picker? | The current checks cover three real choices and four/six-card layout fixtures. Reassess with the first seventh theme and actual phone use. | Whether grouping or filtering helps; six is a test case, not a product limit. |
| What is the asset budget per theme? | Measure the complete shipped set and retain the existing 2 MiB limit per image. | The suggested 0.5–2 MB per-theme range is an estimate, not an enforced total. |
| Who continues Forge/Tide? | Build on Fable's groundwork and record the handoff in the active-work table. | Tide's work location and the next owner for each theme. |
