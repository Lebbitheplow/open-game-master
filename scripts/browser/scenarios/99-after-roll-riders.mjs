// Guided Strike, Master Duelist and Favored by the Gods on the after-the-roll
// card (src/lib/dm/after-roll-logic.ts afterAttackOptions): the GM's seat makes
// the lead's hero swing at a goblin, the lead enters a 10 on their real dice,
// and the miss waits with all three on offer. The lead adds Guided Strike from
// the keyboard, and the +10 turns the miss into a hit. The rules are held by
// scripts/test-enforce-after-roll-riders.mjs; this is what only a page can see:
// the three longer labels on the card, finger-sized, inside the phone's width,
// by day and by night and in the app shell.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "after-roll-riders",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.afterRiderTables[viewport];
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const swung = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "pc_attack", args: { characterId: table.hero, targetEnemyId: table.goblin, weapon: "Longsword" } },
      });
      const body = await swung.json().catch(() => ({}));
      check(swung.ok(), `the swing was made (${swung.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      // The lead's real d20 shows a 10, entered as their card would send it.
      const parked = (await (await gm.get(`${base}/api/campaigns/${table.id}`)).json()).pendingRolls?.find((entry) => entry.kind === "attack");
      check(parked, "the to-hit roll waits for the lead's dice");
      const entered = await page.evaluate(
        async ({ campaignId, id }) => (await fetch(`/api/campaigns/${campaignId}/pending-rolls/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dice: [10] }) })).status,
        { campaignId: table.id, id: parked.id },
      );
      check(entered === 200, `the 10 was entered (${entered})`);

      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the after-the-roll card on the attack" });
      const guided = choices.getByRole("button", { name: "Guided Strike: add 10" });
      const duelist = choices.getByRole("button", { name: "Master Duelist: roll again with advantage" });
      const favored = choices.getByRole("button", { name: "Favored by the Gods: add 2d4" });
      const keep = choices.getByRole("button", { name: "Keep this roll" });
      // The fight's opening splash plays over the table on a fresh load; the
      // card is shot once it has gone.
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      for (const button of [guided, duelist, favored, keep]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}${GROUP}`);
      check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("riders");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("riders-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: the +10 turns the miss, and the card goes.
      await guided.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the hit lands" });
      const snapshot = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      const hero = snapshot.sheets.find((sheet) => sheet.id === table.hero);
      check(hero?.resources?.channel_divinity?.used === 1, `a use of Channel Divinity is spent (${JSON.stringify(hero?.resources?.channel_divinity)})`);
      check(hero?.resources?.sub_master_duelist?.used === 0, "Master Duelist is untouched");
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
