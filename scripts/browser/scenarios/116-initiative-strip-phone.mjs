// A long opening (issue 741) can stand enemies in the board's top left
// corner, and at phone width the initiative strip was drawn over those tiles:
// goblins hid under it, and a tap on one opened the order instead. Below the
// docked layout the strip now has a row of its own above the board, on the
// panel and on the enlarged tabletop. The docked layout keeps it where it was.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

// Under the old strip at 412 px wide: its round label, then its plates.
const CORNER = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 3 }];

export default {
  name: "initiative-strip-phone",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const { id: campaignId, goblin } = ids.directed[viewport];
    const token = async () => {
      const response = await api.get(`${base}/api/campaigns/${campaignId}/battle-map`);
      const body = response.ok() ? await response.json() : {};
      return (body.view?.tokens ?? []).find((entry) => entry.refId === goblin) ?? null;
    };
    const columns = async () => {
      const response = await api.get(`${base}/api/campaigns/${campaignId}/battle-map`);
      return (await response.json()).view.width;
    };
    const moveTo = async ({ x, y }) => {
      const { id } = await token();
      const moved = await api.post(`${base}/api/campaigns/${campaignId}/dm/invoke`, {
        data: { name: "move_token", args: { token: id, x, y, teleport: true } },
      });
      check(moved.ok(), `the goblin moved to ${x},${y} (${moved.status()})`);
      await eventually(async () => {
        const now = await token();
        return now?.x === x && now?.y === y;
      }, { label: `the goblin on ${x},${y}` });
    };
    // The first thing under the middle of the figure is the figure's own, so
    // the eye sees it and a tap lands on it.
    const onTop = (figure) => figure.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return Boolean(hit && node.contains(hit));
    });
    const walkTheCorner = async (frame, label) => {
      const figure = frame.getByRole("img", { name: /^Goblin/ }).first();
      const width = await columns();
      for (const tile of CORNER) {
        await moveTo(tile);
        await eventually(() => figure.evaluate((node, at) => {
          const tile = node.ownerSVGElement.viewBox.baseVal.width / at.columns;
          return node.style.transform === `translate(${at.x * tile}px, ${at.y * tile}px)`;
        }, { ...tile, columns: width }), { timeoutMs: 15_000, label: `the goblin drawn on ${tile.x},${tile.y} (${label})` });
        await untilStill(page);
        check(await onTop(figure), `the goblin on ${tile.x},${tile.y} is on top where it stands (${label})`);
      }
      return figure;
    };

    const start = await token();
    check(start, "the goblin's token on the board");
    try {
      await t.open(`/campaigns/${campaignId}`);
      await openPanelTab(t, "battle");
      const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
      const frame = board.locator(".board-view").first();
      await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the DM's board" });
      const strip = board.getByRole("button", { name: /open the order/i }).first();
      await eventually(() => strip.isVisible(), { label: "the initiative strip" });

      if (viewport === "desktop") {
        // Docked, it stays where it was: in the board view's top left corner,
        // beside the board in the margin the fit leaves.
        const [plates, field] = [await strip.boundingBox(), await frame.boundingBox()];
        check(await strip.evaluate((node) => Boolean(node.closest(".board-view"))), "the docked strip stands in the board view");
        check(plates.x - field.x < 24 && plates.y - field.y < 24, `the docked strip is in the board's corner (${plates.x - field.x}, ${plates.y - field.y})`);
        await walkTheCorner(frame, "the docked board");
        await t.shot("docked");
        return;
      }

      const figure = await walkTheCorner(frame, "the panel");
      const [plates, field] = [await strip.boundingBox(), await frame.boundingBox()];
      check(plates.y + plates.height <= field.y, `the strip ends above the board (${plates.y + plates.height} against ${field.y})`);
      check(plates.height >= 40, `the strip is finger sized (${plates.height}px)`);
      await t.shot("corner");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("corner-light");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // A phone on its side has the least height to give the row.
      await page.setViewportSize({ width: 892, height: 412 });
      await untilStill(page);
      check(await onTop(figure), "the corner goblin is on top with the phone on its side");
      const sideways = await strip.boundingBox();
      check(sideways.height <= 44, `the strip keeps to one small row with the phone on its side (${sideways.height}px)`);
      await t.shot("corner-sideways");
      await page.setViewportSize({ width: 412, height: 892 });
      await untilStill(page);

      // A tap on the corner goblin opens its menu, not the order.
      await t.tap(figure);
      const menu = board.getByRole("menu", { name: /^Actions for Goblin/ });
      await eventually(() => menu.count(), { label: "the corner goblin's menu" });
      await untilStill(page);
      await t.shot("corner-menu");
      await t.tap(menu.getByLabel("Close", { exact: true }));
      await eventually(async () => (await menu.count()) === 0, { label: "the goblin's menu closed" });

      // The strip still opens the order from its new place.
      await t.tap(strip);
      const order = page.getByRole("dialog").locator("visible=true").first();
      await eventually(() => order.isVisible(), { label: "the initiative order" });
      await page.keyboard.press("Escape");
      await eventually(async () => !(await order.isVisible().catch(() => false)), { label: "the order closed" });

      // The enlarged tabletop has the same corner.
      await t.tap(page.locator(`${root}[aria-label="Enlarge battle map"]`).locator("visible=true").first());
      const tabletop = page.locator(".cine-tabletop");
      const tableFrame = tabletop.locator(".board-view").first();
      await eventually(() => tableFrame.isVisible(), { label: "the enlarged board" });
      await walkTheCorner(tableFrame, "the enlarged board");
      const tableStrip = tabletop.getByRole("button", { name: /open the order/i }).first();
      check(!(await tableStrip.evaluate((node) => Boolean(node.closest(".board-view")))), "the enlarged board's strip stands off the board");
      await t.shot("enlarged-corner");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("enlarged-corner-light");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      await t.tap(page.locator(".cine-tabletop-close").first());
    } finally {
      // The same goblin plays directed-token-menu, clear of the docked strip.
      await moveTo(start);
    }
  },
};
