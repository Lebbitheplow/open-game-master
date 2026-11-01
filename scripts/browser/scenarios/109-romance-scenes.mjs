// Issue 643: a scene a romance's other side starts, where a person running
// the table reads it. On the Romance Pace Table the lead is the GM; the
// player's Kael is courting Lyra Wren, a party companion, and the engine has
// made her request for help due.
//
// Lyra's Bonds row carries the line as visible text (not a tooltip, so it
// reads the same by touch and to a screen reader, which is also told it is
// the GM's alone), inside the row at phone width, clean under axe by night
// and by day. The player's own Bonds tab never carries it. A narration where
// Lyra comes to Kael plays it: the line goes, and the row's history says
// what passed between them.
import { request } from "playwright-core";
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await untilStill(page);
}

export default {
  name: "romance-scenes",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.romancePace[viewport];
    await t.open(`/campaigns/${table.id}`);
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { timeoutMs: 30_000, label: "the Bonds sub-tab" });
    await t.tap(bondsTab);

    const row = page.locator(`${root}[data-bond-row="${table.lyra}"]`).locator("visible=true").first();
    const line = page.locator(`${root}[data-bond-scene="${table.lyra}"]`).locator("visible=true").first();
    await eventually(() => line.count(), { timeoutMs: 20_000, label: "Lyra's scene on her Bonds row" });
    const text = (await line.textContent()) ?? "";
    check(/Their move, yours to play:/.test(text), `a plain label (${text})`);
    check(text.includes(`${table.lyra} asks ${table.kael} for help with something of their own`), `what she does (${text})`);
    check(/once Lyra Wren speaks in your narration, it is recorded/.test(text), "how it is recorded");
    check(/Only you see this\./.test(text), "a screen reader is told it is the GM's alone");
    await line.scrollIntoViewIfNeeded();
    await untilStill(page);
    const rowBox = await row.boundingBox();
    const lineBox = await line.boundingBox();
    check(rowBox && lineBox && lineBox.x + lineBox.width <= rowBox.x + rowBox.width + 1, `the line stays inside its row (${JSON.stringify({ rowBox, lineBox })})`);
    await axeClean(page, `${root}[data-bond-row="${table.lyra}"]`, "Lyra's row at night");
    await t.shot("scene-due");
    await inTheme(page, "light");
    await axeClean(page, `${root}[data-bond-row="${table.lyra}"]`, "Lyra's row by day");
    await t.shot("scene-due-day");
    await inTheme(page, "dark");

    // The engine's choice is the storyteller's: Kael's player never reads it.
    const playerApi = await request.newContext();
    try {
      const signed = await playerApi.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player's sign-in answered ${signed.status()}`);
      const response = await playerApi.get(`${base}/api/campaigns/${table.id}/relationships`);
      const body = await response.json();
      check(Array.isArray(body.relationships), `the player's Bonds answered ${response.status()}`);
      check(!body.relationships.some((entry) => entry.scene), "no scene on the player's Bonds tab");
    } finally {
      await playerApi.dispose();
    }

    // Played: a passage where Lyra comes to Kael.
    const narrated = await api.post(`${base}/api/campaigns/${table.id}/dm/narrate`, {
      data: { content: `By the fire, ${table.lyra} asks ${table.kael} to help her settle an old debt in the next town.` },
    });
    check(narrated.ok(), `the narration answered ${narrated.status()}`);
    await eventually(async () => (await line.count()) === 0, { timeoutMs: 20_000, label: "played, the line goes" });
    await eventually(async () => ((await row.textContent()) ?? "").includes(`${table.lyra} asked ${table.kael} for help with something of their own`), {
      label: "the row's history says what passed",
    });
    await untilStill(page);
    await t.shot("scene-played");
  },
};
