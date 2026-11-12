// Issue 845: a spell card shows one glyph for what the spell does, at the
// left of its art well where a fanned card still shows it, and the words for
// what it takes ("20-ft sphere", "3 darts") in the room beside it, as large
// as that room allows. The seed's level 9 wizard holds spells of most kinds.
// Every card size the Hand is drawn at (the fan, a short window, a phone,
// the staged board's three, the stage row's narrow column) gets the same
// check on a copy of each card: the glyph inside the well, every line of
// words whole, between 9px and 22px. Night and day.
import { check, eventually, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

// Card width, height and art well height, as hand.css, world.css and
// table-layout.css set them.
const SIZES = [
  { name: "fan", w: 156, h: 234, art: 58 },
  { name: "short window", w: 136, h: 204, art: 58 },
  { name: "phone", w: 132, h: 186, art: 40 },
  { name: "staged tall", w: 150, h: 212, art: 46 },
  { name: "staged", w: 128, h: 188, art: 46 },
  { name: "staged short", w: 106, h: 150, art: 36 },
];

export default {
  name: "spell-glyphs",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.spellbook[viewport];
    await t.open(`/campaigns/${table.id}`);
    const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
    if (await tab.count()) await t.tap(tab.first());
    const spells = page.locator(`${root}button.hand-group-card[data-group-id="group:spells"]`);
    await eventually(() => spells.count(), { timeoutMs: 30_000, label: "the Spells card in the fan" });
    if (t.touch) await t.tap(spells.first());
    else {
      await spells.first().focus();
      await page.keyboard.press("Enter");
    }
    await eventually(() => visible(page.locator(`${root}.hand-back`)).count(), { label: "the open Spells group" });
    const tabs = page.locator(`${root}.hand-group [role="tab"]`);
    await t.tap(tabs.filter({ hasText: "Level 3" }).first());
    await eventually(() => page.locator(`${root}.hand-fan button.hand-card[aria-label^="Fireball"]`).count(), { label: "Fireball under Level 3" });
    await untilStill(page);

    const fireball = page.locator(`${root}.hand-fan button.hand-card[aria-label^="Fireball"]`).first();
    const face = await fireball.evaluate((card) => ({
      src: card.querySelector(".hand-glyph")?.getAttribute("src") ?? "",
      loaded: (card.querySelector(".hand-glyph")?.naturalWidth ?? 0) > 0,
      words: [...card.querySelectorAll(".hand-glyph-words > span")].map((line) => line.textContent),
      label: card.getAttribute("aria-label") ?? "",
    }));
    check(face.src.endsWith("/spell-fire.webp") && face.loaded, `Fireball wears the fire glyph (${face.src}, loaded ${face.loaded})`);
    check(face.words.join(" ") === "20-ft sphere", `Fireball says its area beside it (${face.words.join(" / ")})`);
    check(/fire damage, 20-ft sphere/.test(face.label), `a screen reader hears it ("${face.label}")`);
    check((await page.locator(`${root}.hand-fan button.hand-card .hand-art:not([data-glyph]) .hand-glyph`).count()) === 0, "only a spell card wears a glyph");

    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await untilStill(page);
      await t.shot(`level-3-${theme}`);
      for (const level of ["Cantrips", "Level 1"]) {
        await t.tap(tabs.filter({ hasText: level }).first());
        await untilStill(page);
        await t.shot(`${level.toLowerCase().replace(" ", "-")}-${theme}`);
      }
      await t.tap(tabs.filter({ hasText: "Level 3" }).first());
      await untilStill(page);
    }

    // Every spell card of every level, laid at every card size.
    const problems = await page.evaluate(
      async ({ scope, sizes }) => {
        const hand = document.querySelector(`${scope}.hand`);
        const found = [];
        const cards = [];
        for (const tabButton of document.querySelectorAll(`${scope}.hand-group [role="tab"]`)) {
          tabButton.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          for (const card of document.querySelectorAll(`${scope}.hand-fan button.hand-card`)) {
            if (card.querySelector(".hand-art[data-glyph]")) cards.push(card.cloneNode(true));
          }
        }
        if (cards.length < 15) found.push(`only ${cards.length} spell cards found`);
        const bench = document.createElement("div");
        bench.style.cssText = "position:fixed;left:0;top:0;display:flex;flex-wrap:wrap;gap:4px;z-index:9999;pointer-events:none";
        hand.appendChild(bench);
        for (const size of sizes) {
          for (const source of cards) {
            const card = source.cloneNode(true);
            card.style.cssText = `position:relative;left:0;width:${size.w}px;height:${size.h}px;transform:none;animation:none`;
            card.querySelector(".hand-art").style.flexBasis = `${size.art}px`;
            bench.appendChild(card);
          }
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          for (const card of bench.children) {
            const name = (card.getAttribute("aria-label") ?? "").split(",")[0];
            const art = card.querySelector(".hand-art").getBoundingClientRect();
            const glyph = card.querySelector(".hand-glyph").getBoundingClientRect();
            if (glyph.left < art.left - 0.5 || glyph.right > art.right + 0.5 || glyph.top < art.top - 0.5 || glyph.bottom > art.bottom + 0.5) {
              found.push(`${size.name} ${name}: the glyph leaves its well`);
            }
            if (glyph.height < art.height * 0.6) found.push(`${size.name} ${name}: the glyph is ${glyph.height}px in a ${art.height}px well`);
            const target = card.querySelector(".hand-glyph-words");
            if (!target || getComputedStyle(target).display === "none") {
              if (target && art.width > 60) found.push(`${size.name} ${name}: the words are hidden in a ${art.width}px well`);
              continue;
            }
            const px = parseFloat(getComputedStyle(target).fontSize);
            if (px < 9 || px > 22) found.push(`${size.name} ${name}: words at ${px}px`);
            const box = target.getBoundingClientRect();
            if (box.left < glyph.right - 0.5 || box.right > art.right + 0.5) found.push(`${size.name} ${name}: the words overlap the glyph or leave the well`);
            for (const line of target.children) {
              if (line.scrollWidth > line.clientWidth + 1) found.push(`${size.name} ${name}: "${line.textContent}" is cut at ${px}px (${line.scrollWidth} of ${line.clientWidth}px)`);
            }
            if (target.scrollHeight > target.clientHeight + 1) found.push(`${size.name} ${name}: the words are taller than the well`);
          }
          bench.replaceChildren();
        }
        bench.remove();
        return found;
      },
      { scope: root, sizes: SIZES },
    );
    check(problems.length === 0, `every spell card reads at every size:\n  ${problems.slice(0, 12).join("\n  ")}`);
  },
};
