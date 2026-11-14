// Preference compatibility and campaign appearance persistence, without live data.
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
register("./lib/register-alias.mjs", import.meta.url);

const { APPEARANCE_THEMES, APPEARANCE_THEME_IDS, THEME_ART_SLOTS, themeArtStyle, campaignAppearance, resolveAppearance } = await import("../src/lib/appearance-themes.ts");
const { gameSettingsSchema, normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const prefs = await import("../src/lib/theme-mode.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");
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
    assert.ok(imports.includes(`@import "./${theme.stylesheet.replace("src/app/", "")}";`), `${theme.id}: import its stylesheet`);
    const assets = Object.values(theme.art ?? {});
    if (!assets.length) continue;
    assert.ok(theme.provenance, `${theme.id}: artwork provenance is required`);
    const provenance = JSON.parse(readFileSync(new URL(`../${theme.provenance}`, import.meta.url), "utf8"));
    for (const asset of assets) {
      assert.match(asset, new RegExp(`^/assets/themes/${theme.id}/[a-zA-Z0-9_-]+\\.(webp|png|svg)$`), "Use versioned local theme assets");
      const file = new URL(`../public${asset}`, import.meta.url);
      assert.ok(existsSync(file), `${asset} exists`);
      assert.ok(statSync(file).size <= 2 * 1024 * 1024, `${asset}: keep each shipped image below 2 MiB`);
      assert.ok(provenance.assets.some(entry => entry.file === asset.split('/').at(-1)), `${asset}: record its source`);
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
    const css = readFileSync(new URL(`../${definition.stylesheet}`, import.meta.url), "utf8");
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
      assert.deepEqual(Object.fromEntries(Object.values(THEME_ART_SLOTS).map(key => [key, properties.get(key)])), themeArtStyle(theme));
    }
    prefs.writeAppearanceChoice("arcane");
    assert.equal(document.documentElement.dataset.themeOrnaments, "false", "Empty ornaments must not widen an unframed layout");
    for (const key of Object.values(THEME_ART_SLOTS)) assert.equal(properties.get(key), "none");
    assert.equal(themeArtStyle("gothic")[THEME_ART_SLOTS.corner], "none", "Nested previews must not inherit Woodland corners");
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
console.log(`${passed} appearance checks passed.`);
