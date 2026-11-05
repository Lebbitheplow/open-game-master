// Shadow Martyr and Reflexive Resistance, seen running on a desktop and a phone,
// day and night, the Hand through axe. Shadow Martyr is offered under a hit on an
// ally and not under the fighter's own; played, it goes out as the fighter's
// reaction to that hit. Reflexive Resistance is offered under the
// ranger's own hit and not under an ally's (the seed's bench2.echo and bench2.drake).
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "echo-drake-reactions",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, root, ids } = t;
    const phone = t.viewport === "phone";
    const { echo, drake } = ids.bench2[t.viewport];
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    const handAt = async (id, label) => {
      await t.open(`/campaigns/${id}`);
      const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
      await eventually(
        async () => {
          if (await hand.isVisible().catch(() => false)) return true;
          if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
          return false;
        },
        { timeoutMs: 60_000, every: 1_000, label },
      );
      return hand;
    };
    const themes = async (hand, step) => {
      await hand.evaluate((node) => node.setAttribute("data-reactions", "hand"));
      for (const theme of ["dark", "light"]) {
        await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
        await untilStill(page).catch(() => undefined);
        const faults = await axeViolations(page, '[data-reactions="hand"]');
        check(faults.length === 0, `${step} passes axe in the ${theme} theme: ${JSON.stringify(faults).slice(0, 400)}`);
        await t.shot(`${step}-${theme}`);
      }
    };
    const tall = async (card) => {
      if (!phone) return;
      await untilStill(page).catch(() => undefined);
      const box = await card.boundingBox();
      check(box && Math.round(box.height) >= 40, `the card is at least 40px tall on a phone (${box?.height})`);
    };

    // The drake's table: the ranger's own hit offers it, the ally's does not.
    const rangerHand = await handAt(drake.id, "the ranger's Hand");
    const rangerStrips = rangerHand.locator('[role="group"][aria-label="Reactions"]');
    const resist = rangerStrips.getByRole("button", { name: /^Reflexive Resistance/ });
    await eventually(async () => (await resist.count()) === 1, { timeoutMs: 20_000, label: "one Reflexive Resistance, for the ranger's own hit" });
    check((await rangerStrips.filter({ hasText: drake.ally.name }).getByRole("button", { name: /^Reflexive Resistance/ }).count()) === 0, `no Reflexive Resistance for ${drake.ally.name}'s hit`);
    await tall(resist.first());
    await themes(rangerHand, "reflexive-resistance");

    // The echo's table: one chip, for the ally's hit. The fan repeats an offered reaction.
    const hand = await handAt(echo.id, "the fighter's Hand");
    const strips = hand.locator('[role="group"][aria-label="Reactions"]');
    const martyr = strips.filter({ hasText: echo.ally.name }).getByRole("button", { name: /^Shadow Martyr/ }).first();
    await eventually(() => martyr.isVisible(), { timeoutMs: 20_000, label: `Shadow Martyr for ${echo.ally.name}'s hit` });
    const every = await strips.getByRole("button", { name: /^Shadow Martyr/ }).count();
    check(every === 1, `one Shadow Martyr chip: none for the fighter's own hit (${every})`);
    await tall(martyr);
    await themes(hand, "shadow-martyr");

    const open = ((await (await api.get(`${base}/api/campaigns/${echo.id}`)).json()).encounter?.lastHits ?? []).filter((hit) => hit.characterId === echo.ally.id);
    check(open.length === 1, `one open hit on ${echo.ally.name} (${JSON.stringify(open).slice(0, 300)})`);
    await t.tap(martyr);
    const send = hand.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();
    await eventually(async () => /shadow martyr/i.test(await send.innerText()), { label: "the aim bar for Shadow Martyr" });
    await t.shot("shadow-martyr-aim");
    const played = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${echo.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(send);
    const answer = await played;
    const body = JSON.parse(answer.request().postData() ?? "{}");
    check(answer.ok(), `the reaction answered ${answer.status()}: ${(await answer.text()).slice(0, 200)}`);
    check(body.characterId === echo.knight.id && body.intent?.card === "reaction" && body.intent?.feature === "Shadow Martyr" && body.intent?.hit === open[0].id, `the card goes out as the fighter's reaction to that hit (${JSON.stringify(body).slice(0, 300)})`);
    check(body.intent?.targetId === echo.ally.id && body.intent?.targetKind === "ally", `the ally it covers goes with it (${JSON.stringify(body).slice(0, 300)})`);
    await untilStill(page).catch(() => undefined);
    await t.shot("shadow-martyr-sent");
  },
};
