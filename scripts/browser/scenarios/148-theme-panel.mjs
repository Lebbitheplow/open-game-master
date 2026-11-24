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
//   theme and the brightness, and the shell's chrome follows.
import { check, eventually } from "../lib.mjs";

const appearanceOf = (page) => page.evaluate(() => document.documentElement.dataset.appearance);
const brightnessOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const textureOf = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--theme-art-texture"));

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
    check(buttonBox && buttonBox.height >= 40, `the Theme button is a finger-sized target (${buttonBox?.height}px)`);

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
    await page.evaluate(() => {
      window.localStorage.removeItem("odm.appearance");
      window.localStorage.removeItem("odm.theme");
    });
  },
};
