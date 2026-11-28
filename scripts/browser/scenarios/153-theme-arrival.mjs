// A theme arrives its own way (src/lib/theme-arrival): a pick in the theme
// panel, or a theme the GM gives the table, spreads over the old look as a
// rune circle, frost, a turned page and so on, instead of cutting over. The
// browser's View Transitions keep a picture of the old page under the new
// one, the new one is cut to the arrival's shape frame by frame, and a
// canvas above both paints its edge. None of that shows in a unit suite, and
// the apps differ in the two ways that matter: they take the document's
// transition name away (their page changes fade the page column alone), and
// they confine the game's stylesheet to that column. So here, on the website
// and on the apps' own screens:
//
// - a pick plays that theme's arrival: the page is marked with it, the new
//   look is laid as the old page's picture is taken, the new page's picture
//   is cut by a path, and the canvas has paint on it;
// - while one plays the browser draws pictures of the page and the page takes
//   no press, so a press ends the arrival and is handed on: a second pick
//   made over the first one lands, and ends on the theme picked last;
// - day and night arrive the same way;
// - a reader who asks for less motion gets a plain fade and no canvas;
// - a theme given to the table while the reader sits there arrives too, and
//   sitting down at a table that already has one lays it at once;
// - Settings' own picker plays it: the account page on the website, and in
//   the apps the shell's Settings, which is drawn outside the game's screens.
import { check, eventually } from "../lib.mjs";

const look = (page) => page.evaluate(() => ({ appearance: document.documentElement.dataset.appearance, theme: document.documentElement.dataset.theme, mark: document.documentElement.dataset.themeArrival ?? null }));

// Records every arrival the page is marked with from here on. As a page's
// first script it runs before the document has its <html>, and waits for it.
const watch = () => {
  if (window.odmArrivalsSeen) return;
  window.odmArrivalsSeen = [];
  const start = () => new MutationObserver(() => {
    const mark = document.documentElement.dataset.themeArrival;
    if (mark) window.odmArrivalsSeen.push(mark);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-arrival"] });
  if (document.documentElement) start();
  else new MutationObserver((_, waiting) => {
    if (!document.documentElement) return;
    waiting.disconnect();
    start();
  }).observe(document, { childList: true });
};
const seen = (page) => page.evaluate(() => window.odmArrivalsSeen.splice(0));

// Waits for the arrival's own animation (it holds the new page's cut), stops
// it at a point of its length, and says what is on screen there.
const holdAt = (page, part) => page.evaluate(async (at) => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const all = () => document.getAnimations().filter((animation) => animation.effect?.pseudoElement === "::view-transition-new(root)");
  const cutting = () => all()[0];
  const until = performance.now() + 8000;
  while (!cutting() && performance.now() < until) await frame();
  const animation = cutting();
  if (!animation) return { found: false, mark: document.documentElement.dataset.themeArrival ?? null };
  animation.pause();
  animation.currentTime = animation.effect.getTiming().duration * at;
  await frame();
  await frame();
  const canvas = document.querySelector("canvas[data-theme-arrival-fx]");
  let painted = 0;
  if (canvas?.width) {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]) painted += 1;
  }
  const cut = getComputedStyle(document.documentElement, "::view-transition-new(root)");
  return {
    found: true,
    mark: document.documentElement.dataset.themeArrival ?? null,
    appearance: document.documentElement.dataset.appearance,
    clip: cut.clipPath.slice(0, 12),
    opacity: cut.opacity,
    canvas: Boolean(canvas),
    painted,
    animations: all().length,
  };
}, part);
const resume = (page) => page.evaluate(() => document.getAnimations().find((animation) => animation.effect?.pseudoElement === "::view-transition-new(root)")?.play());
const settled = (page, appearance) => eventually(async () => {
  const now = await page.evaluate(() => ({ ...document.documentElement.dataset, canvases: document.querySelectorAll("canvas[data-theme-arrival-fx]").length }));
  return now.appearance === appearance && now.themeArrival === undefined && now.canvases === 0;
}, { timeoutMs: 20_000, label: `${appearance} laid, with no arrival still marked and no canvas left` });

export default {
  name: "theme-arrival",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, app } = t;
    if (!(await page.evaluate(() => typeof document.startViewTransition === "function"))) return;
    const clear = () => page.evaluate(() => {
      window.localStorage.removeItem("odm.appearance");
      window.localStorage.setItem("odm.theme", "dark");
    }).catch(() => undefined);
    await clear();
    await page.addInitScript(watch);
    await t.open(`/campaigns/${ids.lobbyId}`);
    await page.evaluate(watch);
    const button = page.locator(`${root}[data-theme-button]`).locator("visible=true").first();
    await eventually(() => button.count(), { timeoutMs: 30_000, label: "the lobby's Theme button" });
    await t.tap(button);
    const panel = page.locator(".theme-panel").locator("visible=true");
    await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the theme panel" });
    await panel.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    await settled(page, "arcane");
    await seen(page);
    const card = async (name) => {
      const option = panel.locator("button.appearance-option", { hasText: name });
      if (!(await option.count())) await t.tap(panel.getByRole("button", { name: /^Show all \d+ themes$/ }));
      await option.scrollIntoViewIfNeeded();
      return option;
    };

    // A pick plays the theme's own arrival.
    await t.tap(await card("Frostbound"));
    const frost = await holdAt(page, 0.5);
    check(frost.found, `picking Frostbound played no arrival (the page is marked ${frost.mark})`);
    check(frost.mark === "frost", `Frostbound arrives by frost, and the page is marked ${frost.mark}`);
    check(frost.appearance === "frost", `the new look is laid under the arrival (the page still wears ${frost.appearance})`);
    check(frost.clip.startsWith("path("), `half way, the new page is cut by the arrival's shape (${frost.clip})`);
    check(frost.canvas && frost.painted > 0, `the arrival's canvas has nothing painted on it (${frost.painted} pixels)`);
    check(frost.animations === 1, `one animation holds the new page's cut, not ${frost.animations}`);
    await t.shot("frost-half");

    // A press over the held arrival ends it and reaches the card under it.
    // Pressed as a finger or a mouse would, at a point: a locator's own press
    // waits for the card to be what the point hits, and under an arrival that
    // is <html>.
    const tide = await card("Sunken Tide");
    const at = await tide.boundingBox();
    if (t.touch && t.app) await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
    else await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    const wave = await holdAt(page, 0.45);
    check(wave.found && wave.mark === "tide", `a pick made over an arrival did not land (marked ${wave.mark}, wearing ${wave.appearance})`);
    check(wave.animations === 1, `the arrival that was pressed away left its animation on the next one's page (${wave.animations})`);
    await t.shot("tide-half");
    await resume(page);
    await settled(page, "tide");
    const marks = (await seen(page)).join();
    check(marks === "frost,tide", `two picks should mark the page with frost, then tide (${marks})`);

    // High Kingdoms hides the page's own background canvas, and the arrival's
    // canvas was hidden with it: the page turned with no page drawn.
    await t.tap(await card("High Kingdoms"));
    const turned = await holdAt(page, 0.4);
    check(turned.found && turned.mark === "page", `High Kingdoms arrives as a turned page (marked ${turned.mark})`);
    check(turned.canvas && turned.painted > 0, `the turned page is not painted (${turned.painted} pixels)`);
    await t.shot("page-turning");
    await resume(page);
    await settled(page, "kingdoms");
    await t.tap(await card("Sunken Tide"));
    await settled(page, "tide");
    await seen(page);

    // Day and night arrive the same way.
    await t.tap(panel.getByRole("button", { name: "Light", exact: true }));
    const day = await holdAt(page, 0.6);
    check(day.found && day.mark === "tide", `turning to day played no arrival (marked ${day.mark})`);
    await resume(page);
    await settled(page, "tide");
    check((await look(page)).theme === "light", "the day brightness was not laid");
    await t.tap(panel.getByRole("button", { name: "Dark", exact: true }));
    await settled(page, "tide");
    await seen(page);

    // Less motion: a plain fade, and nothing painted.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await t.tap(await card("Inferno"));
    const calm = await holdAt(page, 0.5);
    check(calm.found && calm.mark === "fade", `with less motion asked for, a pick should fade (marked ${calm.mark})`);
    check(!calm.canvas && calm.clip === "none" && calm.animations === 1 && Number(calm.opacity) > 0 && Number(calm.opacity) < 1, `the fade cuts or paints (${JSON.stringify(calm)})`);
    await resume(page);
    await settled(page, "inferno");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Back to the table's own theme, then the GM gives the table another.
    await t.tap(panel.locator("button.appearance-follow"));
    await settled(page, "arcane");
    await page.keyboard.press("Escape");
    await seen(page);
    const saved = await api.patch(`${base}/api/campaigns/${ids.lobbyId}/settings`, { data: { appearanceTheme: "gothic" } });
    check(saved.ok(), `the table's theme was not saved (${saved.status()})`);
    try {
      await settled(page, "gothic");
      const given = (await seen(page)).join();
      check(given === "pour", `a theme given to the table while the reader sits there should arrive its own way: Gothic pours (${given})`);

      // Sitting down at a table that already has a theme lays it at once.
      await t.open("/");
      await settled(page, "arcane");
      await seen(page);
      await t.open(`/campaigns/${ids.lobbyId}`);
      await settled(page, "gothic");
      const onEntry = (await seen(page)).join();
      check(onEntry === "", `opening a table played an arrival (${onEntry}): its theme should be laid with the page`);
    } finally {
      await api.patch(`${base}/api/campaigns/${ids.lobbyId}/settings`, { data: { appearanceTheme: "genre" } });
    }
    await settled(page, "arcane");

    // Settings' own picker.
    let picker;
    if (app) {
      await page.evaluate(() => window.odmShell.openSettings());
      picker = page.locator(".device-settings .appearance-picker").locator("visible=true").first();
    } else {
      await t.open("/settings");
      picker = page.locator(".appearance-picker").locator("visible=true").first();
    }
    await eventually(() => picker.count(), { timeoutMs: 30_000, label: "Settings' theme picker" });
    await seen(page);
    const hearth = picker.locator("button.appearance-option", { hasText: "Hearth & Haven" });
    await hearth.scrollIntoViewIfNeeded();
    await t.tap(hearth);
    const burning = await holdAt(page, 0.5);
    check(burning.found && burning.mark === "burn", `a pick in Settings played no arrival (marked ${burning.mark})`);
    check(burning.canvas && burning.painted > 0, `Settings' arrival is not painted (${burning.painted} pixels)`);
    await t.shot("settings-burning");
    await resume(page);
    await settled(page, "hearth");
    await clear();
    await page.evaluate(() => window.localStorage.removeItem("odm.theme"));
  },
};
