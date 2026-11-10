// In a staged fight the Hand lies on the board's lower edge and the board
// has the whole column. Before, the board stood 144px tall on a 1600x900
// window under a heading, an order strip and a hint, the Hand had a 264px box
// of its own beneath it, and on a laptop's 768px the message box sat 65px
// under the fold.
//
// Docked (desktop and laptop): the cards are drawn inside the board's frame
// and not in the desk, the board is tall, End turn stands above the cards
// and not under them, and the message box is whole inside the window. The
// Hand is put away to see the map it lies on, so that is a move the table
// makes and not a cut: the cards fold, the board's corner glides down to
// the frame's foot, and they deal back in. A phone keeps the Hand in the
// desk, where its rail is.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "hand-on-board",
  viewports: ["desktop", "laptop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    // A phone opens on the board when it is this hero's turn; the Hand is
    // on its Table tab.
    if (viewport === "phone") {
      await t.tap(page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: /^\s*Table\s*$/i }).first());
    }
    await eventually(() => page.locator(`${root}.hand-card`).locator("visible=true").count(), { timeoutMs: 30_000, label: "the Hand's cards" });
    await untilStill(page);
    const box = (selector) =>
      page.evaluate((sel) => {
        const element = [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      }, `${root}${selector}`);
    const onBoard = await page.locator(`${root}.cine-fight-board .cine-fight-hand .hand-card`).locator("visible=true").count();
    const inDesk = await page.locator(`${root}.session-compose-hand .hand-card`).locator("visible=true").count();
    if (viewport === "phone") {
      check(onBoard === 0 && inDesk >= 3, `a phone keeps the Hand in the desk (${inDesk} cards there, ${onBoard} on a board)`);
      return;
    }
    check(onBoard >= 3 && inDesk === 0, `the cards lie on the board (${onBoard} there, ${inDesk} in the desk)`);
    const board = await box(".cine-fight-board .board-view");
    const hand = await box(".cine-fight-hand");
    const floor = viewport === "laptop" ? 260 : 420;
    check(board && board.height >= floor, `the board is ${Math.round(board?.height ?? 0)}px tall, at least ${floor}`);
    check(hand && board && hand.bottom <= board.bottom + 24 && hand.top > board.top, "the Hand stands inside the board's frame, at its foot");
    // The message box, whole and on screen: the laptop's was cut by the fold.
    const well = await box(".session-well");
    const tall = await page.evaluate(() => window.innerHeight);
    check(well && well.bottom <= tall + 1, `the message box ends at ${Math.round(well?.bottom ?? 0)} in a window of ${tall}`);
    // It is this hero's turn, so the board offers End turn: above the cards.
    const end = await box(".board-endturn");
    check(end && hand && end.bottom <= hand.top + 16, `End turn (bottom ${Math.round(end?.bottom ?? 0)}) stands above the Hand (top ${Math.round(hand?.top ?? 0)})`);
    // Folded, the Hand is its heading alone and the corner comes down.
    const fold = page.getByRole("button", { name: /^Hide your hand$/ }).locator("visible=true").first();
    check(/hide/i.test((await fold.textContent()) ?? ""), "on the board the fold button says Hide in a word");
    await fold.click();
    const motion = (selector) =>
      page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((el) => el.getAnimations().map((a) => a.animationName ?? a.transitionProperty)), `${root}${selector}`);
    await eventually(async () => (await motion(".cine-fight-hand .hand-slot")).includes("hand-fan-out"), { timeoutMs: 2_000, every: 30, label: "the cards folding away" });
    await eventually(async () => (await motion(".cine-fight-board .board-corner")).includes("bottom"), { timeoutMs: 3_000, every: 30, label: "the board's corner gliding down" });
    await eventually(async () => ((await box(".cine-fight-hand"))?.height ?? 999) < 80, { label: "the folded Hand" });
    await eventually(async () => ((await box(".board-endturn"))?.bottom ?? 0) > (end?.bottom ?? 0) + 60, { label: "End turn coming down with the folded Hand" });
    await t.shot("hand-folded");
    await page.getByRole("button", { name: /^Show your hand$/ }).locator("visible=true").first().click();
    await eventually(async () => (await motion(".cine-fight-hand .hand-slot")).includes("hand-fan-in"), { timeoutMs: 2_000, every: 30, label: "the cards dealing back in" });
    await eventually(() => page.locator(`${root}.cine-fight-board .cine-fight-hand .hand-card`).locator("visible=true").count(), { label: "the cards back on the board" });
    await t.shot("hand-on-board");
  },
};
