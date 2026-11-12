// Chronal Shift comes up when a goblin within 30 feet of the Chronurgy wizard
// hits her or an ally, and not for one farther off (the seed's bench2.chronal:
// Bran beside Ilse, Tam 35 feet away and his goblin 40, a goblin's hit open on
// each and on Ilse).
// Seen on a desktop and a phone, day and night, the Hand through axe. Playing
// a reaction card from the aim bar is runic-shield's to check: the same path.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "chronal-shift",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const phone = t.viewport === "phone";
    const bench = ids.bench2[t.viewport].chronal;
    await t.open(`/campaigns/${bench.id}`);
    const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "Ilse's Hand" },
    );
    const strips = hand.locator('[role="group"][aria-label="Reactions"]');
    const cards = strips.getByRole("button", { name: /^Chronal Shift/ });
    const nearCard = strips.filter({ hasText: bench.near.name }).getByRole("button", { name: /^Chronal Shift/ }).first();
    await eventually(() => nearCard.isVisible(), { timeoutMs: 20_000, label: `Chronal Shift for ${bench.near.name}, beside Ilse` });
    check(
      !(await strips.filter({ hasText: bench.far.name }).getByRole("button", { name: /^Chronal Shift/ }).count()),
      `no Chronal Shift for ${bench.far.name}, 35 feet off`,
    );
    // One for Bran's hit and one for the hit on Ilse herself.
    await eventually(async () => (await cards.count()) === 2, { label: "two Chronal Shift cards: Bran's hit and Ilse's own" });
    await untilStill(page).catch(() => undefined);
    if (phone) {
      const box = await nearCard.boundingBox();
      check(box && Math.round(box.height) >= 40, `the card is at least 40px tall on a phone (${box?.height})`);
    }
    await hand.evaluate((node) => node.setAttribute("data-chronal", "hand"));
    for (const theme of ["dark", "light"]) {
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page).catch(() => undefined);
      const faults = await axeViolations(page, '[data-chronal="hand"]');
      check(faults.length === 0, `the Hand passes axe in the ${theme} theme: ${JSON.stringify(faults).slice(0, 400)}`);
      await t.shot(`chronal-shift-${theme}`);
    }
  },
};

export default scenario;
