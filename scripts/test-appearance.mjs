// Preference compatibility and campaign appearance persistence, without live data.
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
register("./lib/register-alias.mjs", import.meta.url);

const { APPEARANCE_THEMES, APPEARANCE_THEME_IDS, THEME_ART_SLOTS, themeArtStyle, themeArt, modeArt, artSlotStyle, campaignAppearance, genreAppearance, genreShortlist, resolveAppearance, appearanceDefinition, themeStylesheet, themeProvenance } = await import("../src/lib/appearance-themes.ts");
const { GENRES } = await import("../src/lib/schemas/game-settings-options.ts");
const { gameSettingsSchema, normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const prefs = await import("../src/lib/theme-mode.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");
const { themeArtAssets } = await import("./appearance/contracts.mjs");
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok: ${name}`); }

test("campaign appearance controls wait for hosts that can save the setting", () => {
  assert.equal(hostOffers({ features: {} }, "appearanceThemes"), false);
  assert.equal(hostOffers({}, "appearanceThemes"), false);
  assert.equal(hostOffers({ features: { appearanceThemes: true } }, "appearanceThemes"), true);
});

test("old campaigns acquire a safe genre default without losing their rules", () => {
  const settings = normalizeGameSettings({ genre: "dark_fantasy", mapsEnabled: false });
  assert.equal(settings.appearanceTheme, "genre");
  assert.equal(settings.mapsEnabled, false);
  assert.equal(campaignAppearance(settings), "gothic");
  assert.equal(campaignAppearance(), "arcane");
  assert.equal(campaignAppearance({ genre: "horror" }), "gothic");
});
test("campaign identity overrides the genre suggestion; a personal choice overrides both", () => {
  const saved = gameSettingsSchema.parse({ genre: "horror", appearanceTheme: "woodland" });
  const restored = normalizeGameSettings(JSON.parse(JSON.stringify(saved)));
  assert.equal(campaignAppearance(restored), "woodland");
  assert.equal(resolveAppearance("campaign", campaignAppearance(restored)), "woodland");
  assert.equal(resolveAppearance("arcane", campaignAppearance(restored)), "arcane");
  assert.equal(gameSettingsSchema.safeParse({ appearanceTheme: "invalid" }).success, false);
  assert.equal(normalizeGameSettings({ appearanceTheme: "invalid", genre: "horror" }).genre, "horror");
});

test("genre claims belong to the catalog and new entries need no resolver branch", () => {
  const claims = new Set();
  for (const definition of APPEARANCE_THEMES) for (const genre of definition.genres ?? []) {
    assert.ok(GENRES.includes(genre), `${definition.id}: unknown genre ${genre}`);
    assert.ok(!claims.has(genre), `${genre}: two themes claim the same genre`);
    claims.add(genre);
    assert.equal(campaignAppearance({ genre }), definition.id);
  }
  const extended = [...APPEARANCE_THEMES, { id: "test-forge", genres: ["steampunk"] }];
  assert.equal(genreAppearance("steampunk", extended, "arcane"), "test-forge");
  assert.equal(genreAppearance("unknown", extended, "arcane"), "arcane");
  assert.equal(genreAppearance(undefined, extended, "arcane"), "arcane");
});
test("a picker shortlists the themes that suit a genre only when that is a real choice", () => {
  for (const definition of APPEARANCE_THEMES) for (const genre of definition.suits ?? []) {
    assert.ok(GENRES.includes(genre) && genre !== "custom", `${definition.id}: cannot suit ${genre}`);
  }
  const catalog = [
    { id: "a", suits: ["horror", "mystery"] }, { id: "b", genres: ["horror"] }, { id: "c", suits: ["mystery"] },
    { id: "d" }, { id: "e" }, { id: "f", suits: ["steampunk"] },
  ];
  // Suited and default themes show, in catalog order, with the one in use kept in view.
  assert.deepEqual(genreShortlist("horror", catalog), ["a", "b"]);
  assert.deepEqual(genreShortlist("horror", catalog, ["e"]), ["a", "b", "e"]);
  // One suited theme is no choice; no genre, or one nothing suits, is nothing to go by.
  assert.equal(genreShortlist("steampunk", catalog), null);
  assert.equal(genreShortlist(undefined, catalog), null);
  assert.equal(genreShortlist("cyberpunk", catalog), null);
  // Hiding fewer than three only adds a step: the whole catalog shows.
  assert.equal(genreShortlist("mystery", catalog, ["d", "e"]), null);
  // The shipped catalog keeps the rule at any size: a genre's shortlist is
  // absent, or holds every theme made for it and still leaves out three.
  // (High fantasy had none while nearly every theme suited it.)
  const named = (theme) => [...("suits" in theme ? theme.suits : []), ...("genres" in theme ? theme.genres : [])];
  for (const genre of new Set(APPEARANCE_THEMES.flatMap(named))) {
    const shortlist = genreShortlist(genre, APPEARANCE_THEMES);
    if (shortlist === null) continue;
    const suited = APPEARANCE_THEMES.filter((theme) => named(theme).includes(genre)).map((theme) => theme.id);
    assert.ok(shortlist.length >= 2, `${genre} offers a choice`);
    assert.ok(suited.every((id) => shortlist.includes(id)), `${genre} shows every theme made for it`);
    assert.ok(APPEARANCE_THEMES.length - shortlist.length >= 3, `${genre} hides at least three`);
  }
  assert.ok(genreShortlist("dark_fantasy", APPEARANCE_THEMES)?.includes("gothic"), "a genre's default is on its shortlist");
});
test("server rendering reads defaults without browser APIs", () => {
  assert.equal(prefs.readAppearanceChoice(), "campaign");
  assert.equal(prefs.readThemeChoice(), "auto");
  assert.equal(prefs.readUiScale(), 1);
});
test("every registered theme ships imported palettes and traceable local artwork", () => {
  assert.equal(new Set(APPEARANCE_THEME_IDS).size, APPEARANCE_THEME_IDS.length, "Unique IDs");
  const imports = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  for (const theme of APPEARANCE_THEMES) {
    assert.match(theme.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(imports.includes(`@import "./${themeStylesheet(theme.id).replace("src/app/", "")}";`), `${theme.id}: import its stylesheet`);
    const assets = themeArtAssets(theme).map(entry => entry.asset);
    if (!assets.length) continue;
    assert.ok(existsSync(new URL(`../${themeProvenance(theme.id)}`, import.meta.url)), `${theme.id}: artwork provenance is required`);
    const provenance = JSON.parse(readFileSync(new URL(`../${themeProvenance(theme.id)}`, import.meta.url), "utf8"));
    for (const asset of assets) {
      assert.match(asset, new RegExp(`^/assets/themes/${theme.id}/[a-zA-Z0-9_-]+\\.(webp|png|svg)$`), "Use versioned local theme assets");
      const file = new URL(`../public${asset}`, import.meta.url);
      assert.ok(existsSync(file), `${asset} exists`);
      assert.ok(statSync(file).size <= 2 * 1024 * 1024, `${asset}: keep each shipped image below 2 MiB`);
      assert.ok(provenance.assets.some(entry => entry.file === asset.split('/').at(-1)), `${asset}: record its source`);
    }
  }
});
test("day artwork replaces only the slots it names, and only in light mode", () => {
  const night = { texture: "/n/texture.webp", frame: "/n/frame.webp", corner: "/n/corner.webp", backdrop: "/n/backdrop.webp" };
  const probe = { art: night, artDay: { frame: "/d/frame.webp", backdrop: "/d/backdrop.webp" } };
  assert.deepEqual(modeArt(probe, "dark"), night);
  assert.deepEqual(modeArt(probe, "light"), { ...night, frame: "/d/frame.webp", backdrop: "/d/backdrop.webp" });
  assert.deepEqual(modeArt({ artDay: { corner: "/d/corner.webp" } }, "dark"), undefined, "A day-only theme paints nothing at night");
  assert.deepEqual(artSlotStyle(modeArt({ artDay: { corner: "/d/corner.webp" } }, "light")), { ...artSlotStyle(), [THEME_ART_SLOTS.corner]: 'url("/d/corner.webp")' });
  assert.deepEqual(modeArt({ art: night }, "light"), night, "A theme with one set shows it in both modes");
  // The checks that read files walk both sets.
  assert.deepEqual(themeArtAssets(probe).map(entry => entry.asset), [...Object.values(night), "/d/frame.webp", "/d/backdrop.webp"]);
  for (const theme of APPEARANCE_THEME_IDS) {
    assert.deepEqual(themeArtStyle(theme), themeArtStyle(theme, "dark"), `${theme}: night is the default set`);
    if (!appearanceDefinition(theme).artDay) assert.deepEqual(themeArtStyle(theme, "light"), themeArtStyle(theme, "dark"), `${theme}: one set serves both modes`);
    else assert.notDeepEqual(themeArtStyle(theme, "light"), themeArtStyle(theme, "dark"), `${theme}: day artwork differs`);
    assert.deepEqual(artSlotStyle(themeArt(theme, "light")), Object.fromEntries(Object.entries(themeArtStyle(theme, "light")).filter(([key]) => key.startsWith("--theme-art-"))));
  }
});
// The title screen paints its top fold in the night palette in either
// brightness, so each theme repeats its dark tokens as --theme-night-*.
test("every theme's night mirror equals its dark palette", () => {
  for (const definition of APPEARANCE_THEMES) {
    const css = readFileSync(new URL(`../${themeStylesheet(definition.id)}`, import.meta.url), "utf8");
    const dark = css.slice(css.indexOf(`[data-appearance="${definition.id}"][data-theme="dark"]`)).split("}")[0];
    const tokens = [...dark.matchAll(/--(background|foreground|color-(?:stone|amber)-\d+):\s*(#[0-9a-f]{6})/g)];
    assert.equal(tokens.length, 24, `${definition.id}: dark palette`);
    for (const [, name, value] of tokens) {
      const night = `--theme-night-${name.replace("color-", "")}: ${value};`;
      assert.ok(css.includes(night), `${definition.id}: missing or stale ${night}`);
    }
  }
});
test("every registered palette has the full token set and legible text", () => {
  const required = ["--background", "--foreground", ...["stone", "amber"].flatMap(ramp => [50,100,200,300,400,500,600,700,800,900,950].map(step => `--color-${ramp}-${step}`))];
  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  function contrast(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }
  for (const definition of APPEARANCE_THEMES) {
    const theme = definition.id;
    const css = readFileSync(new URL(`../${themeStylesheet(definition.id)}`, import.meta.url), "utf8");
    for (const mode of ["light", "dark"]) {
      const selector = `[data-appearance="${theme}"][data-theme="${mode}"]`;
      assert.ok(css.includes(selector), `${theme}: missing ${mode} palette`);
      const block = css.slice(css.indexOf(selector)).split("}")[0];
      const colors = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map((match) => [match[1], match[2]]));
      for (const token of required) assert.ok(colors[token], `${theme}/${mode}: missing ${token} as a six-digit hex color`);
      for (const [foreground, background] of [
        ["--foreground", "--background"],
        ["--color-stone-400", "--color-stone-800"],
        ["--color-stone-500", "--color-stone-950"],
        ["--color-amber-950", "--color-amber-300"],
      ]) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${theme}/${mode}: ${foreground} against ${background}`);
      }
      if (theme === "arcane" && mode === "light") {
        assert.ok(contrast(colors["--color-stone-500"], "#ebe0c2") >= 4.5, "Arcane hint text must remain legible on the darker parchment sheet panels");
      }
    }
  }
});

const storage = new Map([["odm.theme", "light"], ["odm.ui-scale", "1.15"]]);
let osLight = false;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
globalThis.window = {
  localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  matchMedia: () => ({ matches: osLight }),
};
const properties = new Map();
globalThis.document = { documentElement: { dataset: {}, style: { setProperty(key, value) { properties.set(key, value); } } } };
try {
  test("existing brightness and scale survive choosing a visual theme", () => {
    prefs.writeAppearanceChoice("woodland");
    assert.equal(prefs.readThemeChoice(), "light");
    assert.equal(prefs.readUiScale(), 1.15);
    assert.equal(document.documentElement.dataset.appearance, "woodland");
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.equal(storage.get("odm.appearance"), "woodland");
  });
  test("all registered combinations apply independently and follow-system resolves dynamically", () => {
    for (const theme of APPEARANCE_THEME_IDS) {
      prefs.writeAppearanceChoice(theme);
      for (const brightness of ["light", "dark"]) {
        prefs.writeThemeChoice(brightness);
        assert.equal(document.documentElement.dataset.appearance, theme);
        assert.equal(document.documentElement.dataset.theme, brightness);
        assert.equal(document.documentElement.style.colorScheme, brightness);
      }
    }
    prefs.writeThemeChoice("auto");
    osLight = true;
    prefs.applyTheme();
    assert.equal(document.documentElement.dataset.theme, "light");
    osLight = false;
    prefs.applyTheme();
    assert.equal(document.documentElement.dataset.theme, "dark");
  });
  test("artwork follows the theme and clears every optional slot on switch", () => {
    prefs.writeAppearanceChoice("woodland");
    assert.ok(properties.get(THEME_ART_SLOTS.frame).includes("ivy-oak-frame"));
    assert.equal(document.documentElement.dataset.themeOrnaments, "true");
    for (const theme of APPEARANCE_THEME_IDS) {
      prefs.writeAppearanceChoice(theme);
      // Each brightness writes its own set over the other's, slot by slot.
      for (const brightness of ["light", "dark", "light", "dark"]) {
        prefs.writeThemeChoice(brightness);
        for (const [key,value] of Object.entries(themeArtStyle(theme, brightness))) assert.equal(properties.get(key), value, `${theme}/${brightness}: ${key}`);
        const art = themeArt(theme, brightness);
        assert.equal(document.documentElement.dataset.themeOrnaments, String(Boolean(art?.frame || art?.corner)));
      }
      assert.equal(document.documentElement.dataset.themeBase, appearanceDefinition(theme).baseStyle ?? "plain");
    }
    // Following the system: the set follows the OS brightness as it changes.
    prefs.writeThemeChoice("auto");
    for (const light of [true, false]) {
      osLight = light;
      prefs.applyTheme();
      for (const [key,value] of Object.entries(themeArtStyle(APPEARANCE_THEME_IDS.at(-1), light ? "light" : "dark"))) assert.equal(properties.get(key), value);
    }
    assert.equal(document.documentElement.dataset.themeOrnaments, "true");
    const empty = artSlotStyle();
    for (const key of Object.values(THEME_ART_SLOTS)) assert.equal(empty[key], "none");
    const partial = artSlotStyle({ frame: "/assets/example-frame.webp" });
    assert.equal(partial[THEME_ART_SLOTS.corner], "none", "A partial theme must clear inherited corners");
    assert.equal(partial[THEME_ART_SLOTS.texture], "none", "A partial theme must clear inherited material");
    assert.equal(partial[THEME_ART_SLOTS.frame], 'url("/assets/example-frame.webp")');
  });
  test("following the campaign clears a personal override", () => {
    prefs.writeAppearanceChoice("campaign");
    assert.equal(storage.has("odm.appearance"), false);
    assert.equal(prefs.readAppearanceChoice(), "campaign");
    assert.equal(document.documentElement.dataset.appearance, "arcane");
  });
  test("blocked storage still permits changing theme, brightness and scale", () => {
    window.localStorage.setItem = () => { throw new Error("Storage blocked"); };
    prefs.writeAppearanceChoice("gothic");
    prefs.writeThemeChoice("light");
    prefs.writeUiScale(1.2);
    assert.equal(document.documentElement.dataset.appearance, "gothic");
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.equal(document.documentElement.style.fontSize, "120%");
  });
} finally {
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
}
// A French table read the whole theme panel in English: every theme's name
// and look, and every line of the picker, has its French entry.
{
  const { themeName, themeDescription } = await import("../src/lib/appearance-themes.ts");
  const { translate } = await import("../src/lib/i18n/translate.ts");
  await import("../src/lib/i18n/fr-catalog.ts");
  const fr = (key, vars) => translate("fr", key, vars);
  const en = (key, vars) => translate("en", key, vars);
  test("every theme reads its name and look in French, and in English as the catalog says", () => {
    for (const entry of APPEARANCE_THEMES) {
      assert.equal(themeName(en, entry), entry.name);
      assert.notEqual(themeName(fr, entry), entry.name === "Inferno" ? "" : entry.name, `${entry.id} has a French name`);
      assert.notEqual(themeDescription(fr, entry), entry.description, `${entry.id} has a French description`);
    }
  });
  test("every line the theme panel and its picker say has its French entry", () => {
    const catalog = JSON.parse(readFileSync(new URL("../src/lib/i18n/fr.json", import.meta.url), "utf8"));
    for (const file of ["../src/components/AppearancePicker.tsx", "../src/components/ThemePanel.tsx", "../src/components/ThemePanelHost.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const [, key] of source.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) {
        assert.ok(catalog.messages[key] ?? catalog.contexts[key], `${file}: "${key}" has no French`);
      }
    }
  });
}
console.log(`${passed} appearance checks passed.`);
