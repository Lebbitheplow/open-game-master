// The after-the-roll card (src/lib/dm/after-roll-logic.ts): the player sees
// the dice, and their choice goes to the server. The rules behind the card are
// held by scripts/test-enforce-after-roll.mjs; this is what no render without
// effects can see: the card standing where a parked roll stands, at phone
// width, and its buttons sending what they say.
import { check, eventually, untilStill } from "../lib.mjs";

const outcome = (total) => ({
  expression: "1d20+3",
  total,
  natural: total - 3,
  terms: [
    { kind: "dice", sign: 1, count: 1, sides: 20, dice: [{ sides: 20, value: total - 3, kept: true }], subtotal: total - 3 },
    { kind: "modifier", sign: 1, value: 3 },
  ],
});

export default {
  name: "after-roll",
  viewports: ["desktop", "phone"],
  // The stand-in is a browser-level route, which the app's patched fetch
  // bypasses.
  app: false,
  async run(t) {
    const { page, base, root, ids, api } = t;
    const snapshot = await (await api.get(`${base}/api/campaigns/${ids.campaignId}`)).json();
    const sheet = snapshot.sheets.find((entry) => entry.userId === snapshot.me.id) ?? snapshot.sheets[0];
    const pending = {
      id: "after-roll-stand-in",
      userId: snapshot.me.id,
      characterId: sheet.id,
      kind: "ability_check",
      detail: "str",
      expression: "1d20+3",
      advantage: "none",
      dc: 15,
      reason: "Lift the gate",
      createdAt: new Date().toISOString(),
      thrown: {
        outcome: outcome(12),
        options: [
          { id: "lucky", label: "Lucky", note: "Spend a luck point: roll another d20, then choose which die counts." },
          { id: "bardic", label: "Bardic Inspiration (d8)", note: "Spend your Bardic Inspiration die: add 1d8 to this roll." },
        ],
        choosing: false,
        landing: { status: "fallback", physical: false, source: "digital" },
      },
    };
    await page.route(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.pendingRolls = [pending];
      await route.fulfill({ response, json: body });
    });
    const sent = [];
    await page.route(/\/after-roll$/, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    try {
      await t.open(`/campaigns/${ids.campaignId}`);
      const lucky = page.locator(`${root}button`).filter({ hasText: /^\s*Lucky\s*$/ }).locator("visible=true");
      // A phone may open on the turn's board: the card is on the Table tab.
      if (!(await eventually(() => lucky.count(), { timeoutMs: 5_000 }).catch(() => 0))) {
        const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      await eventually(() => lucky.count(), { timeoutMs: 30_000, label: "the Lucky button" });
      await untilStill(page);
      await t.shot("options");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.style.colorScheme = "light";
      });
      await t.shot("options-day");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.colorScheme = "dark";
      });
      const box = await lucky.first().boundingBox();
      check((box?.height ?? 0) >= 36, `a button a thumb can press (${box?.height}px)`);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check(fits, "the card does not push the page sideways");
      await t.tap(lucky.first());
      await eventually(() => sent.length, { label: "the choice sent" });
      check(sent[0].use === "lucky", `the button sends its choice (${JSON.stringify(sent[0])})`);
    } finally {
      await page.unroute(new RegExp(`/api/campaigns/${ids.campaignId}(\\?|$)`));
      await page.unroute(/\/after-roll$/);
    }
  },
};
