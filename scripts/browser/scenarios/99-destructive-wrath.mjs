// Destructive Wrath held from the Hand (src/lib/dm/destructive-wrath.ts): the
// lead's cleric holds it, the GM's seat makes them cast Shocking Grasp, and the
// lead enters a real 18 for the to-hit roll. Every damage die is written at its
// maximum, so no damage roll waits on them. The rules are held by
// scripts/test-enforce-destructive-wrath.mjs; this is what only a page and real
// dice can show: the hold on the sheet by day and by night, in the app shell,
// and a table not left waiting on a roll with no dice in it.
import { request } from "playwright-core";
import { check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "destructive-wrath",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.wrathTables[viewport];
    const gm = await request.newContext();
    const state = async () => (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const invoke = (name, args) => gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
      const held = await invoke("use_resource", { characterId: table.hero, resource: "Channel Divinity", variant: "destructive wrath" });
      check(held.ok(), `the hold was taken (${held.status()})`);
      await eventually(async () => (await state()).sheets.find((sheet) => sheet.id === table.hero)?.conditions?.includes("destructive wrath"), { timeoutMs: 15_000, label: "the hold on the sheet" });
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the page is not pushed sideways");
      // The hold shows on the party panel.
      if (viewport === "phone") {
        await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Party", exact: true }));
        await untilStill(page);
      }
      await eventually(() => page.getByText(/destructive wrath/i).locator("visible=true").count(), { timeoutMs: 10_000, label: "the hold shown on the page" });
      await t.shot("held");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("held-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

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
      await eventually(async () => !(await state()).sheets.find((sheet) => sheet.id === table.hero)?.conditions?.includes("destructive wrath"), { timeoutMs: 15_000, label: "the hold spent on the hit" });
      const after = await state();
      check(!after.pendingRolls?.some((entry) => entry.kind === "damage"), "no damage roll waits on the lead");
      const goblin = after.encounter?.enemies?.find((enemy) => enemy.id === table.goblin);
      check(before === undefined || !goblin || goblin.currentHp <= before - 1 || goblin.status !== "alive", `the goblin took the damage (${before} to ${goblin?.currentHp})`);
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
