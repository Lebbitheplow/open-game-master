// Issue 741: a fight opened from farther off than the board holds threw after
// its map was written, and the table played on a black board with no tokens.
// Two hundred feet now opens with the hero and both goblins standing on it.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "long-opening",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.longOpening[viewport]}`);
    const board = page.locator(`${root}[aria-label^="Board view"]`).locator("visible=true").first();
    if (!(await board.count())) {
      // On a phone the board sits under the Battle tab of the bottom bar.
      await t.tap(page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: /battle/i }).first());
    }
    await eventually(() => board.count(), { timeoutMs: 30_000, label: "the board" });
    const tokens = () => board.locator("[data-token-id]").count();
    await eventually(async () => (await tokens()) === 3, { timeoutMs: 30_000, label: "three tokens on the board" });
    check((await tokens()) === 3, "the hero and both goblins stand on the board");
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
  },
};
