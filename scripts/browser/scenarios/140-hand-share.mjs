// The Hand keeps to its share of the board (issue 992). The camera counts on
// the Hand covering at most 55% of the board and follows a turn in the strip
// above it, but nothing held the Hand there. On a laptop a picked card's aim
// panel, 281px for an attack, covered the party lead's 305px board to its
// top edge: "Pick a target, here or on the board", with no board left. At
// rest the cards stood 82px under the board's top, over the order's plates.
//
// On a laptop: the cards at rest slide under the frame's lower edge by what
// the Hand is over its share, never so far that a name goes under it, and a
// card rises whole for the pointer and for the keyboard alike. A picked
// card's panel is held to the share: the target chips, the numbers (the
// chance to hit among them) and the row of buttons are in view without a
// scroll, the turn's plate shows above, and the buttons stay at the Hand's
// foot when the rest is scrolled. At 1280x720 the strip above the cards at
// rest is one row, and the turn's plate and the camera's row are whole in
// it and apart. A desktop's board has room for the whole panel, and is left
// as it was.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const SHARE = 0.55;

export default {
  name: "hand-share",
  viewports: ["desktop", "laptop"],
  async run(t) {
    const { page, root, ids, viewport } = t;
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
    const stage = () =>
      page.evaluate((sel) => {
        const element = document.querySelector(sel);
        return { short: element?.hasAttribute("data-hand-share") ?? false, tuck: parseFloat(element?.style.getPropertyValue("--hand-tuck") ?? "") || 0 };
      }, `${root}.cine-fight-board`);
    const apart = (one, two) => !one || !two || one.right <= two.left || two.right <= one.left || one.bottom <= two.top || two.bottom <= one.top;
    const px = (value) => Math.round(value ?? 0);
    const playable = page.locator(`${root}.cine-fight-hand .hand-fan .hand-card:not([aria-disabled="true"])`).locator("visible=true").first();
    const hand = page.locator(`${root}.cine-fight-hand .hand`).first();
    const send = page.locator(`${root}.cine-fight-hand .hand-aim-send`).first();
    const view = await rect(".cine-fight-board .board-view");
    const share = Math.round(view.height * SHARE);

    if (viewport === "desktop") {
      // Room for the whole Hand: nothing here is laid out anew.
      const before = await rect(".cine-fight-hand");
      const marks = await stage();
      check(!marks.short && marks.tuck === 0, `a desktop's board (${px(view.height)}px) is not short and its cards are not tucked (${JSON.stringify(marks)})`);
      await t.tap(playable);
      await eventually(() => send.isVisible(), { label: "the aim panel" });
      await untilStill(page);
      check(await page.getByRole("button", { name: /^Hide your hand$/ }).locator("visible=true").count(), "a desktop keeps the Hand's heading over the aim panel");
      const keys = await page.locator(`${root}.cine-fight-hand .hand-aim .hand-row-key`).evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width > 8).length);
      check(keys >= 3, `a desktop keeps the numbers as rows under their names (${keys} names shown)`);
      const reach = await hand.evaluate((node) => node.scrollHeight - node.clientHeight);
      check(reach <= 1, `a desktop's aim panel fits its share without a scroll (${reach}px over)`);
      await t.tap(page.locator(`${root}.cine-fight-hand .hand-aim-send`).getByRole("button", { name: "Back" }));
      await eventually(() => cards.count(), { label: "the cards back" });
      await untilStill(page);
      const after = await rect(".cine-fight-hand");
      check(Math.abs(after.height - before.height) <= 1, `the Hand at rest is the height it was (${px(before.height)}px, then ${px(after.height)}px)`);
      return;
    }

    // ---- at rest: the cards slide under the edge, down to their names ----
    const marks = await stage();
    check(marks.short && marks.tuck > 0, `a laptop's board (${px(view.height)}px) is short and its cards are tucked (${JSON.stringify(marks)})`);
    const fan = await rect(".cine-fight-hand .hand-fan");
    const edge = fan.bottom - marks.tuck;
    const lowest = await page.locator(`${root}.cine-fight-hand .hand-fan .hand-name`).evaluateAll((nodes) => Math.max(...nodes.map((node) => node.getBoundingClientRect().bottom)));
    check(lowest <= edge + 1, `no card's name is under the edge (the lowest ends at ${px(lowest)}, the edge is at ${px(edge)})`);
    const rest = await rect(".cine-fight-hand");
    check(rest.height < share + 60, `the Hand at rest (${px(rest.height)}px) is near its share of the board (${share}px of ${px(view.height)}px)`);
    check(apart(rest, await rect(".board-view .board-plate")), "the Hand at rest keeps off the order's plates");

    // ---- a card rises whole, for the pointer and for the keyboard ----
    const second = cards.nth(1);
    const box = (locator) => locator.evaluate((node) => {
      const { top, bottom } = node.getBoundingClientRect();
      return { top, bottom };
    });
    const lying = await box(second);
    check(lying.bottom > edge + 8, `a card at rest lies under the edge (its foot at ${px(lying.bottom)}, the edge at ${px(edge)})`);
    await second.hover({ position: { x: 20, y: 20 }, force: true });
    await eventually(async () => (await box(second)).bottom <= edge + 1, { label: "the card under the pointer rising whole" });
    await untilStill(page);
    const hovered = await box(second);
    await page.mouse.move(8, 8);
    await eventually(async () => (await box(second)).bottom > edge + 8, { label: "the card lying down again" });
    await second.focus();
    await eventually(async () => (await box(second)).bottom <= edge + 1, { label: "the card under the keyboard's focus rising whole" });
    await untilStill(page);
    const focused = await box(second);
    check(Math.abs(focused.top - hovered.top) <= 2, `focus raises a card as far as the pointer does (to ${px(focused.top)} and to ${px(hovered.top)})`);
    await second.blur();

    // ---- a picked card: the panel is held to the share ----
    await t.tap(playable);
    await eventually(() => send.isVisible(), { label: "the aim panel" });
    await untilStill(page);
    const aiming = await rect(".cine-fight-hand");
    check(aiming.height <= share + 1, `with a card picked the Hand is ${px(aiming.height)}px, inside its share (${share}px of ${px(view.height)}px)`);
    const plate = await rect(".board-view .board-glass.rounded-lg");
    check(plate && apart(aiming, plate) && plate.bottom <= aiming.top, `the turn's plate shows above the Hand (${px(plate?.bottom)} over ${px(aiming.top)})`);
    check((await page.getByRole("button", { name: /^Hide your hand$/ }).locator("visible=true").count()) === 0, "the Hand's own heading gives way to the panel's");
    const targets = await rect(".cine-fight-hand .hand-aim [aria-label='Targets']");
    const buttons = await rect(".cine-fight-hand .hand-aim-send");
    const numbers = await rect(".cine-fight-hand .hand-aim .hand-rows");
    check(targets && buttons && targets.top >= aiming.top && targets.bottom <= buttons.top + 1, `the target chips are in view over the buttons (${px(targets?.top)} to ${px(targets?.bottom)}, the buttons from ${px(buttons?.top)})`);
    check(buttons.bottom <= aiming.bottom + 1 && buttons.height >= 40, `the buttons are whole at the Hand's foot (${px(buttons.top)} to ${px(buttons.bottom)} in a Hand that ends at ${px(aiming.bottom)})`);
    check(numbers && numbers.top >= buttons.top - 1 && numbers.bottom <= aiming.bottom + 1 && numbers.right <= buttons.left + 1, "the numbers are one block beside the buttons, at the Hand's foot");
    const line = await page.locator(`${root}.cine-fight-hand .hand-aim .hand-rows`).first().evaluate((node) =>
      [...node.querySelectorAll(".hand-row")].filter((row) => row.getClientRects().length).map((row) => row.querySelector(".hand-row-value")?.textContent ?? "").join(" · "),
    );
    check(/\bvs AC\b/.test(line) && !/· piercing ·/.test(line), `the numbers are one line with the chance to hit, and say the type once: ${line}`);
    const named = await page.locator(`${root}.cine-fight-hand .hand-aim .hand-row-key`).evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean).length);
    check(named >= 3, `each number still has its name for a screen reader (${named})`);
    const faults = await axeViolations(page, `${root}.cine-fight-hand`);
    check(faults.length === 0, `the Hand with a card picked passes axe: ${JSON.stringify(faults).slice(0, 500)}`);
    await t.shot("aim");

    // ---- what is past the share scrolls, and the buttons stay ----
    const reach = await hand.evaluate((node) => node.scrollHeight - node.clientHeight);
    check(reach > 8, `the rules line and the full text are under a scroll (${reach}px)`);
    // The wheel over the panel scrolls it. The Hand lets the pointer through
    // to the map between its cards, and the panel did too: the wheel zoomed
    // the board under it.
    const title = await rect(".cine-fight-hand .hand-aim > :first-child");
    await page.mouse.move((title.left + title.right) / 2, (title.top + title.bottom) / 2);
    await page.mouse.wheel(0, 60);
    await eventually(() => hand.evaluate((node) => node.scrollTop > 0), { timeoutMs: 5_000, label: "the wheel scrolling the Hand" });
    await hand.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await untilStill(page);
    const scrolled = await rect(".cine-fight-hand .hand-aim-send");
    check(Math.abs(scrolled.top - buttons.top) <= 1, `the buttons stay where they were when the Hand is scrolled (${px(buttons.top)}, then ${px(scrolled.top)})`);
    const rules = await rect(".cine-fight-hand .hand-aim-rules");
    check(rules && rules.bottom <= scrolled.top + 1 && rules.top >= aiming.top - 1, "scrolled to its end, the rules line is in view over the buttons");

    // ---- Back: the cards return, tucked as they were ----
    await t.tap(page.locator(`${root}.cine-fight-hand .hand-aim-send`).getByRole("button", { name: "Back" }));
    await eventually(() => cards.count(), { label: "the cards back" });
    await untilStill(page);
    const back = await stage();
    check(back.tuck === marks.tuck, `the cards come back tucked as they were (${back.tuck}px, ${marks.tuck}px before)`);

    // ---- 1280x720: the strip at rest holds the turn's plate and the camera's row ----
    // The lead's board there is 213px and the strip above the cards at rest
    // 48px, one row: the turn's plate under its heading stood on the Hand's
    // heading, and the camera's row, with no room beside the two, lay over
    // the heading and touched the plate.
    await page.setViewportSize({ width: 1280, height: 720 });
    await eventually(async () => (await rect(".cine-fight-board .board-view")).height < view.height - 20, { label: "the board at 1280x720" });
    await untilStill(page);
    const low = await rect(".cine-fight-board .board-view");
    const top = (await rect(".cine-fight-hand")).top;
    const parts = await page.evaluate((root) => {
      const box = (el) => {
        if (!el?.getClientRects().length) return null;
        const { left, top, right, bottom } = el.getBoundingClientRect();
        return { left, top, right, bottom };
      };
      const hud = document.querySelector(`${root}.cine-fight-board .board-turn-hud`);
      return {
        band: document.querySelector(`${root}.cine-fight-board`)?.getAttribute("data-foot-band") ?? null,
        heading: box(hud?.querySelector(".board-eyebrow")),
        plate: box(hud?.querySelector(".board-glass")),
        round: box(document.querySelector(`${root}.cine-fight-board .board-view [data-tour='battle-initiative']`)),
        row: [...document.querySelectorAll(`${root}.cine-fight-board .board-corner > *`)].map((el) => ({ name: el.className.split(" ")[0], ...box(el) })).filter((part) => part.left !== undefined),
      };
    }, root);
    const said = (part) => (part ? `${px(part.left)},${px(part.top)} to ${px(part.right)},${px(part.bottom)}` : "none");
    const whole = (part) => part && part.top >= low.top - 1 && part.bottom <= top + 1;
    await t.shot("rest-1280x720");
    check(whole(parts.plate), `at 1280x720 the turn's plate is whole between the board's top (${px(low.top)}) and the Hand (${px(top)}): ${said(parts.plate)}, the strip ${px(top - low.top)}px, band ${parts.band}`);
    for (const part of parts.row) {
      check(whole(part), `at 1280x720 the camera's row is whole in the strip (${part.name} at ${said(part)}, the board from ${px(low.top)}, the Hand from ${px(top)})`);
      for (const [name, other] of [["the turn's heading", parts.heading], ["the turn's plate", parts.plate], ["the round's line", parts.round]]) {
        check(apart(part, other), `at 1280x720 the camera's row keeps off ${name} (${part.name} at ${said(part)}, ${name} at ${said(other)})`);
      }
    }
  },
};
