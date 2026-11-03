// The open PR audit of 2026-11-03 (PRs 771-776): a paladin's reaction to a
// hit on an ally, seen running on a desktop and a phone, day and night, the
// Hand through axe. Glorious Defense covers a creature within 10 feet, and
// its card went to an ally beyond that too, which the engine then refused;
// the board's distances (PlayerMapView.feet) now keep it to the ally in
// reach. The card is a finger's size on a phone, named for a screen reader,
// and played from the aim bar like any reaction (the seed's bench2.paladin).
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "paladin-reactions",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const phone = t.viewport === "phone";
    const bench = ids.bench2[t.viewport].paladin;
    await t.open(`/campaigns/${bench.id}`);
    const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "Sela's Hand" },
    );
    const strips = hand.locator('[role="group"][aria-label="Reactions"]');
    const nearCard = strips.filter({ hasText: bench.near.name }).getByRole("button", { name: /^Glorious Defense/ }).first();
    await eventually(() => nearCard.isVisible(), { timeoutMs: 20_000, label: `Glorious Defense for ${bench.near.name}, beside Sela` });
    check(
      !(await strips.filter({ hasText: bench.far.name }).getByRole("button", { name: /^Glorious Defense/ }).count()),
      `no Glorious Defense for ${bench.far.name}, 25 feet off`,
    );
    // The card in the Hand names its 10 feet, not "Self": it covers an ally.
    const face = hand.locator(".hand-range", { hasText: /^10 ft$/ });
    await eventually(async () => (await face.count()) > 0, { timeoutMs: 20_000, label: "the card's reach on its face" });
    await untilStill(page).catch(() => undefined);
    if (phone) {
      const box = await nearCard.boundingBox();
      check(box && Math.round(box.height) >= 40, `the card is at least 40px tall on a phone (${box?.height})`);
    }
    await hand.evaluate((node) => node.setAttribute("data-paladin", "hand"));
    for (const theme of ["dark", "light"]) {
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page).catch(() => undefined);
      const faults = await axeViolations(page, '[data-paladin="hand"]');
      check(faults.length === 0, `the Hand passes axe in the ${theme} theme: ${JSON.stringify(faults).slice(0, 400)}`);
      await t.shot(`glorious-defense-${theme}`);
    }
    // Played: the aim bar names it, and it goes out as Sela's reaction.
    await t.tap(nearCard);
    const send = hand.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();
    await eventually(async () => /glorious defense/i.test(await send.innerText()), { label: "the aim bar for Glorious Defense" });
    const played = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${bench.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(send);
    const answer = await played;
    const body = JSON.parse(answer.request().postData() ?? "{}");
    check(answer.ok(), `the reaction answered ${answer.status()}: ${(await answer.text()).slice(0, 200)}`);
    check(body.intent?.card === "reaction" && /glorious defense/i.test(body.intent?.feature ?? ""), `sent as Glorious Defense (${JSON.stringify(body).slice(0, 300)})`);
    await untilStill(page).catch(() => undefined);
    await t.shot("glorious-defense-played");
  },
};
