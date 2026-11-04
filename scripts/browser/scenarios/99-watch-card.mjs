// Watching a fight for Portent (src/lib/dm/foresight.ts): the button stands in
// the fight for a character who holds a number, and the stop before a roll
// shows those numbers and sends what it says. The rules are held by
// scripts/test-enforce-portent.mjs; this is the button and the card where a
// player meets them, at phone width.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "watch-card",
  viewports: ["desktop", "phone"],
  // The stand-in is a browser-level route, which the app's patched fetch
  // bypasses.
  app: false,
  async run(t) {
    const { page, base, root, ids, api } = t;
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
      await t.tap(number.first());
      await eventually(() => sent.length, { label: "the choice sent" });
      check(sent[0].value === 17, `the number sends itself (${JSON.stringify(sent[0])})`);
    } finally {
      await page.unroute(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`));
      await page.unroute(/\/watch$/);
    }
  },
};
