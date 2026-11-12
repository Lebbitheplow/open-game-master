// Cosmic Omen before the roll, out of a fight (the maintainer's ruling on
// issue #908, src/lib/dm/before-roll-logic.ts): the lead's Circle of Stars
// druid holds Weal, so the Watch toggle stands for her with no fight on, and
// her own check waits before the throw with a "Before you roll" button that
// puts the omen's d6 on it. The rules are held by
// scripts/test-enforce-before-roll.mjs; this is the toggle and the button
// where a player meets them: finger-sized, inside a phone's width, by day and
// by night, on the website and in the app.
import { request } from "playwright-core";
import { axeViolations, check, eventually, seeAllTours, untilStill } from "../lib.mjs";

export default {
  name: "before-roll",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, ids, api, viewport } = t;
    const table = ids.starTables[viewport];
    const other = await request.newContext();
    try {
      const signed = await other.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the steering player signed in (${signed.status()})`);
      await seeAllTours(other, base);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      const state = async () => (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      const both = async (name) => {
        const night = await axeViolations(page, `${root}.session-compose-notices`);
        check(!night.length, `axe at night: ${night.map((entry) => entry.id).join(", ")}`);
        await t.shot(name);
        await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
        await untilStill(page);
        const day = await axeViolations(page, `${root}.session-compose-notices`);
        check(!day.length, `axe by day: ${day.map((entry) => entry.id).join(", ")}`);
        await t.shot(`${name}-day`);
        await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing pushes the page sideways");
      };

      // ---- The Watch toggle with no fight on ----
      const watch = page.locator(`${root}button`).filter({ hasText: /^\s*Watch(ing)? for Cosmic Omen\s*$/ }).locator("visible=true").first();
      await eventually(() => watch.count(), { timeoutMs: 30_000, label: "the Watch for Cosmic Omen button out of a fight" });
      await untilStill(page);
      check((await watch.getAttribute("aria-pressed")) === "false", "the button starts off, and says so");
      check(((await watch.boundingBox())?.height ?? 0) >= 40, "a finger-sized button");
      check(/check or save an ally makes/.test((await watch.getAttribute("title")) ?? ""), "its hint says what it stops for out of a fight");
      await watch.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => (await watch.getAttribute("aria-pressed")) === "true", { timeoutMs: 15_000, label: "the button turned on from the keyboard" });
      check((await state()).sheets.find((entry) => entry.id === table.hero)?.watchingEncounterId === "table", "on for the table on the server");
      await both("toggle-on");
      await t.tap(watch);
      await eventually(async () => (await watch.getAttribute("aria-pressed")) === "false", { timeoutMs: 15_000, label: "the button turned off" });

      // ---- The druid's own check, held before the throw ----
      const asked = await other.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "request_roll", args: { characterId: table.hero, kind: "ability_check", ability: "wis", dc: 12, reason: "the stars" } },
      });
      check(asked.ok(), `the check was asked for (${asked.status()})`);
      const group = page.locator(`${root}[role="group"][aria-label="Before you roll"]`).locator("visible=true");
      await eventually(() => group.count(), { timeoutMs: 30_000, label: "the Before you roll buttons" });
      await untilStill(page);
      const weal = group.getByRole("button", { name: "Cosmic Omen (Weal): add 1d6" });
      check(((await weal.boundingBox())?.height ?? 0) >= 40, "a finger-sized omen button");
      await both("hold");
      await weal.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await group.count()), { timeoutMs: 15_000, label: "the button gone once used" });
      const after = await state();
      const parked = after.pendingRolls?.find((entry) => entry.characterId === table.hero);
      check(/\+1d6$/.test(parked?.expression ?? ""), `the d6 rides the check (${parked?.expression})`);
      check(after.sheets.find((entry) => entry.id === table.hero)?.resources?.sub_cosmic_omen?.used === 1, "one use spent");
      await t.shot("hold-used");
    } finally {
      await other.dispose();
    }
  },
};
