// By day the fight's board frame and the chronicle are parchment with dark
// ink. Their navy was fixed for the night while the frame's controls took the
// day's dark ink from the tokens, so "Round 2" and the Walk button all but
// vanished, and the page's see-through gradient washed out the chronicle. On a
// phone the story's system line kept its pale night ink on the cream too. The
// theme is the player's saved choice, applied as the page loads, and axe reads
// the frame and the chronicle by day. The board stays night in every seat, and
// the enlarged board's table with it.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

// [red, green, blue, alpha] from a computed colour, the first stop of a gradient included.
const read = (locator) => locator.evaluate((node) => {
  const style = getComputedStyle(node);
  // A canvas reads any colour the browser reports: Tailwind's come as oklab, not rgb.
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const parts = (text) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = text;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const firstStop = /(?:rgba?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]+/i.exec(style.backgroundImage)?.[0];
  return { color: parts(style.color), image: firstStop ? parts(firstStop) : null, fill: parts(style.backgroundColor) };
});
const solid = (colour) => colour[3] === 1;
const lit = ([r, g, b]) => {
  const channel = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (one, two) => (Math.max(lit(one), lit(two)) + 0.05) / (Math.min(lit(one), lit(two)) + 0.05);
// A see-through colour over what is behind it.
const over = (top, under) => [0, 1, 2].map((i) => Math.round(top[i] * top[3] + under[i] * (1 - top[3])));

export default {
  name: "day-board",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const bench = ids.bench2[t.viewport].paladin;
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      // What applyTheme does: the app's screens do not reload between pages.
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    await t.open(`/campaigns/${bench.id}`);
    await setTheme("light");
    await t.open(`/campaigns/${bench.id}`);

    if (t.viewport === "phone") {
      const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
      await eventually(() => tab.isVisible(), { timeoutMs: 30_000, label: "the phone's bar" });
      await t.tap(tab);
      const line = page.locator(`${root}.session-sysline`).locator("visible=true").first();
      await eventually(() => line.isVisible(), { timeoutMs: 30_000, label: "the story's system line" });
      await untilStill(page).catch(() => undefined);
      const { color } = await read(line);
      const cream = [244, 239, 228];
      check(ratio(color, cream) >= 4.5, `the system line reads by day (${color} on ${cream})`);
      await t.shot("light");
      // The docked board keeps its dark window too, for the gold labels round a small map.
      await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Battle", exact: true }).locator("visible=true").first());
      const docked = page.locator(`${root}.board-dock .board-view`).locator("visible=true").first();
      await eventually(() => docked.isVisible(), { timeoutMs: 30_000, label: "the docked board" });
      const dockedFill = (await read(docked)).fill;
      check(solid(dockedFill) && lit(dockedFill) < 0.05, `the docked board's window stays dark by day (${dockedFill})`);
      await setTheme("dark");
      return;
    }

    const panel = page.locator(`${root}.cine-board-frame > .board-panel`).locator("visible=true").first();
    const chronicle = page.locator(`${root}.cine-chronicle-page`).locator("visible=true").first();
    await eventually(async () => (await panel.isVisible()) && (await chronicle.isVisible()), { timeoutMs: 30_000, label: "the board and the chronicle" });
    await untilStill(page).catch(() => undefined);

    const framed = (await read(panel)).fill;
    check(solid(framed) && lit(framed) > 0.7, `the panel is solid parchment by day (${framed})`);
    // The board's own window stays night: its gold labels sit on what shows round a small map.
    const windowFill = (await read(panel.locator(".board-view").first())).fill;
    check(solid(windowFill) && lit(windowFill) < 0.05, `the board's window stays dark by day (${windowFill})`);
    const leaf = (await read(chronicle)).image;
    check(leaf && solid(leaf) && lit(leaf) > 0.7, `the chronicle is solid parchment by day (${leaf})`);

    const round = panel.locator("h3", { hasText: /^Round \d+/ }).first();
    await eventually(() => round.isVisible(), { label: "the panel's round" });
    const roundInk = (await read(round)).color;
    check(ratio(roundInk, framed) >= 4.5, `the panel's round reads by day (${roundInk} on ${framed})`);
    const walk = await read(panel.getByRole("radio", { name: "Walk" }).or(panel.getByRole("button", { name: "Walk", exact: true })).first());
    const behindWalk = walk.image ?? over(walk.fill, framed);
    check(ratio(walk.color, behindWalk) >= 4.5, `Walk reads by day (${walk.color} on ${behindWalk})`);
    for (const line of [".cine-chronicle-eyebrow", ".cine-chronicle-system", ".cine-chronicle-roll-math", ".cine-chronicle-roll-head"]) {
      const ink = chronicle.locator(line).first();
      if (await ink.count()) {
        const { color } = await read(ink);
        check(ratio(color, leaf) >= 4.5, `${line} reads on the chronicle by day (${color} on ${leaf})`);
      }
    }
    await panel.evaluate((node) => node.setAttribute("data-day", "panel"));
    await chronicle.evaluate((node) => node.setAttribute("data-day", "chronicle"));
    for (const target of ["panel", "chronicle"]) {
      const faults = await axeViolations(page, `[data-day="${target}"]`);
      check(faults.length === 0, `the ${target} passes axe by day: ${JSON.stringify(faults).slice(0, 500)}`);
    }
    await t.shot("light");

    // The enlarged board stands on a night table, and what is under it keeps night ink.
    await t.tap(page.getByRole("button", { name: "Enlarge battle map" }).locator("visible=true").first());
    const close = page.getByRole("button", { name: "Close the board" }).first();
    await eventually(() => close.isVisible(), { timeoutMs: 15_000, label: "the enlarged board" });
    const jump = page.locator(".cine-tabletop").getByRole("radio", { name: "Jump" }).or(page.locator(".cine-tabletop").getByRole("button", { name: "Jump", exact: true })).first();
    await eventually(() => jump.isVisible(), { timeoutMs: 15_000, label: "the move row under the enlarged board" });
    await page.waitForTimeout(1500);
    await untilStill(page).catch(() => undefined);
    const jumpInk = (await read(jump)).color;
    check(lit(jumpInk) > 0.4, `the enlarged board's move row keeps night ink by day (${jumpInk})`);
    await t.shot("enlarged");
    await t.tap(close);
    await setTheme("dark");
  },
};
