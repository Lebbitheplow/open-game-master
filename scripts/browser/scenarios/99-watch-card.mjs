// Watching a fight for Portent (src/lib/dm/foresight.ts), and an artificer's
// stop for Flash of Genius on an ally's save: the button stands in
// the fight for a character who holds a number, at a table whose turns the AI
// GM plays, and the stop before a roll shows those numbers and sends what it
// says. The rules are held by scripts/test-enforce-portent.mjs; this is the
// button and the card where a player meets them, at phone width, by day and
// by night, on the website and in the app.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "watch-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, ids, api } = t;

    // ---- The button, for real: a seeded fight the AI GM runs ----
    const table = ids.watchTables[t.viewport];
    await t.open(`/campaigns/${table.id}`);
    const watch = page.locator(`${root}button`).filter({ hasText: /^\s*Watch(ing)? for Portent\s*$/ }).locator("visible=true").first();
    if (!(await eventually(() => watch.count(), { timeoutMs: 8_000 }).catch(() => 0))) {
      const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true");
      if (await tab.count()) await t.tap(tab.first());
    }
    await eventually(() => watch.count(), { timeoutMs: 30_000, label: "the Watch for Portent button" });
    await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
    await untilStill(page);
    check((await watch.getAttribute("aria-pressed")) === "false", "the button starts off, and says so");
    const watchBox = await watch.boundingBox();
    check((watchBox?.height ?? 0) >= 40, `a finger-sized button (${watchBox?.height}px)`);
    await watch.focus();
    await page.keyboard.press("Enter");
    await eventually(async () => (await watch.getAttribute("aria-pressed")) === "true", { timeoutMs: 15_000, label: "the button turned on from the keyboard" });
    check(/Watching for Portent/.test(await watch.innerText()), "its words say it is on");
    const night = await axeViolations(page, `${root}.session-compose-notices`);
    check(!night.length, `axe on the button at night: ${night.map((entry) => entry.id).join(", ")}`);
    await t.shot("button-on");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = await axeViolations(page, `${root}.session-compose-notices`);
    check(!day.length, `axe on the button by day: ${day.map((entry) => entry.id).join(", ")}`);
    await t.shot("button-on-day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await t.tap(watch);
    await eventually(async () => (await watch.getAttribute("aria-pressed")) === "false", { timeoutMs: 15_000, label: "the button turned off" });
    const snapshot0 = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
    check(!snapshot0.sheets.find((entry) => entry.id === table.hero)?.watchingEncounterId, "off on the server too");

    // ---- The stop's card: a stand-in through a browser route, which the
    // app's patched fetch bypasses, so on the website only. The card is the
    // same component in the app. ----
    if (t.app) return;
    const snapshot = await (await api.get(`${base}/api/campaigns/${ids.campaignId}`)).json();
    const sheet = snapshot.sheets.find((entry) => entry.userId === snapshot.me.id) ?? snapshot.sheets[0];
    const line = "Goblin 1 is about to attack Bree Underbough.";
    const pending = {
      id: "watch-stand-in",
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
      watch: { line, deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
    };
    await page.route(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.pendingRolls = [pending];
      body.sheets = body.sheets.map((entry) => (entry.id === sheet.id ? { ...entry, resources: { ...entry.resources, sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] } : entry));
      await route.fulfill({ response, json: body });
    });
    const sent = [];
    await page.route(/\/watch$/, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    try {
      await t.open(`/campaigns/${ids.campaignId}`);
      const number = page.locator(`${root}button`).filter({ hasText: /^\s*Use the 17\s*$/ }).locator("visible=true");
      // A phone may open on the turn's board: the card is on the Table tab.
      if (!(await eventually(() => number.count(), { timeoutMs: 5_000 }).catch(() => 0))) {
        const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      await eventually(() => number.count(), { timeoutMs: 30_000, label: "the foretold 17" });
      // The fight's opening splash plays over the table on a fresh load; the
      // card is shot once it has gone.
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      const toggle = page.locator(`${root}button`).filter({ hasText: /Watch(ing)? for Portent/ }).locator("visible=true");
      await t.shot("stop");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.style.colorScheme = "light";
      });
      // The theme fades across: shot once the colours have landed.
      await untilStill(page);
      await t.shot("stop-day");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.colorScheme = "dark";
      });
      check(await toggle.count(), "the button stands in the fight");
      check((await toggle.first().getAttribute("aria-pressed")) !== null, "the button says whether it is on");
      const box = await number.first().boundingBox();
      check((box?.height ?? 0) >= 40, `a finger-sized number (${box?.height}px)`);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check(fits, "the card does not push the page sideways");
      const cardAxe = await axeViolations(page, `${root}[role="group"][aria-label="Use a number Portent foretold, or let it roll"]`);
      check(!cardAxe.length, `axe on the card: ${cardAxe.map((entry) => entry.id).join(", ")}`);
      await t.tap(number.first());
      await eventually(() => sent.length, { label: "the choice sent" });
      check(sent[0].value === 17, `the number sends itself (${JSON.stringify(sent[0])})`);
    } finally {
      await page.unroute(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`));
      await page.unroute(/\/watch$/);
    }

    // ---- An artificer's stop: Flash of Genius on an ally's save that the
    // call throws (chronal-shift.ts takeSaveHelp), as a stand-in the same way.
    const saveLine = "Bree Underbough is about to make a saving throw against a poison needle.";
    const flashStop = { ...pending, id: "flash-stand-in", detail: saveLine, reason: saveLine, watch: { line: saveLine, deadline: pending.watch.deadline, power: "flash_of_genius", choices: [{ name: "Bree Underbough", when: "if it fails" }] } };
    await page.route(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.pendingRolls = [flashStop];
      body.sheets = body.sheets.map((entry) =>
        entry.id === sheet.id
          ? { ...entry, foretold: [], abilities: { ...entry.abilities, int: 16 }, features: [...(entry.features ?? []), { name: "Flash of Genius", description: "" }], resources: { ...entry.resources, art_flash_of_genius: { max: 3, used: 0 } } }
          : entry,
      );
      await route.fulfill({ response, json: body });
    });
    const asked = [];
    await page.route(/\/watch$/, async (route) => {
      asked.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    try {
      await t.open(`/campaigns/${ids.campaignId}`);
      const add = page.locator(`${root}button`).filter({ hasText: /^\s*Add 3 if it fails\s*$/ }).locator("visible=true");
      if (!(await eventually(() => add.count(), { timeoutMs: 5_000 }).catch(() => 0))) {
        const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      await eventually(() => add.count(), { timeoutMs: 30_000, label: "Flash of Genius's Add 3 if it fails" });
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      check(await page.locator(`${root}button`).filter({ hasText: /^\s*Watch(ing)? for Flash of Genius\s*$/ }).locator("visible=true").count(), "the artificer's button names Flash of Genius");
      const box = await add.first().boundingBox();
      check((box?.height ?? 0) >= 40, `a finger-sized choice (${box?.height}px)`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const group = `${root}[role="group"][aria-label="Use Flash of Genius on this roll, or let it roll"]`;
      const nightAxe = await axeViolations(page, group);
      check(!nightAxe.length, `axe on the Flash of Genius card: ${nightAxe.map((entry) => entry.id).join(", ")}`);
      await t.shot("flash-stop");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.style.colorScheme = "light";
      });
      await untilStill(page);
      const dayAxe = await axeViolations(page, group);
      check(!dayAxe.length, `axe on the Flash of Genius card by day: ${dayAxe.map((entry) => entry.id).join(", ")}`);
      await t.shot("flash-stop-day");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.colorScheme = "dark";
      });
      // From the keyboard: the choice is "if it fails", sent as the stop's shift.
      await add.first().focus();
      await page.keyboard.press("Enter");
      await eventually(() => asked.length, { label: "the Flash of Genius choice sent" });
      check(asked[0].shift === true, `the choice sends itself (${JSON.stringify(asked[0])})`);
    } finally {
      await page.unroute(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`));
      await page.unroute(/\/watch$/);
    }
  },
};
