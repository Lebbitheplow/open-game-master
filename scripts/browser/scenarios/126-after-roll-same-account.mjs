// One account holding both the roller and the helper on an after-the-roll
// card (play-test 2026-11-09, W-08): the lead plays a fighter and the
// Chronurgy wizard beside him. A failing check of the fighter's waits on the
// lead's screen with the wizard's reroll beside "Keep this roll"; the keep is
// the wizard's answer too, so the roll lands. Before, it went on waiting on
// the wizard, and the kept card had no way to let it stand. The clock runs
// while the GM's screen is open beside it, and each button names it. The
// card's words are held by scripts/test-after-roll-card.mjs and the route by
// scripts/test-enforce-chronal-shift-others.mjs; this is the real roll
// landing. Finger-sized, inside the phone's width, by day and by night,
// through axe.
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

      const group = `${root}[role="group"][aria-label="Change this roll, or keep it"]`;
      const choices = page.locator(group).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the roller's card" });
      await untilStill(page);
      const shift = choices.getByRole("button", { name: "Chronal Shift: make Wren Ashby roll again" });
      const keep = choices.getByRole("button", { name: "Keep this roll" });
      check(await shift.count(), "the lead's wizard is offered the reroll on the lead's own roll");
      check(await keep.count(), "and the roller's keep beside it");
      for (const button of [shift, keep]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await choices.getByText(/^The roll stands in \d+s$/).count(), "the card counts down to when the roll stands");
      // The clock is no live region: each choice names it, so the time left
      // is heard as the keyboard reaches the button.
      const described = await keep.evaluate((node) => document.getElementById(node.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
      check(/^The roll stands in \d+s$/.test(described), `Keep this roll is described by the clock (${described})`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      if (viewport === "phone") {
        // The harness's phone is 412px wide; a small phone is 375px.
        const size = page.viewportSize();
        await page.setViewportSize({ width: 375, height: size.height });
        await untilStill(page);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nor on a 375px phone");
        for (const button of [shift, keep]) {
          const box = await button.boundingBox();
          check((box?.height ?? 0) >= 40 && (box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 375, `a whole finger-sized button at 375px (${JSON.stringify(box)})`);
        }
        await page.setViewportSize(size);
        await untilStill(page);
      }
      const night = await axeViolations(page, group);
      check(!night.length, `axe on the card at night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("card");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, group);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("card-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: the keep is the wizard's answer too, as both sat
      // on this one card, so the roll lands at once and spends nothing.
      // Before, it went on waiting on the wizard with no way to let it stand.
      await keep.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await choices.count()) && !(await page.getByText("You kept this roll.").locator("visible=true").count()), { timeoutMs: 15_000, label: "the card gone once the roll is kept" });
      const after = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      check(!after.pendingRolls?.length, "nothing is left waiting");
      const wizard = after.sheets.find((sheet) => sheet.id === table.wizard);
      check(!wizard?.resources?.sub_chronal_shift?.used, `keeping the roll spent no Chronal Shift (${JSON.stringify(wizard?.resources?.sub_chronal_shift)})`);
    } finally {
      watching.abort();
      await gm.dispose();
    }
  },
};

export default scenario;
