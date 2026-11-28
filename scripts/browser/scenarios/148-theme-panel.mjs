// Server PR 1071: the theme picker is a panel beside the page, opened from
// the lobby's Theme button, and a theme may paint other artwork by day. The
// panel's host is laid by the server's root layout, which the apps never
// load: until the client's game root laid it too, the lobby's Theme button
// set the panel open and nothing drew it (client carry-1122). Here, on the
// website and on the apps' own screens:
//
// - the lobby's Theme button opens a panel that neither dims nor covers the
//   page (the right side of a desk, a sheet at the foot of a phone), takes
//   focus, and has 40px targets;
// - a pick restyles the page at once, and Unquiet Depths by day lays its day
//   artwork on <html>, its night artwork by night;
// - Escape closes it and focus goes back to the Theme button;
// - Settings' own picker (the account page; in the apps the shell's Settings,
//   which draws the server's picker outside the game screens) changes the
//   theme and the brightness, and the shell's chrome follows;
// - every preview, in the panel and in Settings, shows its theme's frame and
//   grain. The apps' Settings draws the picker with no host connected, and
//   nothing sent the previews' "/assets/themes/..." addresses to the app's
//   own copies there: each one asked the app's origin, got nothing, and
//   stood as a bare box beside the website's bordered ones.
import { check, eventually } from "../lib.mjs";

const appearanceOf = (page) => page.evaluate(() => document.documentElement.dataset.appearance);
const brightnessOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const textureOf = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--theme-art-texture"));

// The pictures a picker's previews are painted with that the page cannot
// load: the frame (a border image) and the grain under it. A picture is
// loaded by its address as the stylesheet resolved it, through the attribute
// so the app's own src setter does not stand in for the page.
const missingPreviewArt = (picker) => picker.evaluate(async (node) => {
  const loads = (address) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.setAttribute("src", address);
  });
  const missing = [];
  const previews = [...node.querySelectorAll('.appearance-preview[data-theme-ornaments="true"]')];
  for (const preview of previews) {
    const frame = preview.querySelector(".appearance-preview-frame");
    const painted = { frame: getComputedStyle(frame).borderImageSource, grain: getComputedStyle(preview).backgroundImage };
    for (const [part, value] of Object.entries(painted)) {
      const addresses = [...value.matchAll(/url\("?([^")]+)"?\)/g)].map((match) => match[1]);
      if (!addresses.length) missing.push(`${preview.dataset.appearance}: no ${part}`);
      for (const address of addresses) if (!(await loads(address))) missing.push(`${preview.dataset.appearance}: ${part} ${address}`);
    }
  }
  return { previews: previews.length, missing };
});

export default {
  name: "theme-panel",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, app, viewport } = t;
    await page.evaluate(() => {
      window.localStorage.removeItem("odm.appearance");
      window.localStorage.setItem("odm.theme", "dark");
    }).catch(() => undefined);
    await t.open(`/campaigns/${ids.lobbyId}`);
    const button = page.locator(`${root}[data-theme-button]`).locator("visible=true").first();
    await eventually(() => button.count(), { timeoutMs: 30_000, label: "the lobby's Theme button" });
    const buttonBox = await button.boundingBox();
    check(buttonBox && Math.round(buttonBox.height) >= 40, `the Theme button is a finger-sized target (${buttonBox?.height}px)`);

    await t.tap(button);
    const panel = page.locator(".theme-panel").locator("visible=true");
    await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the theme panel, opened from the lobby" });
    // Measured once the panel has finished opening: a Radix dialog scales in
    // from 0.96 (globals.css), and a slow runner caught the 40px Close at 38
    // and the phone's sheet at 96% of the screen's width.
    await panel.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    check((await button.getAttribute("aria-expanded")) === "true", "the Theme button does not say its panel is open");
    check((await panel.getAttribute("role")) === "dialog", "the panel is not named as a dialog");
    check(/theme/i.test((await panel.getAttribute("aria-labelledby").then((id) => (id ? page.locator(`[id="${id}"]`).innerText() : ""))) ?? ""), "the panel has no title");
    if (app) check(await panel.evaluate((node) => Boolean(node.closest(".game-root"))), "the app's panel is drawn outside the game root, where its styles do not reach");
    const box = await panel.boundingBox();
    const size = page.viewportSize();
    if (viewport === "phone") {
      check(box && Math.round(box.y + box.height) >= size.height - 2 && box.y > size.height * 0.3, `the phone's panel is not a sheet at the foot of the screen (${JSON.stringify(box)})`);
    } else {
      check(box && box.x >= size.width / 2 && box.width <= size.width / 2, `the desk's panel does not sit at the right (${JSON.stringify(box)})`);
    }
    // Nothing dims the page: the point at the far left is the page, not a layer.
    const covered = await page.evaluate(() => {
      const hit = document.elementFromPoint(8, Math.round(window.innerHeight * 0.2));
      return Boolean(hit?.closest("[data-radix-dialog-overlay], [data-state='open'][style*='pointer-events']")) || getComputedStyle(document.body).pointerEvents === "none";
    });
    check(!covered, "the page behind the theme panel is dimmed or blocked");
    await eventually(() => panel.evaluate((node) => node.contains(document.activeElement)), { label: "focus inside the opened panel" });

    // Every control in the panel is at least 40px tall.
    const small = await panel.evaluate((node) => [...node.querySelectorAll("button")]
      .filter((control) => control.getClientRects().length)
      .map((control) => ({ name: (control.getAttribute("aria-label") || control.innerText).trim().slice(0, 30), height: Math.round(control.getBoundingClientRect().height) }))
      .filter((control) => control.height < 40));
    check(small.length === 0, `controls under 40px in the theme panel: ${JSON.stringify(small)}`);

    // A pick restyles the page at once, and the panel stays open beside it.
    // The lobby's table is high fantasy, and once enough themes suit a genre
    // the panel opens on that shortlist, which leaves Unquiet Depths out: the
    // whole catalog is one button away.
    const depths = panel.locator("button.appearance-option", { hasText: "Unquiet Depths" });
    if (!(await depths.count())) {
      const showAll = panel.getByRole("button", { name: /^Show all \d+ themes$/ });
      check(await showAll.count(), "Unquiet Depths is not offered, and the panel has no way to show every theme");
      await t.tap(showAll);
      await eventually(() => depths.count(), { label: "Unquiet Depths in the whole catalog" });
    }
    await depths.scrollIntoViewIfNeeded();
    await t.tap(depths);
    await eventually(async () => (await appearanceOf(page)) === "depths", { label: "Unquiet Depths on the page" });
    check(/wet-stone/.test(await textureOf(page)), `Unquiet Depths by night lays its night texture (${await textureOf(page)})`);
    check(await panel.count(), "a pick closed the theme panel");
    await t.shot("depths-night");

    // By day it lays the day set, the panel's previews included.
    await t.tap(panel.getByRole("button", { name: "Light", exact: true }));
    await eventually(async () => (await brightnessOf(page)) === "light", { label: "the light brightness" });
    await eventually(async () => /manila-card/.test(await textureOf(page)), { label: "Unquiet Depths' day texture on <html>" });
    const preview = await panel.locator('.appearance-preview[data-appearance="depths"]').evaluate((node) => node.style.getPropertyValue("--theme-art-texture"));
    check(/manila-card/.test(preview), `the panel's Unquiet Depths preview shows night art by day (${preview})`);
    const panelArt = await missingPreviewArt(panel);
    check(panelArt.previews > 0 && panelArt.missing.length === 0, `the panel's previews miss their artwork (${panelArt.previews} previews): ${panelArt.missing.join("; ")}`);
    await t.shot("depths-day");

    // Escape closes it, and focus goes back to the button that opened it.
    await page.keyboard.press("Escape");
    await eventually(async () => (await panel.count()) === 0, { label: "the panel closed by Escape" });
    await eventually(() => button.evaluate((node) => node === document.activeElement), { label: "focus back on the Theme button" });
    check((await button.getAttribute("aria-expanded")) === "false", "the Theme button still says its panel is open");

    // Settings' own picker.
    let picker;
    if (app) {
      // The shell's own Settings (an overlay over the game), opened by the
      // door the host's pages use (window.odmShell.openSettings).
      await page.evaluate(() => window.odmShell.openSettings());
      picker = page.locator(".device-settings .appearance-picker").locator("visible=true").first();
    } else {
      await t.open("/settings");
      picker = page.locator(".appearance-picker").locator("visible=true").first();
    }
    await eventually(() => picker.count(), { timeoutMs: 30_000, label: "Settings' theme picker" });
    const settingsArt = await missingPreviewArt(picker);
    check(settingsArt.previews > 0 && settingsArt.missing.length === 0, `Settings' previews miss their artwork (${settingsArt.previews} previews): ${settingsArt.missing.join("; ")}`);
    await t.shot("settings-open");
    const inferno = picker.locator("button.appearance-option", { hasText: "Inferno" });
    await inferno.scrollIntoViewIfNeeded();
    await t.tap(inferno);
    await eventually(async () => (await appearanceOf(page)) === "inferno", { label: "Inferno from Settings" });
    check((await inferno.getAttribute("aria-pressed")) === "true", "Settings' Inferno card is not marked as chosen");
    await t.tap(picker.getByRole("button", { name: "Dark", exact: true }));
    await eventually(async () => (await brightnessOf(page)) === "dark", { label: "the dark brightness from Settings" });
    if (app) {
      // The shell's own chrome reads the theme's tokens (themes.css).
      const night = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--theme-night-stone-950").trim());
      check(night !== "", "the shell's chrome has no Inferno tokens");
    }
    await t.shot("settings-inferno");
    if (app) {
      // The same card from the app's own home, with no host connected: the
      // way most people reach it, and where the previews stood bare. Over a
      // world (above) the world's own watch had already sent their artwork to
      // the app's copies.
      await page.evaluate(() => window.odmShell.showServers());
      const gear = page.getByRole("button", { name: "Settings", exact: true }).locator("visible=true").first();
      await eventually(() => gear.count(), { timeoutMs: 30_000, label: "the Settings button on the app's home" });
      await t.tap(gear);
      const homePicker = page.locator(".device-settings .appearance-picker").locator("visible=true").first();
      await eventually(() => homePicker.count(), { timeoutMs: 30_000, label: "the theme picker in Settings, opened from the app's home" });
      check((await page.locator(".game-root:not(.device-settings)").count()) === 0, "the app's home still holds a world's screens");
      const homeArt = await missingPreviewArt(homePicker);
      check(homeArt.previews > 0 && homeArt.missing.length === 0, `with no host connected, Settings' previews miss their artwork (${homeArt.previews} previews): ${homeArt.missing.join("; ")}`);
      await homePicker.locator(".appearance-grid").scrollIntoViewIfNeeded();
      await t.shot("settings-from-home");
    }
    await page.evaluate(() => {
      window.localStorage.removeItem("odm.appearance");
      window.localStorage.removeItem("odm.theme");
    });
  },
};
