// PRs 777, 780 and 765: a limited-use reaction comes up when the hit it
// answers does, not on its holder's own turn. Here a goblin's blow has just
// dropped Mara, an Undead warlock, at a table the lead runs with both her and
// Corin fielded (the seed's bench2 Fall Table). Necrotic Husk is offered under
// that hit, open to her at 0 hit points, sized for a finger on a phone, clean
// under axe in the night theme and the day one, and played from its card it
// goes out as Mara's reaction to that hit and waits for the GM.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "hit-reaction-cards",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api, root, ids } = t;
    const phone = t.viewport === "phone";
    const { fall } = ids.bench2[t.viewport];
    const visible = (selector) => page.locator(`${root}${selector}`).locator("visible=true").first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    const onTable = (ready, label) =>
      eventually(
        async () => {
          if (await ready.isVisible().catch(() => false)) return true;
          if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
          return false;
        },
        { timeoutMs: 60_000, every: 1_000, label },
      );
    const themes = async (step, scope) => {
      await scope.evaluate((node) => node.setAttribute("data-hits", "1"));
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      for (const mode of ["dark", "light"]) {
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), mode);
        await untilStill(page).catch(() => undefined);
        const found = await axeViolations(page, '[data-hits="1"]');
        check(found.length === 0, `${step} fails axe in the ${mode} theme: ${JSON.stringify(found).slice(0, 500)}`);
        await t.shot(`${step}-${mode}`);
      }
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    };

    const open = ((await (await api.get(`${base}/api/campaigns/${fall.id}`)).json()).encounter?.lastHits ?? []).filter((hit) => hit.characterId === fall.mara.id);
    check(open.length === 1 && open[0].stood && open[0].stood.up === true, `one open hit on Mara, which found her standing (${JSON.stringify(open).slice(0, 300)})`);
    await t.open(`/campaigns/${fall.id}`);
    const hand = visible('section[aria-label="Your hand"]');
    await onTable(hand, "the lead's Hand");
    const strip = hand.locator('[role="group"][aria-label="Reactions"]').filter({ hasText: fall.mara.name }).first();
    await eventually(() => strip.isVisible(), { timeoutMs: 20_000, label: "Mara's reaction strip" });
    const husk = strip.getByRole("button", { name: /^Necrotic Husk/ });
    check((await husk.count()) === 1, `one Necrotic Husk chip for the one hit (${await husk.count()})`);
    check((await husk.getAttribute("aria-disabled")) !== "true", "Necrotic Husk is open to Mara at 0 hit points");
    if (phone) {
      await untilStill(page).catch(() => undefined);
      const box = await husk.boundingBox();
      check(box && Math.round(box.height) >= 40, `the chip is at least 40px tall on a phone (${box?.height})`);
    }
    await strip.scrollIntoViewIfNeeded();
    await themes("hit-reaction-strip", strip);

    await t.tap(husk);
    const send = hand.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();
    await eventually(async () => /necrotic husk/i.test(await send.innerText()), { label: "the aim bar for Necrotic Husk" });
    const posted = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${fall.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(send);
    const answer = await posted;
    const body = JSON.parse(answer.request().postData() ?? "{}");
    check(answer.ok(), `the reaction answered ${answer.status()}: ${(await answer.text()).slice(0, 200)}`);
    check(body.characterId === fall.mara.id && body.intent?.card === "reaction" && body.intent?.feature === "Necrotic Husk" && body.intent?.hit === open[0].id, `the card goes out as Mara's reaction to that hit (${JSON.stringify(body).slice(0, 300)})`);
    await eventually(async () => (await husk.getAttribute("aria-disabled")) === "true" || !(await husk.isVisible().catch(() => false)), { label: "the chip held while the GM resolves it" });
    await t.shot("hit-reaction-sent");
  },
};
