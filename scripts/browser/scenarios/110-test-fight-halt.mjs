// 0.31.3 playtest: at an AI-run test fight the GM's turn halted (its agent
// program was signed out) and the notice flashed and was gone; after a
// reload it was nowhere on the page, and the table sat on "The enemies are
// taking their turns..." with no Retry. A test fight opens with its board on
// the stage, which takes the transcript's place, and the chronicle beside
// the board leaves a halted turn out, so the notice had nowhere to be drawn.
// The stage now shows it above the fight's controls, with its Retry.
//
// The table's model is a stand-in here that fails every call until told to
// answer, so the opening turn halts the way a signed-out program halts it.
import http from "node:http";
import { check, eventually, freePort, untilStill } from "../lib.mjs";

function flakyNarrator(port) {
  const state = { fail: true, asked: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      state.asked += 1;
      if (state.fail) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "The stand-in model is down." } }));
        return;
      }
      const content = "The goblins snarl in the mud of the lane and close in.";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, close: () => server.close() })));
}

export default {
  name: "test-fight-halt",
  // The stage is a docked layout's; a phone keeps the transcript, where the
  // notice always was.
  viewports: ["desktop"],
  async run(t) {
    const { page, base, api, root } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const shop = await api.post(`${base}/api/workshops`, { data: { title: `Halted test ${stamp}`, description: "" } });
    check(shop.ok(), "a workshop");
    const workshopId = (await shop.json()).workshop.id;
    const port = await freePort();
    const model = await flakyNarrator(port);
    let tableId = "";
    try {
      const fight = await api.post(`${base}/api/campaigns/${workshopId}/dm/encounter-templates`, {
        data: { name: `Goblin pair ${stamp}`, enemies: "goblin x2", battlefield: "a muddy lane", notes: "" },
      });
      check(fight.ok(), `a prepared fight (${fight.status()}: ${(await fight.text()).slice(0, 200)})`);
      const templateId = (await fight.json()).template.id;
      const pointed = await api.patch(`${base}/api/campaigns/${workshopId}/story-settings`, {
        data: { textProvider: "custom", customBaseUrl: `http://127.0.0.1:${port}/v1`, customModel: "test-fight-halt" },
      });
      check(pointed.ok(), `pointing the workshop at the stand-in answered ${pointed.status()}`);

      await t.open(`/workshop/${workshopId}?system=encounters`);
      const button = page.locator(`${root}[data-encounter-deploy="${templateId}"]`).locator("visible=true").first();
      await eventually(() => button.count(), { timeoutMs: 30_000, label: "the fight's button" });
      await t.tap(button);
      const sheetPanel = page.locator('[data-testid="test-fight-sheet"]').locator("visible=true").first();
      await eventually(() => sheetPanel.isVisible(), { timeoutMs: 15_000, label: "the Test fight sheet" });
      check(await sheetPanel.getByRole("radio", { name: /The AI GM/ }).isChecked(), "the AI GM runs it");
      await t.tap(sheetPanel.getByRole("button", { name: /Start the test fight/ }));
      await eventually(async () => (await t.url()).pathname.startsWith("/campaigns/"), { timeoutMs: 60_000, label: "the test table" });
      tableId = (await t.url()).pathname.split("/")[2];

      // The opening turn halts; the server holds its notice.
      await eventually(async () => {
        const data = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
        return (data.messages ?? []).some((message) => message.authorType === "system" && message.dmTurnId && /ran into a problem/.test(message.content));
      }, { timeoutMs: 60_000, label: "the halted notice in the table's messages" });

      // The board holds the stage, and the notice is on it with its Retry,
      // and still there after a reload.
      const board = page.locator(`${root}.cine-fight-board`).locator("visible=true").first();
      const notice = page.locator(`${root}[data-staged-halt]`).locator("visible=true").first();
      const retry = notice.getByRole("button", { name: /Retry the turn/ });
      for (const pass of ["live", "reloaded"]) {
        // A test table is in no campaign list, so the app has no tile to
        // open it by: the way back is the workshop's "Return to it", as the
        // author takes it there (OpenTestFight.tsx).
        if (pass === "reloaded" && t.app) {
          await t.open(`/workshop/${workshopId}?system=encounters`);
          const back = page.locator(`${root}[data-testid="open-test-fight"] a`).filter({ hasText: /Return to it/ }).locator("visible=true").first();
          await eventually(() => back.count(), { timeoutMs: 30_000, label: "the workshop's way back to the test table" });
          await t.tap(back);
          await eventually(async () => (await t.url()).pathname.startsWith(`/campaigns/${tableId}`), { timeoutMs: 30_000, label: "the test table again" });
        } else if (pass === "reloaded") {
          await t.open(`/campaigns/${tableId}`);
        }
        await eventually(() => board.isVisible(), { timeoutMs: 30_000, label: `the board on the stage (${pass})` });
        await eventually(() => notice.isVisible(), { timeoutMs: 30_000, label: `the halted notice on the stage (${pass})` });
        const said = (await notice.innerText()).replace(/\s+/g, " ");
        check(/GM halted, context preserved/i.test(said) && said.length > 40, `the notice says why (${pass}: ${said.slice(0, 200)})`);
        check(await retry.isEnabled(), `the author is offered Retry (${pass})`);
        await notice.scrollIntoViewIfNeeded().catch(() => undefined);
        await t.shot(`halted-${pass}`);
      }
      // The day theme draws it too.
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      check(await notice.isVisible(), "the notice in the day theme");
      await t.shot("halted-day");
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

      // Retry sends the GM back in; once it answers, the notice is gone.
      model.state.fail = false;
      await t.tap(retry);
      await eventually(async () => !(await page.locator(`${root}[data-staged-halt]`).count()), { timeoutMs: 60_000, label: "the notice gone once the turn is retried" });
      await t.shot("retried");
    } finally {
      model.close();
      if (tableId) await api.delete(`${base}/api/campaigns/${tableId}`).catch(() => undefined);
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => undefined);
    }
  },
};
