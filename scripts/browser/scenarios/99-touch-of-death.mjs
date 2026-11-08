// Touch of Death on the after-the-roll card (src/lib/dm/after-roll-logic.ts
// afterAttackOptions): the one choice that waits on a hit. The GM's seat makes
// the lead's cleric swing at a goblin, the lead enters a 19 on their real dice,
// and the hit waits with the choice on offer. The lead adds it from the
// keyboard. The rules are held by scripts/test-enforce-touch-of-death.mjs; this
// is what only a page can see: the card says the attack hit, not that it
// missed, finger-sized and inside the phone's width, by day and by night and in
// the app shell.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "touch-of-death",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.touchTables[viewport];
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
      // The lead's real d20 shows a 19, entered as their card would send it.
      const parked = (await (await gm.get(`${base}/api/campaigns/${table.id}`)).json()).pendingRolls?.find((entry) => entry.kind === "attack");
      check(parked, "the to-hit roll waits for the lead's dice");
      const entered = await page.evaluate(
        async ({ campaignId, id }) => (await fetch(`/api/campaigns/${campaignId}/pending-rolls/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dice: [19] }) })).status,
        { campaignId: table.id, id: parked.id },
      );
      check(entered === 200, `the 19 was entered (${entered})`);

      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the after-the-roll card on the hit" });
      const touch = choices.getByRole("button", { name: "Touch of Death: add 11 necrotic" });
      const keep = choices.getByRole("button", { name: "Keep this roll" });
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      check(await page.getByText("The attack hits. You can add to its damage.").locator("visible=true").count(), "the card says the attack hit");
      for (const button of [touch, keep]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}${GROUP}`);
      check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("touch");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("touch-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: the use is spent, and the card goes.
      await touch.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the hit lands" });
      const snapshot = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      const hero = snapshot.sheets.find((sheet) => sheet.id === table.hero);
      check(hero?.resources?.channel_divinity?.used === 1, `a use of Channel Divinity is spent (${JSON.stringify(hero?.resources?.channel_divinity)})`);
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
