# Everyday equipment by genre

This follow-up to PR #961 adds 87 paintings for shared equipment beyond the
starting kits. Each has a transparent 256 × 128 card export and a 256 × 256
inventory export, giving 174 new assets. Existing fantasy art and the 49
starting-kit variants remain intact.

| Genre | New paintings |
| --- | ---: |
| Cyberpunk | 14 |
| Dark fantasy | 14 |
| Horror | 14 |
| Mystery | 13 |
| Post-apocalyptic | 16 |
| Steampunk | 16 |

All six genres receive backpacks, pouches, rations, thieves' tools, common
clothes, fine clothes, traveler's clothes, locks and chests. Selected genres
also receive camping and climbing equipment, games, manacles, disguise and
forgery kits, tinker's tools, alchemist's supplies and a holy symbol.
The [subject list](../../scripts/extended-genre-equipment-subjects.json)
records every item and genre combination.

## Selection

The campaign's existing genre chooses the inventory and card painting.
Exact catalogue aliases such as `rations` and `common clothes` now resolve
to their genre variants. Existing weapon and bonus-name handling remains in
place. Unknown genres, unsupported items and unrelated homebrew names retain
their original fallback. Equipment rules and availability do not change.

## Sources

The [manifest](extended-genre-equipment-2026-11-14.json) records the image
prompts, source hashes, export hashes and revision history. All paintings
were created with built-in `image_gen`. Original PNGs and superseded versions
remain in the local artwork archive; the repository ships the WebP exports.

Visual review replaced a Victorian-looking dark-fantasy outfit with medieval
clothing, made three padlocks clearly metallic, and gave the cyberpunk
grappling hook complete framing. Five thieves' tool variants use closed cases
after the image service rejected the initial visible-tool depictions.

The exporter checks transparency and keeps inventory art within the circular
frame at the game's existing 1.7× zoom. The icon catalogue marks both export
sizes as external art so regeneration preserves them.

## Review

The focused artwork suite checks all 87 mappings and 174 exports: catalogue
aliases, hashes, dimensions, transparency, circular framing, generator
preservation, component context and fallbacks. The lookup audit passes.
All 49 pre-existing variants and all 2,121 previous icon-manifest records are
unchanged. Repository lint has no errors and 313 existing warnings.

The actual `GameIcon` and `HandCardFace` components were rendered with the
application stylesheet at 1280px and 390px, in both themes. All 174 inventory
images and 87 card images decoded and used their expected genre paths, with
no horizontal overflow or page errors. These are static component checks;
the campaign and app-shell review is recorded separately below.

| Component screenshots | Inventory | Cards |
| --- | --- | --- |
| Desktop, night | [Inventory](extended-genre-equipment-desktop-dark.png) | [Cards](extended-genre-equipment-desktop-dark-cards.png) |
| Desktop, day | [Inventory](extended-genre-equipment-desktop-light.png) | [Cards](extended-genre-equipment-desktop-light-cards.png) |
| Phone, night | [Inventory](extended-genre-equipment-phone-dark.png) | [Cards](extended-genre-equipment-phone-dark-cards.png) |
| Phone, day | [Inventory](extended-genre-equipment-phone-light.png) | [Cards](extended-genre-equipment-phone-light-cards.png) |

Full build, suite and live-screen results are pending.
