// A long opening (issue 741) can stand enemies in the board's top left
// corner, and at phone width the initiative strip was drawn over those tiles:
// goblins hid under it, and a tap on one opened the order instead. Below the
// docked layout the strip now has a row of its own above the board, on the
// panel and on the enlarged tabletop. The docked layout keeps it where it was.
// A phone on its side has no height for that row: there the strip shares the
// tools' row, or a player's heading, or the enlarged tabletop's head.
import { axeViolations, check, eventually, newContext, openPanelTab, signIn, untilStill } from "../lib.mjs";

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
        // A frame the board fills leaves no margin for the strip: the resting
        // view sits below or beside it, so the goblin on 0,0 is not under it
        // (camera-fit.ts `clear`). Window heights walk the frame's shape
        // through the one where the board's top meets the frame's.
        await moveTo({ x: 0, y: 0 });
        const size = page.viewportSize();
        const figure = frame.getByRole("img", { name: /^Goblin/ }).first();
        const covered = [];
        try {
          for (let height = 800; height <= 1400; height += 50) {
            await page.setViewportSize({ width: 1100, height });
            await untilStill(page);
            const [goblinBox, stripBox] = [await figure.boundingBox(), await strip.boundingBox()];
            if (goblinBox && stripBox && goblinBox.x < stripBox.x + stripBox.width && goblinBox.y < stripBox.y + stripBox.height) covered.push(`1100x${height}`);
          }
          check(covered.length === 0, `the goblin on 0,0 is clear of the docked strip at every window (under it at ${covered.join(", ")})`);
          await t.shot("docked-filled");
        } finally {
          await page.setViewportSize(size);
        }
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
      for (const theme of ["light", "dark"]) {
        await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
        await untilStill(page);
        const problems = await axeViolations(page, `${root}.board-panel .board-order-above`.trim());
        check(problems.length === 0, `the order's row passes axe in the ${theme} theme: ${JSON.stringify(problems)}`);
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // A phone on its side has the least height to give the row.
      await page.setViewportSize({ width: 892, height: 412 });
      await untilStill(page);
      check(await onTop(figure), "the corner goblin is on top with the phone on its side");
      const sideways = await strip.boundingBox();
      check(sideways.height <= 44, `the strip keeps to one small row with the phone on its side (${sideways.height}px)`);
      const tools = await board.locator(".board-tools").first().boundingBox();
      const shared = sideways.y < tools.y + tools.height && tools.y < sideways.y + sideways.height;
      check(shared && sideways.x + sideways.width <= tools.x, `the strip shares the tools' row with the phone on its side (${JSON.stringify({ sideways, tools })})`);
      console.log(`[initiative-strip] the board with the phone on its side: ${Math.round((await frame.boundingBox()).height)}px tall`);
      await t.shot("corner-sideways");
      await t.tap(strip);
      const sidewaysOrder = page.getByRole("dialog").locator("visible=true").first();
      await eventually(() => sidewaysOrder.isVisible(), { label: "the order from the tools' row" });
      await page.keyboard.press("Escape");
      await eventually(async () => !(await sidewaysOrder.isVisible().catch(() => false)), { label: "the order from the tools' row closed" });
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
      await page.setViewportSize({ width: 892, height: 412 });
      await untilStill(page);
      check(await tableStrip.evaluate((node) => Boolean(node.closest(".cine-tabletop-head"))), "with the phone on its side the enlarged board's strip stands in its head");
      check(await onTop(tableFrame.getByRole("img", { name: /^Goblin/ }).first()), "the corner goblin is on top on the enlarged board with the phone on its side");
      await t.shot("enlarged-corner-sideways");
      await page.setViewportSize({ width: 412, height: 892 });
      await untilStill(page);
      await t.tap(page.locator(".cine-tabletop-close").first());

      // A player has no tools' row: on its side the strip shares the heading.
      const seat = await newContext(page.context().browser(), "phone", { app: false });
      try {
        await signIn(seat, base, ids.player, ids.password);
        const player = await seat.newPage();
        await player.setViewportSize({ width: 892, height: 412 });
        await player.goto(`${base}/campaigns/${campaignId}`, { waitUntil: "networkidle", timeout: 120_000 });
        await player.locator("nav.cine-bottombar").getByRole("button", { name: "Battle", exact: true }).click();
        const panel = player.locator(".board-panel").locator("visible=true").first();
        const playerStrip = panel.getByRole("button", { name: /open the order/i }).first();
        await eventually(() => playerStrip.isVisible(), { timeoutMs: 30_000, label: "the player's strip" });
        check(await playerStrip.evaluate((node) => Boolean(node.closest(".board-panel")?.querySelector("h3")?.parentElement?.contains(node))), "the player's strip shares the heading with the phone on its side");
        await player.screenshot({ path: t.shotPath("player-sideways") }).catch(() => {});
      } finally {
        await seat.close();
      }
    } finally {
      // The same goblin plays directed-token-menu, clear of the docked strip.
      await moveTo(start);
    }
  },
};
