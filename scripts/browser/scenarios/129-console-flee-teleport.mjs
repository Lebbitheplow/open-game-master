// The GM console's "An enemy flees" asks whether it teleports away. A creature
// that runs draws the opportunity attacks of whoever has it in reach, and one
// that teleports draws none (SRD 5.1), which the engine cannot tell apart on
// its own. The box is labelled, off by default, explained in a line under it,
// a target a finger can reach at phone width, and legible in the night and
// day themes. The seed's Enemy Turn Table, which the signed-in player runs;
// nothing is sent, so the fight is left as it was for the scenarios after.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "console-flee-teleport",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.enemyTurns[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^combat$/i }).locator("visible=true").first();
    await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's Combat tab" });
    await t.tap(tab);
    const open = page.getByRole("button", { name: /^An enemy flees\b/ }).locator("visible=true").first();
    await eventually(() => open.count(), { label: "the console's An enemy flees" });
    await t.tap(open);
    await untilStill(page);

    const box = page.getByLabel("Teleports away", { exact: true }).locator("visible=true").first();
    await eventually(() => box.count(), { label: "Teleports away, labelled" });
    const on = await box.evaluate((node) => node.getAttribute("aria-checked") === "true" || node.checked === true);
    check(!on, "Teleports away starts on: a creature that runs would draw no opportunity attack");
    await eventually(() => page.getByText(/nobody gets an opportunity attack as it goes/).locator("visible=true").count(), { label: "the line that says what the box does" });
    if (viewport === "phone") {
      // The kit's switch draws a 24px track and takes a press from 8px above
      // and below it on a touch screen (globals.css .kit-switch::before).
      const press = await box.evaluate((node) => parseFloat(getComputedStyle(node, "::before").height));
      check(press >= 39.5, `Teleports away is a target a finger can reach (${press}px)`);
    }
    await box.focus();
    await t.shot("flee-teleport");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("flee-teleport-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
  },
};
