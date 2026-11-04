// Portent's numbers (src/lib/dm/foretold-logic.ts) on a real parked roll: the
// GM's seat asks the lead's hero, a Divination wizard holding a 17 and a 3, for
// a check, and the lead puts a number on it from the keyboard. The rules behind
// the card are held by scripts/test-enforce-portent.mjs; this is what only a
// page can see: the numbers where a parked roll stands, finger-sized, inside
// the phone's width, in the day and night themes and in the app shell.
import { request } from "playwright-core";
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Use a number Portent foretold"]';

const scenario = {
  name: "portent-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.portentTables[viewport];
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
        data: { name: "request_roll", args: { characterId: table.hero, kind: "ability_check", ability: "int", dc: 15, reason: "Read the runes" } },
      });
      const body = await asked.json().catch(() => ({}));
      check(asked.ok() && (body.result ?? body).parked === true, `the check waits unthrown (${asked.status()}): ${JSON.stringify(body).slice(0, 200)}`);

      const numbers = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => numbers.count(), { timeoutMs: 30_000, label: "the foretold numbers" });
      const seventeen = numbers.getByRole("button", { name: "Use the 17" });
      const three = numbers.getByRole("button", { name: "Use the 3" });
      const roll = page.locator(`${root}button`).filter({ hasText: /^\s*Roll now\s*$/ }).locator("visible=true");
      await untilStill(page);
      check(await roll.count(), "the player can still roll instead");
      for (const button of [seventeen, three]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const found = await axeViolations(page, `${root}${GROUP}`);
      check(!found.length, `axe on the numbers: ${found.map((entry) => entry.id).join(", ")}`);
      await t.shot("numbers");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the numbers by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("numbers-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: the number lands, and the card goes.
      await seventeen.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await numbers.count()), { timeoutMs: 15_000, label: "the card gone once the roll lands" });

      const snapshot = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      check(!snapshot.pendingRolls?.length, "nothing is left waiting");
      const hero = snapshot.sheets.find((sheet) => sheet.id === table.hero);
      check(JSON.stringify(hero?.foretold) === "[3]", `the 17 is gone and the 3 stays (${JSON.stringify(hero?.foretold)})`);
      check(hero?.resources?.sub_portent?.used === 1, `one use spent (${JSON.stringify(hero?.resources?.sub_portent)})`);

      // The sheet lists what is left.
      await openPanelTab(t, "party");
      const card = page.locator(`${root}[data-party-card="${table.hero}"]`).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the hero's party card" });
      await untilStill(page);
      await t.tap(card.getByRole("button", { name: `Options for ${hero.name}` }));
      await t.tap(page.getByRole("menuitem", { name: "View sheet" }));
      const dialog = page.getByRole("dialog").filter({ hasText: hero.name }).first();
      await eventually(() => dialog.count(), { label: "the hero's sheet" });
      const line = dialog.getByText("Foretold rolls: 3", { exact: true });
      await eventually(() => line.count(), { timeoutMs: 15_000, label: "the foretold line on the sheet" });
      await line.scrollIntoViewIfNeeded();
      await untilStill(page);
      await t.shot("sheet");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("sheet-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
