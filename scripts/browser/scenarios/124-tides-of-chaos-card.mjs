// Tides of Chaos's card (src/lib/srd/authored-effects-data3.ts): raised, it
// asks which roll takes the advantage, Attack, Check or Save, and playing a
// pick leaves that roll's carrier on the sorcerer's sheet. Desktop and phone,
// night and day.
import { check, eventually, sleep, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

export default {
  name: "tides-of-chaos-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.tidesOfChaos[viewport].id}`);
    // A phone may open on the turn's board, which has no Hand: the Table tab does.
    const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
    if (await tab.count()) await t.tap(tab.first());

    const card = visible(page.locator(`${root}.hand-fan button.hand-card[aria-label^="Tides of Chaos,"]`));
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the Tides of Chaos card" });
    check(!(await card.first().isDisabled()), "the card can be played");
    // The fight's banner fades, and a phone's fan scrolls sideways: the shot
    // shows the card itself.
    await sleep(3_500);
    await card.first().scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("card");

    if (t.touch) {
      await t.tap(card.first());
    } else {
      await card.first().focus();
      await page.keyboard.press("Enter");
    }
    const aimBar = visible(page.locator(`${root}.hand-aim`));
    await eventually(() => aimBar.count(), { label: "Tides of Chaos raised, its aim bar open" });
    const picks = aimBar.first().locator("button").filter({ hasText: /^\s*(attack|check|save)\s*$/i });
    await eventually(async () => (await picks.count()) === 3, { label: "three picks: Attack, Check, Save" });
    // Raising the card focuses its first pick, whose tooltip then covers the
    // card's name: the shot is of the picks, without it.
    await page.mouse.move(1, 1);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await sleep(500);
    await untilStill(page);
    await t.shot("picks");

    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    // The theme eases its colours over; the shot waits for them to land.
    await sleep(1_000);
    await untilStill(page);
    await t.shot("picks-day");
    // By day the chosen pick stands apart from the others (its border and ink
    // are the day's gold, not the parchment's), and every pick is a finger's size.
    const looks = await picks.evaluateAll((buttons) =>
      buttons.map((button) => ({ on: button.getAttribute("aria-checked") === "true", border: getComputedStyle(button).borderTopColor, ink: getComputedStyle(button).color, height: button.getBoundingClientRect().height })),
    );
    const chosen = looks.find((look) => look.on);
    check(Boolean(chosen), "one pick is chosen");
    check(looks.filter((look) => !look.on).every((look) => look.border !== chosen.border && look.ink !== chosen.ink), `by day the chosen pick looks like the others: ${JSON.stringify(looks)}`);
    if (viewport === "phone") check(looks.every((look) => look.height >= 40), `a pick under 40px on a phone: ${JSON.stringify(looks)}`);
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  },
};
