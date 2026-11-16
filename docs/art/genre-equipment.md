# Named genre equipment

The 32 named equipment paintings cover 18 weapons, six armor types and eight
specialist items. Inventory and shop rows use the square paintings; Hand cards
use the wide paintings. A pistol shows a pistol in every setting. Shared fantasy
equipment keeps its existing art, and unknown equipment keeps its usual fallback.

The set adds no equipment, rules, controls or genre-dependent substitutions.
It paints the names already present in the weapon table, armor table and genre
starting kits. The metadata's genre is an art-direction note, not an availability
restriction. The named equipment is registered with the icon generator as
externally authored art so rebuilding its index preserves the paintings.

## Files and source history

- `public/assets/icons/item/`: 32 square inventory paintings, preserving existing
  paths for repaints.
- `public/assets/icons/action/`: 32 wide paintings, selected by `card-art.json`.
- `scripts/genre-equipment-subjects.json`: names and generator registrations.
- `genre-equipment-2026-11-14.json`: exact prompts, source PNG filenames and hashes,
  exported WebP hashes and the sword-cane request's retry history.

The images were generated with the built-in `image_gen` tool as original,
unbranded game illustrations. Original PNGs remain in the local art archive;
the repository ships the WebP files. The approved wide exports are unchanged.
The inventory exports add transparent padding: the artwork stays within a
70px radius in its 256px texture, so `GameIcon`'s existing 1.7x enlargement
fits the complete silhouette inside its circular frame.

## Review and checks

The final visual review checked all 32 subjects for their named equipment,
complete silhouettes, distinct weapon construction and absence of labels or
brand marks. Light and dark contact sheets show the wide paintings at 112x56.
The component screenshots show the actual `GameIcon` at 40px and 96px and
the actual `HandCardFace`, using application CSS at desktop and phone widths.
These are static component previews, not authenticated campaign or native
client screenshots.

The `genre-equipment-web-*.png` and `genre-equipment-app-*.png` screenshots
also check the equipment section of a real character sheet, using a synthetic
local table. Both the production website and compiled client app shell passed
at desktop and phone widths in light and dark themes. All 56 equipment images
on the sheet (including repeated worn-gear rows) loaded in every view, with no
page errors. See `genre-equipment-live-checks.json` for the source commits and
capture list. The app shell ran in Chromium; this was not a physical-device test.

The isolated client build needed Windows file-URL imports in its build script.
Its runtime sources were unchanged. The synthetic database, credentials and
server logs are not part of this art change.

Run the focused checks from the repository root:

```sh
node scripts/test-genre-equipment-art.mjs
node scripts/test-card-art.mjs
node scripts/test-icons.mjs
node scripts/test-hand-look.mjs
```

The equipment suite verifies all 64 exported files, hashes, dimensions,
transparency, circular-frame margins, name mappings and generator registrations.
To recreate component screenshots, set `ODM_BROWSER` to an installed Chromium
or Chrome executable, then run `node scripts/preview-genre-equipment-art.mjs`.
If it reports a missing browser, check that the executable exists at that path.
