// A pointer move held for a watch stop (src/lib/dm/turn-hold.ts): the lead's
// fighter ends a turn that brings her save against a hold, while the player's
// Divination wizard watches the fight. The End Turn is in at once, and every
// End Turn control says the turn is ending and waits (the round's banner, the
// board's corner, the Hand's card), with a status line a screen reader hears,
// by day and by night; once the wizard answers, the turn passes and the
// controls come back as they were. The rules are held by
// scripts/test-enforce-turn-hold.mjs. A real stop, so the app runs it too.
import { request } from "playwright-core";
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const HELD = /turn is ending: it passes once Ione Vale has answered the roll it brings/i;

export default {
  name: "held-turn",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, ids, viewport } = t;
    const table = ids.heldTurnTables[viewport];
    // The wizard's player is at the table: a watcher who is away is never
    // waited on (chronal-shift.ts playerAtTable). Their event stream is left
    // open for the scenario's length.
    const playerApi = await request.newContext();
    const streamUrl = `${base}/api/campaigns/${table.id}/events`;
    try {
      check((await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } })).ok(), "the wizard's player signs in");
      void playerApi.get(streamUrl, { timeout: 0 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));

      await t.open(`/campaigns/${table.id}`);
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      const bannerEnd = page.locator(`${root}button`).filter({ hasText: /^\s*End turn\s*$/ }).locator("visible=true").first();
      await eventually(() => bannerEnd.count(), { timeoutMs: 30_000, label: "an End turn button on the lead's turn" });
      await untilStill(page);
      await t.tap(bannerEnd);

      // Held: the turn is ending, said once by each control, and politely.
      const status = page.locator(`${root}[role="status"]`).filter({ hasText: HELD }).locator("visible=true");
      await eventually(() => status.count(), { timeoutMs: 15_000, label: "the held turn's status line" });
      check((await status.first().getAttribute("aria-live")) === "polite", "the line is said politely to a screen reader");
      const ending = page.locator(`${root}button`).filter({ hasText: /^\s*Ending turn…\s*$/ }).locator("visible=true");
      await eventually(() => ending.count(), { timeoutMs: 10_000, label: "an End turn control that says the turn is ending" });
      check(await ending.first().isDisabled(), "the control waits: it cannot be pressed again");
      const box = await ending.first().boundingBox();
      check((box?.height ?? 0) >= (viewport === "phone" ? 40 : 24), `the control keeps its size (${box?.height}px)`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the line does not push the page sideways");
      // The Hand's End turn card, where the Hand shows it, says why too: a
      // card held back still takes a press, which tells the reason.
      const handCard = page.locator(`${root}[aria-disabled]`).filter({ hasText: /^\s*End turn/ }).locator("visible=true");
      const open = page.locator(`${root}button:not([aria-disabled])`).filter({ hasText: /^\s*End turn\s*$/ }).locator("visible=true");
      check((await open.count()) === 0, "no End turn control is left to press");
      if (await handCard.count()) {
        check((await handCard.first().getAttribute("aria-disabled")) === "true", "the Hand's End turn card is held back");
      }
      const night = await axeViolations(page, `${root}[role="status"]`);
      check(!night.length, `axe on the held turn at night: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("held");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.style.colorScheme = "light";
      });
      await untilStill(page);
      const day = await axeViolations(page, `${root}[role="status"]`);
      check(!day.length, `axe on the held turn by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("held-day");
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.colorScheme = "dark";
      });

      // The board's own End turn waits too.
      if (viewport === "phone") {
        await openPanelTab(t, "battle").catch(() => {});
      }
      const board = page.locator(`${root}[role="status"]`).filter({ hasText: HELD }).locator("visible=true");
      await eventually(() => board.count(), { timeoutMs: 15_000, label: "the board's held line" });
      await t.shot("held-board");

      // The wizard lets it roll: the turn passes, and the controls come back.
      const snapshot = await (await playerApi.get(`${base}/api/campaigns/${table.id}`)).json();
      const stop = (snapshot.pendingRolls ?? []).find((entry) => entry.parkedFor === "watch");
      check(Boolean(stop), "the wizard sees the stop");
      check((await playerApi.post(`${base}/api/campaigns/${table.id}/pending-rolls/${stop.id}/watch`, { data: { pass: true } })).ok(), "the wizard lets it roll");
      await eventually(async () => (await page.locator(`${root}[role="status"]`).filter({ hasText: HELD }).count()) === 0, { timeoutMs: 20_000, label: "the held line gone once the turn passed" });
      await eventually(async () => (await page.locator(`${root}button`).filter({ hasText: /^\s*Ending turn…\s*$/ }).count()) === 0, { timeoutMs: 10_000, label: "no control left waiting" });
      const after = await (await playerApi.get(`${base}/api/campaigns/${table.id}`)).json();
      const order = after.encounter?.order ?? [];
      check(order[after.encounter?.turnIndex ?? 0]?.id !== table.hero, "the pointer has left the fighter");
      await t.shot("passed");
    } finally {
      await playerApi.dispose();
    }
  },
};
