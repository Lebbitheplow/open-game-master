// A held card's read panel keeps the Hand to its share of the board. The
// Hand is held there at rest and with a card picked (140-hand-share, issue
// 992), but the read panel of a card that cannot be played now stood under
// the cards and made the Hand taller by its own height: 407px on a laptop's
// 409px board, 332px on the party lead's 261px one, on the turn's plate and
// with End turn over the board's top edge.
//
// On a laptop the panel and the reason said under it lie over the cards'
// feet in the height the Hand has: the Hand is no taller than at rest, the
// turn's plate shows above it, the panel's heading and Close stay in view
// when its text is scrolled, the cards are in no box that scrolls, and
// Escape closes the panel and hands the keyboard back to its card.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "hand-read-share",
  viewports: ["laptop"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    const cards = page.locator(`${root}.cine-fight-hand .hand-fan .hand-card`).locator("visible=true");
    await eventually(() => cards.count(), { timeoutMs: 30_000, label: "the Hand's cards on the board" });
    await untilStill(page);

    const rect = (selector) =>
      page.evaluate((sel) => {
        const element = [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length);
        if (!element) return null;
        const { left, top, right, bottom, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, height };
      }, `${root}${selector}`);
    const apart = (one, two) => !one || !two || one.right <= two.left || two.right <= one.left || one.bottom <= two.top || two.bottom <= one.top;
    const px = (value) => Math.round(value ?? 0);
    const hand = page.locator(`${root}.cine-fight-hand .hand`).first();

    const heldCards = () => page.locator(`${root}.cine-fight-hand .hand-fan .hand-card[aria-disabled="true"]`).locator("visible=true");
    if (!(await heldCards().count())) {
      // The lead holds nothing back on their own turn here: the paladin's
      // table does, with a reaction offered over the cards besides.
      await t.open(`/campaigns/${ids.bench2.desktop.paladin.id}`);
      await eventually(() => heldCards().count(), { timeoutMs: 30_000, label: "a held card on the paladin's board" });
      await untilStill(page);
    }
    const held = heldCards().first();
    const resting = await rect(".cine-fight-hand");
    const board = await rect(".cine-fight-board .board-view");
    const short = await page.evaluate((sel) => document.querySelector(sel)?.hasAttribute("data-hand-share") ?? false, `${root}.cine-fight-board`);
    check(short, `the board under the held card (${px(board.height)}px) is short`);

    // ---- the panel opens over the cards' feet, the Hand no taller ----
    await held.focus();
    await page.keyboard.press("Enter");
    const panel = page.locator(`${root}.cine-fight-hand .hand-read`).locator("visible=true");
    await eventually(() => panel.count(), { label: "the read panel of the held card" });
    await untilStill(page);
    const reading = await rect(".cine-fight-hand");
    check(reading.height <= resting.height + 4, `with a held card read the Hand is ${px(reading.height)}px, no taller than at rest (${px(resting.height)}px) on a ${px(board.height)}px board`);
    const plate = await rect(".board-view .board-glass.rounded-lg");
    check(plate && apart(reading, plate) && plate.bottom <= reading.top, `the turn's plate shows above the Hand (${px(plate?.bottom)} over ${px(reading.top)})`);
    const sheet = await rect(".cine-fight-hand .hand-read");
    check(sheet.top >= reading.top - 1 && sheet.bottom <= reading.bottom + 1, `the panel lies inside the Hand (${px(sheet.top)} to ${px(sheet.bottom)} in ${px(reading.top)} to ${px(reading.bottom)})`);
    check(await cards.count(), "the cards stay behind the panel");
    const boxed = await hand.evaluate((node) => getComputedStyle(node).overflowY);
    check(boxed === "visible", `the cards are not in a box that scrolls (${boxed})`);
    const reason = await rect(".cine-fight-hand .hand p[role='status']");
    check(reason && reason.height >= 12 && reason.top >= sheet.bottom - 1 && reason.bottom <= reading.bottom + 1, `the reason is said under the panel (${px(reason?.top)} to ${px(reason?.bottom)}, the panel ends at ${px(sheet.bottom)})`);
    // Close is whole, in the Hand, and nothing lies on it.
    const closeAt = () =>
      panel.first().getByRole("button", { name: "Close" }).evaluate((button) => {
        const { left, top, right, bottom, height } = button.getBoundingClientRect();
        const on = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return { top, bottom, height, clear: on === button || button.contains(on) };
      });
    const close = await closeAt();
    check(close.clear && close.height >= 40 && close.top >= reading.top && close.bottom <= reading.bottom, `Close is in view in the Hand (${px(close.top)} to ${px(close.bottom)})`);
    const faults = await axeViolations(page, `${root}.cine-fight-hand`);
    check(faults.length === 0, `the Hand with a held card read passes axe: ${JSON.stringify(faults).slice(0, 500)}`);
    await t.shot("read");

    // ---- its whole text scrolls inside the panel, and Close stays ----
    // A server with the content pack has a full text to open; CI's has none.
    const opener = panel.first().locator(".hand-full-text-toggle");
    if (await opener.count()) {
      await t.tap(opener);
      await eventually(() => panel.first().locator(".hand-full-text-body").isVisible(), { label: "the held card's full text" });
      await untilStill(page);
      const open = await rect(".cine-fight-hand");
      check(open.height <= resting.height + 4, `with the full text open the Hand is ${px(open.height)}px, still no taller than at rest (${px(resting.height)}px)`);
      const under = await panel.first().evaluate((node) => {
        node.scrollTo(0, node.scrollHeight);
        return node.scrollHeight - node.clientHeight;
      });
      if (under > 8) {
        await untilStill(page);
        const stays = await closeAt();
        check(stays.clear && stays.top >= reading.top && stays.bottom <= reading.bottom, `Close stays in view when the text is scrolled ${under}px (${px(stays.top)} to ${px(stays.bottom)})`);
      }
    }

    // ---- Escape lets the panel go and hands the keyboard back ----
    await held.focus();
    await page.keyboard.press("Escape");
    await eventually(async () => !(await panel.count()), { label: "Escape closing the read panel" });
    await eventually(() => held.evaluate((button) => button === document.activeElement), { label: "the keyboard back on the held card" });
  },
};
