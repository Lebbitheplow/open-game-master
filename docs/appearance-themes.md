# Build an appearance theme

Use this guide to add a visual theme with its own palette, materials and artwork.
Everything needed to register and validate it lives in this repository. All three
shipped themes have painted materials, borders and scenery: Woodland uses oak
and ivy, Arcane uses indigo stone and celestial brass, and Gothic uses cathedral
stone, silver tracery and garnet glass.

The [implementation validation record](appearance-validation.md) lists the checks
completed for all three themes and the shared infrastructure.
The [theme progress and ideas list](appearance-theme-ideas.md) tracks proposed
themes, reported work in progress, delivery status and open design decisions.

## How the pieces fit

An appearance is separate from brightness, interface size and the campaign's
written story theme. A player can use Woodland in either day or night mode.

| Piece | Location | Responsibility |
| --- | --- | --- |
| Catalog | `src/lib/appearance-themes.ts` | IDs, names, symbols, genre associations, base style, corner crop and artwork slots |
| Preferences | `src/lib/theme-mode.ts` | Campaign choice, personal override, brightness, scale and root artwork variables |
| Personal picker | `src/components/AppearancePicker.tsx` | Catalog-driven choices with independent day/night previews |
| Campaign picker | `src/app/campaigns/[campaignId]/GameSettingsGroups.tsx` | Visual theme in Atmosphere, saved through the existing settings schema |
| Base palettes | `src/app/styles/themes/<id>.css` | Complete light and dark color sets |
| Shared surfaces | `src/app/styles/appearance.css` | Controls, dialogs, preview layout and common color rules |
| Painted ornaments | `src/components/ThemeOrnaments.tsx`, `src/app/styles/theme-ornaments.css` | Four rotated corners, table/overlay border, phone sizing and forced-colors behavior |
| Shared materials | `src/app/styles/theme-materials.css`, `theme-session.css` | Textured controls, metal fittings, lobby arrangement, active table and enlarged-map treatment |
| Symbols | `src/components/ThemeIcon.tsx`, `ThemeEmblem.tsx` | One checked icon map serves the picker and lobby fitting |
| Artwork | `public/assets/themes/<id>/` | Versioned images and their provenance record |
| Automated checks | `scripts/test-appearance.mjs`, `scripts/appearance/` | Catalog checks and a disposable browser preview |

The catalog is safe to import on the server. It defines the ID union and the
settings schema's allowed IDs, so there is no second ID list to update. The
`stylesheet` field is checked against `globals.css`; it does not dynamically load
CSS. Next must see each CSS import when building the app.

`public/assets/themes/default/theme.config.json` belongs to the 3D dice library.
It is not the app appearance registry. Leave it alone when adding an appearance.

## Add a theme

1. Choose a permanent lowercase ID such as `moonlit`. IDs are saved in campaigns
   and browser preferences. Avoid renaming a shipped ID without a migration.

2. Copy `src/app/styles/themes/arcane.css` to
   `src/app/styles/themes/moonlit.css`. Replace every `data-appearance="arcane"`
   selector with `data-appearance="moonlit"`. Set all 24 color variables for each
   brightness mode. Keep six-digit hex colors in these base blocks so the contrast
   check can read them. `stone-*` supplies surfaces and text; `amber-*` supplies
   the theme accent even if that accent is green or silver.

3. Add an entry to `APPEARANCE_THEMES` in `src/lib/appearance-themes.ts`:

   ```ts
   {
     id: "moonlit",
     name: "Moonlit",
     description: "Cool stone, pale silver, and a quiet night sky.",
     icon: "sparkles",
     stylesheet: "src/app/styles/themes/moonlit.css",
   },
   ```

   The pickers and schema now include it. Existing symbols are `sparkles`, `leaf`,
   `church` and `waves`. To introduce another symbol, add its key to `APPEARANCE_ICONS`
   and its component to the single map in `ThemeIcon.tsx`. Type checking catches
   a missing mapping.

4. Import the new stylesheet in `src/app/globals.css`, alongside the other
   `./styles/themes/` imports. Put treatment styles after the shared surface
   styles. Scope rules to `[data-appearance="moonlit"]`, adding
   `[data-theme="light"]` or `[data-theme="dark"]` where needed. Keep selectors
   rooted on `html` for dialogs rendered outside the campaign's main element.

   Keep every theme-specific rule, including material overrides, in that one
   registered stylesheet. Start each selector with `[data-appearance="moonlit"]`
   or `html[data-appearance="moonlit"]`. Comma-separated selectors each need
   their own prefix. Media, support and container queries can contain these
   rules. The checker rejects sibling selectors, nested CSS rules and global
   declarations such as `@font-face`, `@keyframes` and `@import` in theme files.
   Put genuinely shared behavior in shared styles, using variables or declared
   options rather than naming a theme.

5. Add artwork if the design needs it, following the next section. A palette-only
   theme can omit `art` and `provenance`. Test both brightness modes before
   describing the theme as complete.

6. Run the checks below and inspect the captured views. Include the guide link,
   theme ID, commands run and remaining limitations in the PR description.

Changing genre defaults is a separate choice. Add an optional `genres` list to
the catalog entry to claim supported genre keys, such as `genres: ["steampunk"]`.
The checks reject unknown keys and duplicate claims. Gothic claims horror and
dark fantasy; unclaimed genres and unknown saved genres fall back to Arcane. An
explicit campaign selection takes precedence, and a personal selection takes
precedence over the campaign. Leaving a campaign restores Arcane when following
the campaign. Brightness and size remain the player's choices.

The optional `baseStyle` defaults to `"plain"`, which replaces the original
celestial controls and backgrounds with the theme palette. Arcane declares
`"celestial"` to retain that existing furniture. This choice is separate from
painted artwork: either base can use the shared materials and ornament renderer.

## Add painted materials and borders

Put production images under `public/assets/themes/<id>/` and register their
public paths in the catalog. Use versioned filenames such as `corner-v1.webp`.
Do not put text or functional controls into the artwork.

```ts
art: {
  texture: "/assets/themes/moonlit/stone-v1.webp",
  frame: "/assets/themes/moonlit/frame-v1.webp",
  corner: "/assets/themes/moonlit/corner-v1.webp",
  backdrop: "/assets/themes/moonlit/courtyard-v1.webp",
},
provenance: "public/assets/themes/moonlit/art-provenance.json",
```

These are example paths. Supply real files before registering them. Each slot is
optional. `themeArtStyle()` writes all four CSS variables, using `none` for an
absent slot. It runs for the root appearance and for each picker preview. That
explicit reset prevents one theme from inheriting another theme's artwork.

| Slot | CSS variable | Asset contract |
| --- | --- | --- |
| `texture` | `--theme-art-texture` | Repeating, evenly lit material with restrained contrast; no baked-in borders |
| `frame` | `--theme-art-frame` | Square border with a transparent center, suitable for nine-slice rendering; default slice is 22% |
| `corner` | `--theme-art-corner` | Transparent top-left L-shaped fitting; lower-right interior empty; rotates for the other three corners |
| `backdrop` | `--theme-art-backdrop` | Wide opaque scene that remains readable when cropped for a shallow banner |

The shared renderer automatically uses the frame and corner slots. Registering
either also enables the shared painted layout and material styles. These put a
controlled color wash over the texture and use the backdrop only when no campaign
cover or scene painting exists. Keep those placeholder conditions when adapting it.

Set material variables in the theme's stylesheet; do not copy the shared styling.
Defaults use the theme's palette, and overrides also apply inside picker previews:

| Variables | What they change |
| --- | --- |
| `--material-inset`, `--material-paper` | Opaque backgrounds beneath readable text |
| `--material-panel-wash`, `--material-control-wash` | Gradients layered over the texture |
| `--material-metal`, `--material-edge` | Fitting text and border colors |
| `--material-metal-finish`, `--material-metal-ink` | Painted metal gradient and its emblem color |
| `--material-primary-wash` | Primary-button gradient; keep light button text legible in both modes |
| `--material-send-wash`, `--material-send-edge`, `--material-chosen-wash` | The table's send key and its border, and the chosen say/do key; opaque, under light text |
| `--material-vital-fill` | Party health bar above the low-health mark |
| `--material-fitting-radius`, `--material-control-radius`, `--material-panel-radius` | Circular Arcane, pointed Gothic or asymmetric Woodland shapes |
| `--material-body-wash`, `--material-rail-wash`, `--material-scrim` | Page, rail and scenery shading |
| `--material-crest-tilt` | Rotation of the decorative lobby emblem |

The send and chosen-action defaults preserve Woodland's green controls. Arcane
and Gothic override them with opaque brass/indigo and garnet gradients. Keep
light labels legible in both brightness modes. Healthy party bars remain green
in these three themes; low-health styling is semantic and is not overridden by
`--material-vital-fill`. The moving selection highlight copies the chosen
button's fill, so inspect that visible highlight when testing the chosen color.

Arcane and Gothic reuse their frame image for the `corner` slot. Their catalog
entries set `cornerScale: 4`, which displays the top-left 25% of each image axis
(one sixteenth of its area) before rotation. The registry writes the matching
background size and position for both the page and picker; do not override those
geometry variables in CSS. The optional `frameSlice` sets the nine-slice inset as
a percentage (default 22). The art checker reads the same scale and inset. Keep that
crop's lower-right interior transparent. For a separate complete corner image,
omit `cornerScale` to use the defaults `contain` and `center`.
This avoids generating a second fitting that does not match its frame.

The neutral hooks already exist in the components:

| Hook | Use |
| --- | --- |
| `.theme-table` | Full-screen active session |
| `.theme-overlay` | Full-screen portalled surfaces, including the enlarged battle map |
| `.theme-lobby-shell` | Lobby enclosure |
| `.theme-framed` | Padded content explicitly opted into a decorative panel border |
| `.theme-key`, `.theme-key-primary` | Shared neutral and primary controls |
| `.theme-key-danger` | Exclusion for destructive controls; preserve their meaning |
| `.theme-default-cover` | Lobby cover only when the campaign has no cover |
| `.cine-backdrop[data-placeholder]` | Active-play backdrop only without a cover or painted scene |
| `.theme-heading-icon`, `.theme-crest` | Optional lobby fittings; the crest uses the catalog's symbol |

New themes can style these hooks without editing `Lobby.tsx` or `SessionView.tsx`.
Keep theme-specific material variables in that theme's CSS. For a substantially
different layout, add scoped treatment rules after the shared material imports.

The ornament is an absolute overlay with `aria-hidden` and no pointer events. It
does not reserve space for itself. Reserve a quiet rail in your theme's container
styles and keep the asset's transparent interior clear of text and controls.
The enlarged battle map renders its own `ThemeOrnaments surface="overlay"`
inside the dialog. A portal is outside the session's element tree, so it cannot
reuse the session's ornament element. It inherits the registered artwork from
the document root and uses the same frame and corner geometry as the table.
Keep overlay containers positioned (the battle map uses `fixed`) and place the
ornaments inside them; do not change their positioning to `relative`.

The shared painted layout uses a 10px table and overlay rail on desktop and 4px
on phones. The enlarged map also reserves inner padding from the declared frame
width, so its heading, controls and initiative rows stay inside the painted rail.
Its lobby rail is 26px on desktop and 12px on phones, with additional inner padding.
Session headers give the back link and title separate phone grid cells; larger
headers wrap controls and initiative instead of shrinking the title to a letter.
Use the named `session-back`, `session-heading` and `session-controls` hooks when
changing that layout, rather than assuming a particular child position.

Shared ornament measurements can be overridden in the theme selector:

| Variable | Default |
| --- | --- |
| `--theme-table-ornament-inset` / `-small` | `-10px` / `-4px` |
| `--theme-table-frame-width` / `-small` | `40px` / `28px` |
| `--theme-table-corner-size` / `-small` | `128px` / `84px` |
| `--theme-lobby-ornament-inset` / `-small` | `-34px` / `-16px` |
| `--theme-lobby-corner-size` / `-small` | `196px` / `112px` |

The table's small measurements apply below 1024px; the lobby's apply at 540px and
below. Themes with no frame or corner hide the overlay entirely. Forced-colors
mode hides it for every theme. Decorative overlays must never receive focus.
Arcane and Gothic override table corners to 48px on desktop and 32px on phones:
their opaque metal fittings need less space than Woodland's open leaves. Inspect
the actual artwork over headings and close buttons; geometry checks alone cannot
detect a painted corner covering text.

Keep each shipped image below 2 MiB. Prefer WebP for painted material and alpha
art, and SVG for suitable vector designs. Inspect alpha edges, repetition and
phone crops. Record each shipped filename, its creator/source or generation
prompt, date, encoding, and applicable rights in `art-provenance.json`. Woodland's
record is an example. Original working PNGs are optional source material; the
production files and provenance must be present in the PR itself.

## Validate in a disposable campaign

From the repository root, after installing the normal app dependencies:

```sh
npm run test:appearance
npx tsc --noEmit
```

The appearance command runs both preference/palette checks and theme contracts.
It checks registration, imports, genre claims, stylesheet ownership, complete
palettes, selected contrast pairs, asset paths and size, provenance, preference
precedence, and artwork reset behavior. It also decodes the production images:

- Frames and corners must be square and contain visible artwork.
- A frame's centre inside its declared inset must be transparent (central 56%
  along both axes with the default 22% inset). A corner's lower-right 40% along both axes must be transparent
  within the displayed crop. At most 0.5% of those pixels may have alpha above
  16 out of 255, allowing faint edge antialiasing.
- Textures and scenery must be opaque (alpha at least 250 out of 255).

Failure messages identify the theme and slot. Correct the asset or its declared
crop rather than loosening the test for a single image. Deliberately invalid
CSS and image fixtures verify that the guards reject defects.
This is not a full accessibility audit of every rendered control.

The campaign picker checks the `appearanceThemes` server capability. Older
hosts hide it because they cannot save the new field. Personal appearance and
brightness remain local preferences.

Stop any other Next development server for this checkout first, because Next
uses a development lock. Then run:

```sh
npm run theme:preview -- --theme woodland
```

This creates a new disposable SQLite fixture under `.theme-preview/woodland/` and
starts a local-only server at `http://127.0.0.1:3016`. It overrides the database
path and key for this process. It creates a lobby, a long story and an active
combat with fictional players. It uses human-DM mode and does not call an AI
service. The printed fixture login is `theme_preview` / `ThemePreview2026!`.
The key is temporary and not printed; these fixtures are not persistent campaigns.

In another terminal:

```sh
npm run theme:check -- --theme woodland
```

Replace `woodland` in both commands with the registered theme ID. Use matching
`--port 3017` arguments if 3016 is occupied. The browser check discovers common
Chrome/Chromium/Edge installations. For another location, pass
`--browser "/absolute/path/to/browser"` or set `THEME_BROWSER`. It uses a fresh
browser profile and never attaches to your signed-in browser.

The check writes `results.json`, screenshots and a self-contained `review.html`
under `.theme-preview/<id>/`. Failures produce a nonzero exit code and a failure
screenshot. Open `review.html` to inspect the actual rendered artwork.

The current browser matrix covers:

- Lobby at desktop and phone widths, in day and night mode.
- Long conversations and combat at widths 1360, 390 and 320, at 100% and 125% text.
- Dice dialog sizing, a roll, and Escape dismissal.
- Map keyboard zoom, enlarged-map opening and closing, and combat-card selection.
- Artwork replacement across all registered themes and hiding in forced-colors mode.
- The actual account Appearance dialog at desktop/phone widths, day/night and
  enlarged text: keyboard theme selection, Follow campaign, isolated preview
  colors/artwork, and layout-only fixtures with four and six choices.
- Visible title characters, back-link collisions and header control bounds at
  enlarged text sizes, including 320/390px phones and 1024/1360/1920px desktops.
- Enlarged-map content clearance from the painted frame, including initiative
  rows, after finite entrance animations settle.
- Live overrides of the four table material variables, including the moving
  selection highlight and preservation of the low-health treatment.

Use `npm run theme:check -- --theme woodland --picker-only` for the six picker
checks alone. Its results are saved to `results-picker.json`; extra cards are
temporary browser fixtures and are never registered or saved as real themes.

Use `npm run theme:check -- --theme woodland --layout-only` for the 16 painted-theme header,
frame-clearance and material checks. Results go to `results-layout.json`.
These also run in the full matrix. The layout checks were verified to fail on
the title collisions and frame overlap reported during Tide's development.

These checks validate interface behavior and geometry, not full combat rules,
multiplayer synchronization, mobile Safari, or screen-reader usability. Also
inspect labels, keyboard focus, selected/disabled/danger states, modal content,
and real campaign art. Use a real phone before release when possible. A screenshot
with pleasant colors is not proof that all controls remain usable.

Stop the preview with Ctrl+C when finished. `.theme-preview/` is ignored; do not
commit databases or browser profiles. Preserve only the screenshots and summary
needed for the PR. Publish review screenshots on a separate evidence branch and
link them from the PR; keep production artwork and provenance with the code.
The [PR 962 gallery](https://github.com/Smoebo/open-dungeon-master/tree/826cd595e90b0693b5c788819a86fcb44e83c9dc)
is an example. Use a commit link so later captures cannot silently change the
review evidence. If styles appear stale, restart the preview and rerun the
check. This occurred with imported CSS during Woodland development. A missing
stylesheet import or a stale compiled stylesheet can otherwise hide new art.

After stopping the preview, run `npm run build` to check production compilation.
If production appearance differs from development, inspect the stylesheet import
order in `globals.css` before increasing selector specificity.

## Review and maintenance

A theme PR should identify its asset sources, show day/night and desktop/phone
views, list completed checks, and distinguish automated results from manual
inspection. Keep imported styles scoped to the appearance. Do not change story
content, action rules, player artwork, or semantic colors to support a theme.

When adding a new shared surface, add a neutral hook once, document it here, and
exercise it in the preview fixtures. When fixing a reusable renderer, check a
theme with artwork and a theme without it. Keep this guide linked from README
and AGENTS so another session can find the extension points without chat history.
