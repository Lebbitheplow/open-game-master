// One account holding both the roller and the helper on an after-the-roll
// card (play-test 2026-11-09, W-08): the lead plays a fighter and the
// Chronurgy wizard beside him. A failing check of the fighter's waits on the
// lead's screen as the roller; "Keep this roll" leaves it waiting on the
// wizard, and that same screen must now offer the wizard's "Let it stand" as
// well as the reroll, with the clock still running while the GM's screen is
// open beside it. Before, the kept card showed only the reroll and the roll
// stayed pending. The card's words are held by scripts/test-after-roll-card.mjs;
// this is the real roll landing. Finger-sized, inside the phone's width, by
// day and by night, through axe.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "after-roll-same-account",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.twoHandsTables[viewport];
    // The table is the player's to run: the GM's calls go out as them.
    const gm = await request.newContext();
    const watching = new AbortController();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      // The GM's own screen is open on the table: the roll's clock runs only
      // while someone besides its roller is there to be held up.
      const cookie = (await gm.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
      const stream = await fetch(`${base}/api/campaigns/${table.id}/events`, { headers: { cookie }, signal: watching.signal });
      check(stream.ok, `the GM's stream opened (${stream.status})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      // The fighter's Strength check against DC 20: it fails most throws, and
      // one that succeeds simply lands, so the GM asks again.
      const askUntilParked = async () => {
        for (let tries = 0; tries < 12; tries += 1) {
          const asked = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
            data: { name: "request_roll", args: { characterId: table.roller, kind: "ability_check", ability: "str", dc: 20, reason: "Lift the gate" } },
          });
          const body = await asked.json().catch(() => ({}));
          if ((body.result ?? body).parked === true) return true;
        }
        return false;
      };
      check(await askUntilParked(), "a failing check of Wren's waits on the table");

      const choices = page.locator(`${root}[role="group"][aria-label="Change this roll, or keep it"]`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the roller's card" });
      await untilStill(page);
      check(await choices.getByRole("button", { name: "Chronal Shift: make Wren Ashby roll again" }).count(), "the lead's wizard is offered the reroll on the lead's own roll");
      check(!(await choices.getByRole("button", { name: "Let it stand" }).count()), "the roller keeps the roll first");
      await t.tap(choices.getByRole("button", { name: "Keep this roll" }));

      // Kept: the roll now waits on the wizard alone, on this same screen.
      const helping = `${root}[role="group"][aria-label="Use Chronal Shift on Wren Ashby's roll, or let it stand"]`;
      const kept = page.locator(helping).locator("visible=true");
      await eventually(() => kept.count(), { timeoutMs: 15_000, label: "the kept card with the wizard's choice" });
      await untilStill(page);
      check(await page.getByText("You kept this roll.").locator("visible=true").count(), "the card says the roll was kept");
      const shift = kept.getByRole("button", { name: "Chronal Shift: make Wren Ashby roll again" });
      const stand = kept.getByRole("button", { name: "Let it stand" });
      check(await stand.count(), "the wizard can let the kept roll stand (W-08)");
      for (const button of [shift, stand]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await kept.getByText(/^The roll stands in \d+s$/).count(), "the kept card still counts down to when the roll stands");
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, helping);
      check(!night.length, `axe on the kept card at night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("kept");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, helping);
      check(!day.length, `axe on the kept card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("kept-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: letting it stand lands the roll and spends nothing.
      await stand.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await kept.count()) && !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the roll stands" });
      const after = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      check(!after.pendingRolls?.length, "nothing is left waiting");
      const wizard = after.sheets.find((sheet) => sheet.id === table.wizard);
      check(!wizard?.resources?.sub_chronal_shift?.used, `letting it stand spent no Chronal Shift (${JSON.stringify(wizard?.resources?.sub_chronal_shift)})`);
    } finally {
      watching.abort();
      await gm.dispose();
    }
  },
};

export default scenario;
