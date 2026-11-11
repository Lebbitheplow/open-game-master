// A Hand card's rules line has 0 to 3 lines at 9 to 10px on the card (one
// on a laptop's card, none on the smallest staged one) and was cut off
// without a mark: Magic Missile's card showed its darts and nothing of how
// they scale. The whole line is written in the details over a hovered or
// focused card, at a size that reads, and in the aim bar a picked card opens,
// which is where a phone, with no hover, reads it.
import { check, eventually, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

export default {
  name: "hand-rules-text",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const press = async (locator) => {
      if (t.touch) return t.tap(locator);
      await locator.focus();
      await page.keyboard.press("Enter");
    };
    await t.open(`/campaigns/${ids.spellbook[viewport].id}`);
    const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
    if (await tab.count()) await t.tap(tab.first());
    const spells = page.locator(`${root}button.hand-group-card[data-group-id="group:spells"]`);
    await eventually(() => spells.count(), { timeoutMs: 30_000, label: "the Spells card in the fan" });
    await press(spells.first());
    const levelOne = page.locator(`${root}.hand-group [role="tab"]`).filter({ hasText: "Level 1" }).first();
    await eventually(() => levelOne.count(), { label: "the Level 1 tab" });
    await t.tap(levelOne);
    const card = visible(page.locator(`${root}.hand-fan button.hand-card[aria-label^="Magic Missile,"]`)).first();
    await eventually(() => card.count(), { label: "Magic Missile under Level 1" });
    await untilStill(page);

    const onCard = await card.locator(".hand-rules").evaluate((line) => ({ text: line.textContent ?? "" }));
    check(/darts/.test(onCard.text), `Magic Missile's card has a rules line ("${onCard.text}")`);

    if (viewport === "desktop") {
      // The keyboard's way to the details is the pointer's way too. A key
      // first, so the focus that follows the tab's tap reads as the keyboard's.
      await page.keyboard.press("Shift");
      await card.focus();
      const details = card.locator("xpath=..").locator(".hand-preview .hand-preview-rules");
      await eventually(() => details.isVisible(), { label: "the rules in the details over the focused card" });
      await untilStill(page);
      const shown = await details.evaluate((line) => {
        const box = line.getBoundingClientRect();
        return {
          text: line.textContent ?? "",
          size: parseFloat(getComputedStyle(line).fontSize),
          whole: line.scrollHeight <= line.clientHeight + 1,
          inWindow: box.top >= 0 && box.bottom <= window.innerHeight,
          // An open group's level tabs painted over the details' last rows.
          // The details take no pointer, so the probe gives them one for a moment.
          hit: (() => {
            const details = line.closest(".hand-preview");
            details.style.pointerEvents = "auto";
            const el = document.elementFromPoint(box.left + box.width / 2, box.bottom - 4);
            details.style.pointerEvents = "";
            return line.contains(el) ? "" : `${el?.tagName}.${el?.className}`;
          })(),
        };
      });
      check(shown.text === onCard.text, `the details write the card's whole rules line ("${shown.text}")`);
      check(shown.size >= 12, `at a size that reads (${shown.size}px)`);
      check(shown.whole && shown.inWindow, "and none of it is cut off or off screen");
      check(!shown.hit, `and nothing is drawn over its last line (${shown.hit || "none"})`);
      await t.shot("details");
    }

    await press(card);
    const aimRules = visible(page.locator(`${root}.hand-aim .hand-aim-rules`));
    await eventually(() => aimRules.count(), { label: "the rules in the aim bar of the picked card" });
    const aimed = await aimRules.first().evaluate((line) => ({ text: line.textContent ?? "", size: parseFloat(getComputedStyle(line).fontSize) }));
    check(aimed.text === onCard.text, `the aim bar writes the whole rules line ("${aimed.text}")`);
    check(aimed.size >= 12, `at a size that reads (${aimed.size}px)`);
    await untilStill(page);
    await t.shot("aim");
  },
};
