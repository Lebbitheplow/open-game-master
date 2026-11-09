// Chronal Shift on another creature's roll, and whose roll a watch stop
// answers (src/lib/dm/chronal-shift.ts, src/lib/dm/foresight.ts). The rules
// are held by scripts/test-enforce-chronal-shift-others.mjs and
// test-enforce-portent.mjs; this is where a player meets them:
//   - the player's fighter fails a check at the seed's Turning Hour, and the
//     lead's Chronurgy wizard is offered the reroll on the lead's own screen,
//     with real data, on the website and in the app;
//   - the watch button reads "Watch for Chronal Shift" for that wizard in a
//     fight the AI GM runs (the Clockwork Watch);
//   - a stop over an area asks whose roll first, for Chronal Shift and for
//     Portent (a stand-in through a browser route, so on the website only:
//     the app's patched fetch bypasses it, and the card is the same component).
// Finger-sized, inside the phone's width, by day and by night, through axe.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "shift-others",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport, api } = t;
    const table = ids.shiftTables[viewport];
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
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
            data: { name: "request_roll", args: { characterId: table.ally, kind: "ability_check", ability: "str", dc: 20, reason: "Lift the gate" } },
          });
          const body = await asked.json().catch(() => ({}));
          if ((body.result ?? body).parked === true) return true;
        }
        return false;
      };
      check(await askUntilParked(), "a failing check of Bran's waits on the table");
      const group = page.locator(`${root}[role="group"][aria-label="Use Chronal Shift on Bran Ostler's roll, or let it stand"]`).locator("visible=true");
      await eventually(() => group.count(), { timeoutMs: 30_000, label: "the wizard's card for Bran's roll" });
      await untilStill(page);
      const shift = group.getByRole("button", { name: "Chronal Shift: make Bran Ostler roll again" });
      const stand = group.getByRole("button", { name: "Let it stand" });
      for (const button of [shift, stand]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}[role="group"][aria-label^="Use Chronal Shift on"]`);
      check(!night.length, `axe on the card at night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("ally-roll");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}[role="group"][aria-label^="Use Chronal Shift on"]`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("ally-roll-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      // From the keyboard: the wizard's reroll, and the roll lands.
      await shift.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await group.count()), { timeoutMs: 15_000, label: "the card gone once Bran rolls again" });
      const after = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      check(!after.pendingRolls?.length, "nothing is left waiting");
      const wizard = after.sheets.find((sheet) => sheet.id === table.wizard);
      check(wizard?.resources?.sub_chronal_shift?.used === 1, `one use of Chronal Shift spent (${JSON.stringify(wizard?.resources?.sub_chronal_shift)})`);

      // Letting it stand lands it and spends nothing.
      check(await askUntilParked(), "another failing check waits");
      await eventually(() => group.count(), { timeoutMs: 30_000, label: "the card again" });
      await t.tap(group.getByRole("button", { name: "Let it stand" }));
      await eventually(async () => !(await group.count()), { timeoutMs: 15_000, label: "the card gone once the roll stands" });
      const left = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      check(left.sheets.find((sheet) => sheet.id === table.wizard)?.resources?.sub_chronal_shift?.used === 1, "letting it stand spent nothing");
    } finally {
      await gm.dispose();
    }

    // ---- The watch button for a Chronurgy wizard, in a fight the AI runs ----
    const fight = ids.chronalWatchTables[viewport];
    await t.open(`/campaigns/${fight.id}`);
    const watch = page.locator(`${root}button`).filter({ hasText: /^\s*Watch(ing)? for Chronal Shift\s*$/ }).locator("visible=true").first();
    if (!(await eventually(() => watch.count(), { timeoutMs: 8_000 }).catch(() => 0))) {
      const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true");
      if (await tab.count()) await t.tap(tab.first());
    }
    await eventually(() => watch.count(), { timeoutMs: 30_000, label: "the Watch for Chronal Shift button" });
    await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
    await untilStill(page);
    check((await watch.getAttribute("aria-pressed")) === "false", "the button starts off");
    check(((await watch.boundingBox())?.height ?? 0) >= 40, "a finger-sized button");
    await t.tap(watch);
    await eventually(async () => (await watch.getAttribute("aria-pressed")) === "true", { timeoutMs: 15_000, label: "the button on" });
    check(/Watching for Chronal Shift/.test(await watch.innerText()), "its words say it is on");
    await t.shot("chronal-watch-on");
    await t.tap(watch);
    await eventually(async () => (await watch.getAttribute("aria-pressed")) === "false", { timeoutMs: 15_000, label: "the button off" });

    // ---- A stop over an area: whose roll, first (website only) ----
    if (t.app) return;
    const snapshot = await (await api.get(`${base}/api/campaigns/${fight.id}`)).json();
    const sheet = snapshot.sheets.find((entry) => entry.id === fight.hero);
    const line = "2 creatures are about to make saving throws against Fireball.";
    const stop = (power) => ({
      id: `stop-${power}`,
      userId: snapshot.me.id,
      characterId: sheet.id,
      kind: "custom",
      detail: line,
      expression: "1d20",
      advantage: "none",
      dc: null,
      reason: line,
      createdAt: new Date().toISOString(),
      parkedFor: "watch",
      thrown: null,
      watch: {
        line,
        deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        power,
        choices: [
          { name: "Goblin 1", when: "if it succeeds" },
          { name: "Bran Ostler", when: "if it fails" },
        ],
      },
    });
    let shown = stop("chronal_shift");
    await page.route(new RegExp(`/api/campaigns/${fight.id}(\\?|$)`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.pendingRolls = [shown];
      body.sheets = body.sheets.map((entry) => (entry.id === sheet.id && shown.watch.power === "portent" ? { ...entry, resources: { ...entry.resources, sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] } : entry));
      await route.fulfill({ response, json: body });
    });
    const sent = [];
    await page.route(/\/watch$/, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    try {
      await t.open(`/campaigns/${fight.id}`);
      const whose = page.locator(`${root}[role="radiogroup"][aria-label="Whose roll it answers"]`).locator("visible=true");
      if (!(await eventually(() => whose.count(), { timeoutMs: 5_000 }).catch(() => 0))) {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      await eventually(() => whose.count(), { timeoutMs: 30_000, label: "the whose-roll picker" });
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      const again = page.locator(`${root}button`).filter({ hasText: /^\s*Roll it again/ }).locator("visible=true").first();
      check(await again.isDisabled(), "nothing to send until a creature is picked");
      const bran = whose.getByRole("radio", { name: "Bran Ostler" });
      check((await bran.getAttribute("aria-checked")) === "false", "no creature picked at first");
      check(((await bran.boundingBox())?.height ?? 0) >= 40, "a finger-sized pick");
      await t.shot("whose-roll");
      await bran.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => (await bran.getAttribute("aria-checked")) === "true", { timeoutMs: 5_000, label: "Bran picked from the keyboard" });
      check(/Roll it again if it fails/.test(await again.innerText()), `the button says when it rolls again (${await again.innerText()})`);
      const axe = await axeViolations(page, `${root}.session-compose-notices`);
      check(!axe.length, `axe on the stop: ${axe.map((entry) => entry.id).join(", ")}`);
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const axeDay = await axeViolations(page, `${root}.session-compose-notices`);
      check(!axeDay.length, `axe on the stop by day: ${axeDay.map((entry) => entry.id).join(", ")}`);
      await t.shot("whose-roll-picked-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the stop does not push the page sideways");
      await t.tap(again);
      await eventually(() => sent.length, { label: "the shift sent" });
      check(sent[0].shift === true && sent[0].choice === 1, `the shift names whose roll (${JSON.stringify(sent[0])})`);

      // Portent over the same area: the creature, then the number.
      shown = stop("portent");
      await t.open(`/campaigns/${fight.id}`);
      // A phone may open on the fight's board: the stop is on the Table tab.
      if (!(await eventually(() => whose.count(), { timeoutMs: 5_000 }).catch(() => 0))) {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      await eventually(() => whose.count(), { timeoutMs: 30_000, label: "the picker for Portent" });
      const seventeen = page.locator(`${root}button`).filter({ hasText: /^\s*Use the 17\s*$/ }).locator("visible=true").first();
      check(await seventeen.isDisabled(), "a number waits on a creature");
      await t.tap(whose.getByRole("radio", { name: "Goblin 1" }));
      await t.tap(seventeen);
      await eventually(() => sent.length > 1, { label: "the number sent" });
      check(sent[1].value === 17 && sent[1].choice === 0, `the number names whose save (${JSON.stringify(sent[1])})`);
    } finally {
      await page.unroute(new RegExp(`/api/campaigns/${fight.id}(\\?|$)`));
      await page.unroute(/\/watch$/);
    }
  },
};

export default scenario;
