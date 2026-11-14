# Build an appearance theme

Use this guide to add a visual theme with its own palette, materials and artwork.
Everything needed to register and validate it lives in this repository. Ancient
Woodland is the worked example for a theme with painted borders and fittings.
Arcane and Gothic are palette and CSS treatments; they do not yet have equivalent
painted furniture.

The [implementation validation record](appearance-validation.md) lists the checks
completed for Woodland and the shared infrastructure.

## How the pieces fit

An appearance is separate from brightness, interface size and the campaign's
written story theme. A player can use Woodland in either day or night mode.

| Piece | Location | Responsibility |
| --- | --- | --- |
| Catalog | `src/lib/appearance-themes.ts` | IDs, names, picker symbols, stylesheet paths and optional artwork slots |
| Preferences | `src/lib/theme-mode.ts` | Campaign choice, personal override, brightness, scale and root artwork variables |
| Personal picker | `src/components/AppearancePicker.tsx` | Catalog-driven choices with independent day/night previews |
| Campaign picker | `src/app/campaigns/[campaignId]/GameSettingsGroups.tsx` | Visual theme in Atmosphere, saved through the existing settings schema |
| Base palettes | `src/app/styles/themes/<id>.css` | Complete light and dark color sets |
| Shared surfaces | `src/app/styles/appearance.css` | Controls, dialogs, preview layout and common color rules |
| Painted ornaments | `src/components/ThemeOrnaments.tsx`, `src/app/styles/theme-ornaments.css` | Four rotated corners, table border, phone sizing and forced-colors behavior |
| Woodland treatment | `src/app/styles/woodland-materials.css`, `woodland-session.css` | Oak surfaces, silver fittings, lobby arrangement and active-play treatment |
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
   `src/app/styles/themes/moonlit.css`. Replace both `data-appearance="arcane"`
   selectors with `data-appearance="moonlit"`. Set all 24 color variables for each
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

   The pickers and schema now include it. Existing symbols are `sparkles`, `leaf`
   and `church`. To introduce another symbol, extend `AppearanceDefinition.icon`
   and the symbol map in `AppearancePicker.tsx` together.

4. Import the new stylesheet in `src/app/globals.css`, alongside the other
   `./styles/themes/` imports. Put treatment styles after the shared surface
   styles. Scope rules to `[data-appearance="moonlit"]`, adding
   `[data-theme="light"]` or `[data-theme="dark"]` where needed. Keep selectors
   rooted on `html` for dialogs rendered outside the campaign's main element.

5. Add artwork if the design needs it, following the next section. A palette-only
   theme can omit `art` and `provenance`. Test both brightness modes before
   describing the theme as complete.

6. Run the checks below and inspect the captured views. Include the guide link,
   theme ID, commands run and remaining limitations in the PR description.

Changing genre defaults is a separate choice. `campaignAppearance()` currently
suggests Gothic for horror and dark fantasy, and Arcane for other genres. An
explicit campaign selection takes precedence, and a personal selection takes
precedence over the campaign. Leaving a campaign restores Arcane when following
the campaign. Brightness and size remain the player's choices.

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

The shared renderer automatically uses the frame and corner slots. Texture and
backdrop are available to the theme's CSS. Woodland shows how to put a controlled
color wash over a texture and how to use a backdrop only when no campaign cover
or scene painting exists. Keep those placeholder conditions when adapting it.

The neutral hooks already exist in the components:

| Hook | Use |
| --- | --- |
| `.theme-table` | Full-screen active session |
| `.theme-lobby-shell` | Lobby enclosure |
| `.theme-framed` | Padded content explicitly opted into a decorative panel border |
| `.theme-key`, `.theme-key-primary` | Shared neutral and primary controls |
| `.theme-key-danger` | Exclusion for destructive controls; preserve their meaning |
| `.theme-default-cover` | Lobby cover only when the campaign has no cover |
| `.cine-backdrop[data-placeholder]` | Active-play backdrop only without a cover or painted scene |
| `.theme-heading-icon`, `.theme-crest` | Optional lobby fittings; the current crest is a leaf symbol |

New themes can style these hooks without editing `Lobby.tsx` or `SessionView.tsx`.
Keep theme-specific materials in that theme's CSS. A starship panel does not have
to inherit Woodland's wood, curves or lobby arrangement.

The ornament is an absolute overlay with `aria-hidden` and no pointer events. It
does not reserve space for itself. Reserve a quiet rail in your theme's container
styles and keep the asset's transparent interior clear of text and controls.
Woodland uses a 10px table rail on desktop and 4px on phones. Its lobby rail is
26px on desktop and 12px on phones. It has additional inner padding.

Shared ornament measurements can be overridden in the theme selector:

| Variable | Default |
| --- | --- |
| `--theme-frame-slice` | `22%` |
| `--theme-table-ornament-inset` / `-small` | `-10px` / `-4px` |
| `--theme-table-frame-width` / `-small` | `40px` / `28px` |
| `--theme-table-corner-size` / `-small` | `128px` / `84px` |
| `--theme-lobby-ornament-inset` / `-small` | `-34px` / `-16px` |
| `--theme-lobby-corner-size` / `-small` | `196px` / `112px` |

The table's small measurements apply below 1024px; the lobby's apply at 540px and
below. Themes with no frame or corner hide the overlay entirely. Forced-colors
mode hides it for every theme. Decorative overlays must never receive focus.

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

The appearance check enumerates the catalog. It checks registration, stylesheet
imports, both complete palettes, selected text contrast pairs, asset paths and
size, provenance entries, preference precedence, and artwork reset behavior.
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

These checks validate interface behavior and geometry, not full combat rules,
multiplayer synchronization, mobile Safari, or screen-reader usability. Also
inspect labels, keyboard focus, selected/disabled/danger states, modal content,
and real campaign art. Use a real phone before release when possible. A screenshot
with pleasant colors is not proof that all controls remain usable.

Stop the preview with Ctrl+C when finished. `.theme-preview/` is ignored; do not
commit databases or browser profiles. Preserve only the screenshots and summary
needed for the PR. If styles appear stale, restart the preview and rerun the
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
