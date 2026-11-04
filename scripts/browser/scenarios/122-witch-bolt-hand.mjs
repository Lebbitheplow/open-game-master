// Witch Bolt's card while its beam holds (src/lib/dm/witch-bolt.ts). The seed's
// wizard hit a goblin last turn, so the card is the beam's free strike: 1d12
// with no roll and no slot, and it says what aiming at anyone else means.
// Raised, the preview says the same. Desktop and phone, night and day.
import { check, eventually, sleep, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

export default {
  name: "witch-bolt-hand",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.witchBolt[viewport].id}`);
    // A phone may open on the turn's board, which has no Hand: the Table tab does.
    const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
    if (await tab.count()) await t.tap(tab.first());

    const card = visible(page.locator(`${root}.hand-fan button.hand-card[aria-label^="Witch Bolt,"]`));
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "the Witch Bolt card" });
    await untilStill(page);
    const face = (await card.first().textContent()) ?? "";
    check(/1d12/.test(face), `the card names the beam's dice (${face})`);
    check(!/to hit/i.test(face) && /no roll/i.test(face), `the beam rolls nothing (${face})`);
    check(/no slot/i.test(face), `the card spends no slot (${face})`);
    check(/new casting/i.test(face), `the card says what another target means (${face})`);
    check(!(await card.first().isDisabled()), "the card can be played");
    // The fight's banner fades, and a phone's fan scrolls sideways: the shot
    // shows the card itself.
    await sleep(3_500);
    await card.first().scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("beam-card");

    if (t.touch) {
      await t.tap(card.first());
    } else {
      await card.first().focus();
      await page.keyboard.press("Enter");
    }
    const aimBar = visible(page.locator(`${root}.hand-aim`));
    await eventually(() => aimBar.count(), { label: "Witch Bolt raised, its aim bar open" });
    await untilStill(page);
    await t.shot("beam-aimed");

    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    // The theme eases its colours over; the shot waits for them to land.
    await sleep(1_000);
    await untilStill(page);
    await t.shot("beam-aimed-day");
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  },
};
