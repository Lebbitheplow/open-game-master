// The after-the-roll card (src/lib/dm/after-roll-logic.ts) on a real parked
// roll: the GM's seat asks the lead's hero, who holds the Lucky feat, for a
// check with no Difficulty Class (which always asks), and the lead answers
// the card from the keyboard. The rules behind the card are held by
// scripts/test-enforce-after-roll.mjs; this is what only a page can see: the
// card where a parked roll stands, finger-sized, inside the phone's width, in
// the day and night themes and in the app shell, and the turn going on.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "after-roll",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.afterRollTables[viewport];
    // The table is the player's to run: the GM's calls go out as them.
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const asked = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "request_roll", args: { characterId: table.hero, kind: "ability_check", ability: "str", reason: "Lift the gate" } },
      });
      const body = await asked.json().catch(() => ({}));
      check(asked.ok() && (body.result ?? body).parked === true, `the check waits on the card (${asked.status()}): ${JSON.stringify(body).slice(0, 200)}`);

      const choices = page.locator(`${root}[role="group"][aria-label="Change this roll, or keep it"]`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the after-the-roll card" });
      const lucky = choices.getByRole("button", { name: "Lucky: roll another d20" });
      const keep = choices.getByRole("button", { name: "Keep this roll" });
      await untilStill(page);
      for (const button of [lucky, keep]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const found = await axeViolations(page, `${root}[role="group"][aria-label="Change this roll, or keep it"]`);
      check(!found.length, `axe on the card: ${found.map((entry) => entry.id).join(", ")}`);
      await t.shot("options");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}[role="group"][aria-label="Change this roll, or keep it"]`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("options-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: the point is spent and the two d20s are offered.
      await lucky.focus();
      await page.keyboard.press("Enter");
      const dice = page.locator(`${root}[role="group"][aria-label="Choose which die counts"]`).locator("visible=true").getByRole("button");
      await eventually(async () => (await dice.count()) === 2, { timeoutMs: 15_000, label: "the two d20s to choose from" });
      const die = dice.first();
      check(/^Use the \d+ \(total -?\d+\)$/.test((await die.innerText()).trim()), `a die says what it keeps (${await die.innerText()})`);
      check(((await die.boundingBox())?.height ?? 0) >= 40, "a die button a finger can press");
      await t.shot("dice");
      await die.focus();
      await page.keyboard.press("Enter");
      // No Difficulty Class: a point is still left, so the card asks again;
      // keeping the roll lands it and the card goes.
      await eventually(() => keep.count(), { timeoutMs: 15_000, label: "the card back on its options" });
      await keep.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()) && !(await dice.count()), { timeoutMs: 15_000, label: "the card gone once the roll lands" });

      const snapshot = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      check(!snapshot.pendingRolls?.length, "nothing is left waiting");
      const hero = snapshot.sheets.find((sheet) => sheet.id === table.hero);
      check(hero?.resources?.luck_points?.used === 1, `one luck point spent (${JSON.stringify(hero?.resources?.luck_points)})`);
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
