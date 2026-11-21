# Appearance themes: progress and pending ideas

A shared coordination board for people and sessions building appearance themes,
starting with [PR 962](https://github.com/Lebbitheplow/open-game-master/pull/962).
Check active work before starting, claim the theme you will work on, and leave
its location and next step for whoever follows. Use
[Build an appearance theme](appearance-themes.md) for implementation
and [the validation record](appearance-validation.md) for completed checks.

Last reconciled: 2026-11-21. Suggested priorities and genre claims below are
proposals until agreed.

Pull requests 962, 967, 973, 977 and 978 merged on 2026-11-16, so Arcane,
Ancient Woodland, Gothic, Hearth & Haven, High Kingdoms, Sunken Tide and Deep
Forge are on main. The handoff table and the built rows below still describe
them as drafts; read them as history. The ideas added on 2026-11-21 come from a
discussion on 2026-11-16 and are proposals: none is started or agreed.

## Active work and handoffs

Keep this table current while work is underway. An owner identifies the person
or session to coordinate with; it does not mean that session is still running.

| Work | Owner / last contributor | Branch, commit or work location | State and next step | Last update |
| --- | --- | --- | --- | --- |
| Shared framework; Arcane, Woodland, Gothic | Codex, PR 962 session | `codex/genre-appearance-themes`, PR 962; local worktree `theme-infrastructure-pr` | Tide's shared handoff is implemented. The November 15 CI follow-up fixes contrast, foe-card colors, laptop board space and narration accessibility measurement; all 15 previously failing browser cases pass locally, and Arcane passes 59 appearance checks. Dependent themes should integrate this follow-up before final validation. See the validation record for exact runs. Final CI, native-shell and real-device checks remain. Browser port 3034 is free. | 2026-11-15 |
| Deep Forge | Fable, theme-forge session | `feat/appearance-theme-forge`; [draft PR 978](https://github.com/Lebbitheplow/open-game-master/pull/978), based on PR 962; theme commit `45487aa2c`, shared commit `af87f1b8a`, rebased on 2026-11-15 onto PR 962 at `c07f60504` (itself on main 0.36.0). Earlier local build: `c92039a08` | Ported and locally validated on the updated framework. Next step: rebase onto main once PR 962 merges. Screenshots are on fork branch `screenshots/appearance-theme-forge`. | 2026-11-15 |
| Sunken Tide | Fable, theme-tide session | `feat/appearance-theme-tide`, theme commit `2ea48b9d0`; [draft PR 977](https://github.com/Lebbitheplow/open-game-master/pull/977), based on PR 962 head `c07f60504` | Rebuilt on PR 962's shared fixes as one theme-only commit; the earlier shared-file commit is gone because PR 962 carries it. Checks are in the fantasy-themes row. Next step: rebase when PR 962 merges. Browser port 3033 is free. | 2026-11-14 |
| Hearth & Haven | Codex Hearth session `01a1dc7c-174e-7d53-8359-175b5c09ae65` | `codex/hearth-haven-theme`, implementation `d0de4ba04`, [draft PR 967](https://github.com/Lebbitheplow/open-game-master/pull/967); rebased onto PR 962 at `c07f60504` | Rebased 2026-11-15 as four commits; the results that follow were measured before the rebase, and the handoff lists what was repeated. Shared November 15 CI fixes integrated without duplicate overrides. Appearance, four component suites, lint, production build/budgets, 59 Hearth browser checks, 20 readability cases and 21 shared browser cases passed. [Handoff and gallery](appearance-hearth-handoff.md) record remaining 1024px/125% text board crowding, reproduced identically in Arcane. Draft; shared layout follow-up, final CI/native/device review remain. No preview is running; ports 3031 and 3033 are free of Hearth. | 2026-11-15 |
| High Kingdoms | Codex High Kingdoms session | `codex/high-kingdoms-theme`; integration `3d92137e032048a86a44cad00caef0ad99ca8ecf`; worktree `theme-high-kingdoms`; base `cab3070dc96c895a1d8aae8d6dd34b05c1a6ef65` (PR 962) | [Draft PR 973](https://github.com/Lebbitheplow/open-game-master/pull/973) incorporates shared browser/contrast/board fixes. 59/59 theme checks, 26/26 selected shared browser cases, four action checks, six targeted suites, isolated fight-opening, lint, build and budgets passed. [Current gallery](https://github.com/Smoebo/open-dungeon-master/tree/aa2df41bbfe0fc833cbb39fb373cc1e0530b5f39); limitations and delivery checks in the [handoff](appearance-high-kingdoms.md). Port 3032 is free. | 2026-11-15 |

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
[review gallery](https://github.com/Smoebo/open-dungeon-master/tree/826cd595e90b0693b5c788819a86fcb44e83c9dc/images).

PR 962's current focus is the shared framework and validation. Its follow-up
isolates theme-owned CSS, checks image transparency, centralizes genre and icon
selection, and exercises the picker with additional choices. Consult the
validation record for exact results; full final-commit CI, native-shell and
real-device checks must not be inferred from this table.

## Fantasy themes

| ID | Name | Look | Status | Evidence and next step |
| --- | --- | --- | --- | --- |
| `forge` | Deep Forge | Dark basalt, hammered bronze bands, ember light; square-cut keys | **built** | Ported from `c92039a08` onto PR 962, now at `c07f60504`: one catalog entry, one import, `themes/forge.css`, and four images reused byte-for-byte with prompts in `art-provenance.json`. Claims no genre. Shared changes it brings: an `anvil` symbol (`APPEARANCE_ICONS`, `ThemeIcon.tsx`) and four corner-shape variables, `--material-bubble-radius`, `--material-tab-radius`, `--material-chip-radius` and `--material-sigil-radius`, whose defaults keep the earlier leaf cuts. It sets the send, chosen and health bar colours through PR 962's variables. It keeps the shared desktop corner size and sets only a thinner rail and a smaller phone corner; at the shared sizes the rail still covered label ends and card edges (retried on 2026-11-14 after the map-clearance fix). Run locally on 2026-11-14: `npm run test:appearance` 12 and 5 passed; `npx tsc --noEmit` passed; full lint 0 errors, 313 warnings; `npm run build` passed; bundle budget passed at 107.7 KiB shared CSS (limit 112); `theme:check -- --theme forge` 59 of 59 passed, on `28e58b711` and again on `9d9ecb8e7`, and Woodland 59 of 59 for comparison. Build, lint and the budget were run on `28e58b711`, before the corner-size commit, which only removes one line of the theme stylesheet. Looked at by eye after the rebase: story at 390px and 1360px by night, and the enlarged map at 1360px by day and 390px by night. Arcane and Gothic were not rerun or looked at here. Not run: full test suite, CI, native shells, a real phone. On 2026-11-15 GitHub failed 16 browser cases on the `fccee2be4` base, all in the scenarios PR 962 fixed in its "Themed screens keep labels readable" commit; after rebasing onto that and then onto main 0.36.0 with PR 962, `test:appearance` (12 and 5), `tsc` and `theme:check -- --theme forge` (59 of 59) passed locally, and the commit hashes named earlier in this cell are from before that rebase. GitHub then passed all 15 checks (builds, Linux and Windows tests, six browser jobs) on the `6c6f86fa3` base; the later rebase onto `c07f60504` adds only PR 962's browser-helper timing fix. Next step: rebase when PR 962 merges. |
| `tide` | Sunken Tide | Sea-glass teal, pale driftwood, verdigris bronze, pearl | **built**, draft PR | [PR 977](https://github.com/Lebbitheplow/open-game-master/pull/977) contains the recovered implementation, four WebP assets, provenance and both palettes. Claims no genre. Fable reports 12 behavior + 5 contract checks and 43 browser checks passing; its PR records which build/lint checks preceded the shared patch and the Windows tar failures. Shared layout defects are assigned to PR 962. Rebase onto those fixes, then rerun the expanded checks; native-shell, real-device and final CI checks remain. |
| `hearth` | Hearth & Haven | Warm parchment, amber, oak, cosy tavern atmosphere | **built** | [Draft PR 967](https://github.com/Lebbitheplow/open-game-master/pull/967), dependent on PR 962. Crafted indoor joinery, bead-carved trim and fireside scenery; no genre default. [Validation and handoff](appearance-hearth-handoff.md). Not merged or released. |
| `kingdoms` | High Kingdoms | Ivory vellum, royal blue enamel, gilt wheat heraldry, illuminated manuscript borders | **built**, draft PR | [PR 973](https://github.com/Lebbitheplow/open-game-master/pull/973), integration `3d92137e0`, includes PR 962 at `cab3070dc`. 59/59 theme and 26/26 selected shared browser checks passed; see [handoff](appearance-high-kingdoms.md). Keep draft for dependency, final-head CI and delivery checks. No genre claim. |
| `frost` | Frostbound | Blue-white ice, pale steel, aurora green accent | **idea** | Day mode is the natural starting point. Give night mode a cold steel/aurora identity distinct from Arcane's indigo and amethyst. |
| `dunes` | Sunscorched | Sandstone, turquoise inlay, beaten gold or bronze, carved geometric borders | **idea** | Also covers the original **Lost Empires** proposal (sandstone, bronze, turquoise, carved borders). Keep one work item while these briefs overlap; settle the display name and metal treatment when claimed. Use stone relief to distinguish it from Arcane's brass fittings. |
| `skyhold` | Radiant Heights | White marble, gold leaf, sky blue; halos, feathers and sunbursts | **idea** | Formerly Cloud Citadel, widened to a heavenly realm; the display name is a placeholder. Only white-and-gold theme. Lightest of the set: check text, disabled controls and selected states against pale surfaces before adding ornament. Arcane already owns celestial brass on indigo, so give night mode a warm dawn palette (deep rose and gold), not a starry one. |
| `inferno` | Inferno | Obsidian, black iron chains, crimson glow, cracked brimstone | **idea** | Proposed 2026-11-14 (Albert and Fable). Only red theme. Keep it apart from Deep Forge: red, sharp and spiked, not orange, square and crafted. Day mode needs a plan first: ash white and bone with a crimson accent. |
| `fey` | Twilight Court | Rose and violet dusk, gossamer, moth wings, glowing mushrooms, blossom | **idea** | Proposed 2026-11-14 (Albert and Fable). Only pink theme. No oak or ivy, so it stays apart from Ancient Woodland; keep violet from drifting into Arcane's amethyst. The display name is a placeholder that avoids a published setting's name. |
| `storm` | Stormreach | Slate thundercloud, copper lightning rods, electric yellow; jagged lightning borders | **idea**, on hold | Proposed 2026-11-14 (Albert and Fable), from the elemental planes. Put on hold 2026-11-16: Galvanic, under genre themes, carries electricity with objects to paint (tubes, coils) where this has only weather. Revisit if a natural storm look is wanted beside it. The display name is a placeholder. |
| `caverns` | Crystal Caverns | Faceted amethyst and quartz, wet cave stone, glowing fungus | **idea**, on hold | Proposed 2026-11-14 (Albert and Fable) as the underground realm. Overlaps Sunken Tide (teal glow), Arcane (violet) and Deep Forge (dark stone). Worth building only if crystal borders carry the identity, and it needs a day-mode idea first. |
| `ossuary` | Ossuary | Bone, black cloth, tallow candles, sickly green glow | **idea** | Proposed 2026-11-14 (Albert and Fable) as the necromancer's domain. Taken off hold 2026-11-16: it fits horror better than Gothic's cathedral stone, and a better fit for a genre is a reason to build it even where the mood overlaps. Proposed claim: horror, with Gothic keeping dark fantasy; that moves an existing default, so it needs agreement first. Check it reads apart from Gothic and Inferno side by side. |

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
| `gaslight` | Gaslight | Dark walnut, green baize, brass lamp glow | Mystery | **idea** | Use restrained joinery and lamp fittings, distinct from Woodland's living vines and Gothic's cathedral tracery. Hearth & Haven now also has dark wood and lamp glow: the green baize and a cooler detective's-office feel have to carry it. Compare the two side by side before building. |
| `depths` | Unquiet Depths | By day the investigator's desk: manila case files, typewriter ink, sepia photographs, red string. By night what the case uncovers: green-black deep water, wet stone, watching eyes, angles that do not quite meet | None; suits horror and mystery | **idea** | Proposed 2026-11-16 (Albert and Fable) as the cosmic horror look. The two brightness modes are two halves of one story. Use no named beings or places from published stories or games, and no tentacle-faced figures. The display name is a placeholder. |
| `galvanic` | Galvanic | Glowing vacuum tubes, copper coils, ceramic insulators, violet arcs on dark bakelite | None; suits steampunk | **idea** | Proposed 2026-11-16 (Albert and Fable) as the electrical laboratory. Keep it apart from Brassworks: glass, wire and arc light, not cogs and rivets. Decorative dials and switches must not look like controls. The display name is a placeholder. |
| `skyfarer` | Skyfarer | Canvas envelopes, rope rigging, teak decks, brass instruments, open sky | None; suits steampunk and high fantasy | **idea** | Proposed 2026-11-16 (Albert and Fable) for airships and sky islands. Shares sky blue with Radiant Heights; rigging and canvas against marble and halos keep them apart. The display name is a placeholder. |
| `noir` | Noir | Black and white, window-blind shadows, one red accent | None; suits mystery and cyberpunk | **idea** | Proposed 2026-11-16 (Albert and Fable). Nearly colourless, so selected, warning and disabled states need a plan before any ornament. |

A genre may have more than one theme. A look earns a place when it reads as
different from every other theme, or when it fits a genre better than anything
that genre has now; sharing a colour scheme with a theme made for another genre
does not rule it out (Albert, 2026-11-16). Only one theme is a genre's default.
The others are picked by hand.

Second themes noted for later, once the first for their genre exists: a
corporate tower for cyberpunk (white panels, chrome, one cold accent) and an
overgrown ruin for post-apocalyptic (cracked concrete, moss, faded road signs).
Horror shares Gothic with dark fantasy today; Ossuary and Unquiet Depths above
are the proposals for it.

**Science fiction** was also mentioned as a later direction in the original
discussion, but has no named theme or visual brief yet. Define that brief before
creating a separate theme row; Neon District covers cyberpunk, not all science
fiction. Science fiction is not currently a built-in genre, so this direction
does not claim a genre default.

## Picker filter by genre (proposed)

With several themes for each genre the picker gets long. Proposed on 2026-11-16
(Albert and Fable); needs the maintainer's agreement and is not built.

- The picker opens showing the themes that suit the campaign's genre, with the
  default marked. The others appear only when the player asks for them, through
  one control, not one for each genre.
- The theme a campaign already uses always shows, even when the filter would
  hide it. A custom campaign sees every theme.
- The filter stays hidden while the whole list is short.
- Each catalog entry needs the genres it suits, kept apart from the one genre
  it is the default for. A theme can suit several.

| Suits | Themes |
| --- | --- |
| High fantasy | Arcane, Ancient Woodland, High Kingdoms, Hearth & Haven, Deep Forge, Sunken Tide, Frostbound, Sunscorched, Radiant Heights, Twilight Court, Inferno, Skyfarer |
| Dark fantasy | Gothic, Ossuary, Inferno, Deep Forge, Arcane |
| Horror | Ossuary, Unquiet Depths, Gothic |
| Mystery | Gaslight, Unquiet Depths, Noir |
| Steampunk | Brassworks, Galvanic, Skyfarer |
| Cyberpunk | Neon District, Noir |
| Post-apocalyptic | Wasteland |

## Follow the story (later idea)

A third choice in the picker beside a named theme and "match the genre": the
table's look follows where the party is. Proposed on 2026-11-16 (Albert and
Fable) as a long-term, low-priority feature. Not designed in detail and not
agreed.

- Change by region, not by room. The party travels to the frozen north and the
  table turns to Frostbound for that stretch; a tavern stop there stays
  Frostbound. A tavern in a great city stays High Kingdoms.
- Change only when the scene changes, never during combat, and with a slow fade.
- Stay inside the themes that suit the campaign's genre.
- Each player can hold their own screen on one theme while the table follows.
- A place that matches no theme keeps the current one.
- It needs each theme to list the places it stands for, the scene to carry a
  place label (whether scenes record one today has not been checked), and the
  next theme's images loaded before the fade.
- A cheaper first step: change only the backdrop and accent colour by place and
  leave the frame and controls alone.
- Wait until there are enough place themes to travel between.

| Place | Theme |
| --- | --- |
| Countryside, homesteads, villages, small towns, roadside inns | Hearth & Haven |
| Great cities, castles, courts, manors | High Kingdoms |
| Wild forest | Ancient Woodland |
| Mines, mountain holds, foundries | Deep Forge |
| Coasts, ports, the sea | Sunken Tide |
| Tundra and high peaks | Frostbound |
| Desert and old ruins | Sunscorched |

## Suggested build order

1. Finish PR 962's validation and settle the reusable theme contracts.
2. Recover Deep Forge and port it as the first independent extension. Existing
   work makes it a useful check that the authoring guide is sufficient.
3. Build one genre theme. Neon District would exercise a visibly different
   material family and mixed vector/painted artwork; this is a recommendation,
   not a committed priority.
4. Rebase the built Tide theme after PR 962's shared fixes, then choose further
   themes according to interest and the remaining gaps in the picker. Hearth
   and High Kingdoms are already assigned in the active-work table.

## Before a row moves to started

- The look must read as different from every shipped theme at picker size, in
  both night and day. Record its materials, border shapes and accent colors.
- Avoid named settings, characters and creatures from published games in the
  name, description and artwork. Record asset sources and generation prompts.
- A genre has at most one default theme; other themes may suit it without
  claiming it. A theme with no natural genre claims none. Discuss changes to existing genre defaults before adding claims.
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
| How many themes before grouping the picker? | The current checks cover three real choices and four/six-card layout fixtures. Reassess with the first seventh theme and actual phone use. | Seven themes are on main since 2026-11-16. A filter by genre is proposed above; the maintainer has not ruled on it. |
| What is the asset budget per theme? | Measure the complete shipped set and retain the existing 2 MiB limit per image. | The suggested 0.5–2 MB per-theme range is an estimate, not an enforced total. |
| Who continues Forge/Tide? | Build on Fable's groundwork and record the handoff in the active-work table. Tide is now built in PR 977. | Forge's next owner; Tide's rebase and final validation after the shared fixes. |
