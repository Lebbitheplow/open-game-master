// Issue 743: a fight the story set inside a building on an outdoor place was
// drawn on open ground. The seed's table opened with the hero in a house and
// two goblins in the yard to the east: its walls, door and windows stand on the
// board with every token on it. The GM console asks the same thing as the
// tool: the side first, then how many ways in, shown only once there is a
// building, each a target a finger can reach.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "fight-in-building",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.fightInBuilding[viewport]}`);
    const board = page.locator(`${root}[aria-label^="Board view"]`).locator("visible=true").first();
    if (!(await board.count())) {
      // On a phone the board sits under the Battle tab of the bottom bar.
      await t.tap(page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: /battle/i }).first());
    }
    await eventually(() => board.count(), { timeoutMs: 30_000, label: "the board" });
    await eventually(async () => (await board.locator("[data-token-id]").count()) === 3, { timeoutMs: 30_000, label: "three tokens on the board" });
    // The fight's title card plays over the board as the table opens; the
    // picture is of the board.
    await eventually(() => page.locator(".announce").count().then((n) => n === 0), { timeoutMs: 30_000, label: "the title card leaving" });
    await untilStill(page);
    await t.shot("board");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("board-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    await openPanelTab(t, "dm");
    const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^combat$/i }).locator("visible=true").first();
    await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's Combat tab" });
    await t.tap(tab);
    const open = page.getByRole("button", { name: /^Start a fight\b/ }).locator("visible=true").first();
    await eventually(() => open.count(), { label: "the console's Start a fight" });
    await t.tap(open);
    await untilStill(page);

    const side = page.getByRole("button", { name: "Party inside a building, enemies to the", exact: true }).locator("visible=true").first();
    await eventually(() => side.count(), { label: "the building's side picker" });
    const ways = page.getByRole("button", { name: "Ways in", exact: true }).locator("visible=true");
    check((await ways.count()) === 0, "Ways in shows with no building to have them");
    await side.scrollIntoViewIfNeeded();
    await t.tap(side);
    const east = page.getByRole("menuitemradio", { name: "East" }).locator("visible=true").first();
    await eventually(() => east.count(), { label: "East under the side picker" });
    await t.tap(east);
    await untilStill(page);
    await eventually(() => ways.count(), { label: "Ways in, once there is a building" });
    if (viewport === "phone") {
      for (const [label, control] of [["The side picker", side], ["Ways in", ways.first()]]) {
        const box = await control.boundingBox();
        check(Boolean(box && box.height >= 39.5), `${label} is a target a finger can reach (${box?.height}px)`);
      }
    }
    await t.tap(ways.first());
    const two = page.getByRole("menuitemradio", { name: "A door and two windows" }).locator("visible=true").first();
    await eventually(() => two.count(), { label: "two windows under Ways in" });
    await t.tap(two);
    await untilStill(page);
    await ways.first().scrollIntoViewIfNeeded();
    await t.shot("console");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("console-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
  },
};
