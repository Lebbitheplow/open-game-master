// Destructive Wrath (src/lib/dm/destructive-wrath.ts). The GM's seat makes the
// lead's cleric cast Shocking Grasp and the lead enters a real 18: the hit
// waits on the after-the-roll card, which offers Destructive Wrath; pressed
// from the keyboard, the lightning is dealt at its maximum and no damage roll
// waits, since no die is left to roll. Then the cleric holds a use from the
// Hand for a roll the server makes at once, and the party card says so. The
// rules are held by scripts/test-enforce-destructive-wrath.mjs; this is what
// only a page and real dice can show: the card and the hold by day and by
// night, finger-sized, in the app shell and at phone width.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "destructive-wrath",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.wrathTables[viewport];
    const gm = await request.newContext();
    const state = async () => (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
    const heroOf = async () => (await state()).sheets.find((sheet) => sheet.id === table.hero);
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const invoke = (name, args) => gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });

      // ---- the hit waits on the card ----
      const before = (await state()).encounter?.enemies?.find((enemy) => enemy.id === table.goblin)?.currentHp;
      const cast = await invoke("pc_attack", { characterId: table.hero, enemyId: table.goblin, targetEnemyId: table.goblin, spell: "Shocking Grasp", damage: "1d8" });
      check(cast.ok(), `the spell was cast (${cast.status()})`);
      const parked = (await state()).pendingRolls?.find((entry) => entry.kind === "attack");
      check(parked, "the to-hit roll waits for the lead's dice");
      const entered = await page.evaluate(
        async ({ campaignId, id }) => (await fetch(`/api/campaigns/${campaignId}/pending-rolls/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dice: [18] }) })).status,
        { campaignId: table.id, id: parked.id },
      );
      check(entered === 200, `the 18 was entered (${entered})`);
      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the after-the-roll card on the hit" });
      const wrath = choices.getByRole("button", { name: "Destructive Wrath: maximum lightning and thunder" });
      const keep = choices.getByRole("button", { name: "Keep this roll" });
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      await eventually(() => page.getByText(/You can deal its lightning and thunder at their maximum/).locator("visible=true").count(), { timeoutMs: 10_000, label: "the card says the attack hit" });
      for (const button of [wrath, keep]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}${GROUP}`);
      check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("card");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("card-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      // From the keyboard: the lightning at its maximum, and nothing to roll.
      await wrath.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the hit lands" });
      const after = await state();
      check(!after.pendingRolls?.some((entry) => entry.kind === "damage"), "no damage roll waits on the lead");
      const goblin = after.encounter?.enemies?.find((enemy) => enemy.id === table.goblin);
      check(before === undefined || !goblin || goblin.currentHp <= before - 8 || goblin.status !== "alive", `the goblin took the maximum (${before} to ${goblin?.currentHp})`);
      check((await heroOf())?.resources?.channel_divinity?.used === 1, "a use of Channel Divinity is spent");

      // ---- a use held for a roll the server makes at once ----
      // A third-level cleric has one use: the GM gives it back, as after a rest.
      const back = await gm.patch(`${base}/api/campaigns/${table.id}/sheets/${table.hero}`, {
        data: { resources: { ...(await heroOf()).resources, channel_divinity: { max: 1, used: 0 } }, reason: "A short rest's use back" },
      });
      check(back.ok(), `the use came back (${back.status()}: ${(await back.text()).slice(0, 200)})`);
      const held = await invoke("use_resource", { characterId: table.hero, resource: "Channel Divinity", variant: "destructive wrath" });
      check(held.ok(), `the hold was taken (${held.status()}: ${(await held.text()).slice(0, 300)})`);
      await eventually(async () => (await heroOf())?.conditions?.includes("destructive wrath"), { timeoutMs: 15_000, label: "the hold on the sheet" });
      if (viewport === "phone") {
        await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Party", exact: true }));
        await untilStill(page);
      }
      await eventually(() => page.getByText(/destructive wrath/i).locator("visible=true").count(), { timeoutMs: 10_000, label: "the hold shown on the page" });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the page is not pushed sideways");
      await t.shot("held");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("held-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
