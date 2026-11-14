# Shared equipment by genre

Shared equipment now uses artwork suited to the campaign in inventory rows,
shop details and Hand cards. A cyberpunk dagger has a dark polymer grip and
cyan inset; its post-apocalyptic counterpart has salvaged metal and an orange
cloth grip. Equipment names and rules stay the same.

This pass covers the shared equipment used in the six genre starting kits:

| Genre | Paintings |
| --- | ---: |
| Cyberpunk | 2 |
| Dark fantasy | 12 |
| Horror | 6 |
| Mystery | 7 |
| Post-apocalyptic | 11 |
| Steampunk | 11 |

Each of the 49 paintings has a transparent 256 × 128 card export and a
256 × 256 inventory export. Inventory art has enough transparent padding
for the circular frame and its existing 1.7× enlargement.

## Selection and fallback

`src/lib/equipment-art.json` lists the available variants. The pure resolver
in `equipment-art-logic.ts` matches catalogue names and the existing bonus
spellings, such as `Dagger +1`. An unrelated homebrew name such as
`Moon Dagger` keeps its existing fallback.

`SessionView` supplies the campaign genre through `EquipmentArtProvider`.
The inventory icons inherit it, including icons inside portalled dialogs.
`cardArtwork` selects the wide export for Hand cards and shop details.
Outside a campaign, for an unsupported genre, or for an item without a
variant, the original artwork remains available. The generic fantasy files
are not replaced. This change adds no setting or player control.

## Sources and review

All paintings are original, unbranded equipment illustrations made with
built-in `image_gen`. The [manifest](shared-genre-equipment-2026-11-14.json)
records exact prompts, edit history, source hashes and export hashes.
Original PNGs remain in the local art archive; the repository ships the
98 WebPs. The generator catalogue marks both export sizes as external art
so rebuilding the icon index preserves them.

The review corrected a pale fringe around the dark-fantasy longsword and
regenerated the cyberpunk forgery kit to preserve the whole case without
a background glow. All six contact sheets were inspected on light and
dark backgrounds. The actual inventory and Hand components were also
rendered at desktop and phone widths in both themes.

- [All components, dark](shared-genre-equipment-desktop-dark.png)
- [All components, light](shared-genre-equipment-desktop-light.png)
- [Phone, dark](shared-genre-equipment-phone-dark.png)
- [Phone, light](shared-genre-equipment-phone-light.png)
- [Component check results](shared-genre-equipment-component-checks.json)

`scripts/test-shared-genre-equipment-art.mjs` checks all 49 mappings and
98 files, dimensions, hashes, transparency, circular framing, catalogue
preservation, bonus spellings and fallbacks. Run the component preview with
`node scripts/preview-shared-genre-equipment-art.mjs`; set `ODM_BROWSER` to
an installed Chromium or Chrome executable if the browser harness needs it.

The production website and the separately built client app shell were checked
with a synthetic local steampunk table. All 19 equipment images loaded on each
screen, with no page errors. A simulated image failure also loaded the original
dagger artwork. App checks used Chromium, not a physical native device.

| Surface | Desktop | Phone |
| --- | --- | --- |
| Website, dark | [Screenshot](shared-genre-equipment-web-desktop-dark.png) | [Screenshot](shared-genre-equipment-web-phone-dark.png) |
| Website, light | [Screenshot](shared-genre-equipment-web-desktop-light.png) | [Screenshot](shared-genre-equipment-web-phone-light.png) |
| App shell, dark | [Screenshot](shared-genre-equipment-app-desktop-dark.png) | [Screenshot](shared-genre-equipment-app-phone-dark.png) |
| App shell, light | [Screenshot](shared-genre-equipment-app-desktop-light.png) | [Screenshot](shared-genre-equipment-app-phone-light.png) |

[Live check results](shared-genre-equipment-live-checks.json) record those checks.
The production build passed. Repository lint finished with no errors and 313
existing warnings. The full test run passed 1,216 files and found one missing
name-lookup audit classification. That classification was corrected; a final
run of the lookup audit, card-art and shared-equipment test files passed all
three files. The full suite was not repeated after that metadata correction.
