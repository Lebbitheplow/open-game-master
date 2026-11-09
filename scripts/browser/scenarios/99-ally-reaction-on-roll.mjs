// War God's Blessing on another player's roll (src/lib/dm/after-roll.ts): the
// player's fighter swings at a goblin and enters a 9, and the lead, whose cleric
// stands within 30 feet, sees a card with the choice on it. The lead adds it
// from the keyboard, and the +10 turns the miss. The rules are held by
// scripts/test-enforce-ally-reaction-on-roll.mjs; this is what only a page can
// see: a card for the player who did not roll, finger-sized and inside the
// phone's width, by day and by night and in the app shell.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Help Bren Ash\'s roll, or let it stand"]';

const scenario = {
  name: "ally-reaction-on-roll",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.allyTables[viewport];
    const other = await request.newContext();
    const state = async () => (await other.get(`${base}/api/campaigns/${table.id}`)).json();
    try {
      const signed = await other.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const swung = await other.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "pc_attack", args: { characterId: table.roller, targetEnemyId: table.goblin, weapon: "Longsword" } },
      });
      const body = await swung.json().catch(() => ({}));
      check(swung.ok(), `the swing was made (${swung.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      const parked = (await state()).pendingRolls?.find((entry) => entry.kind === "attack");
      check(parked, "the to-hit roll waits for the player's dice");
      const entered = await other.post(`${base}/api/campaigns/${table.id}/pending-rolls/${parked.id}`, { data: { dice: [9] } });
      check(entered.ok(), `the 9 was entered (${entered.status()})`);

      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the card on the lead's screen" });
      const help = choices.getByRole("button", { name: "War God's Blessing: add 10" });
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      const box = await help.boundingBox();
      check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}${GROUP}`);
      check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("help");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("help-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      await help.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the use is spent" });
      const after = await state();
      const cleric = after.sheets.find((sheet) => sheet.id === table.hero);
      check(cleric?.resources?.channel_divinity?.used === 1, `a use of Channel Divinity is spent (${JSON.stringify(cleric?.resources?.channel_divinity)})`);
      check(after.pendingRolls?.some((entry) => entry.kind === "damage") ?? false, "the hit now asks the player for damage");
    } finally {
      await other.dispose();
    }
  },
};

export default scenario;
