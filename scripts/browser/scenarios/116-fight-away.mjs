// Issue 740: a fight that goes on without someone, where the person running
// the table says so. "Not at this fight" in the console's Start a fight is a
// chip picker like Who goes, with nobody picked by default. The character
// picked rolls nothing and has no token on the board; their initiative roll
// later brings them in, on a free square. Dark and light, desktop and phone,
// clean under axe.
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "fight-away",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api, viewport } = t;
    const table = ids.farScout[viewport];
    const board = async () => (await (await api.get(`${base}/api/campaigns/${table.id}/battle-map`)).json()).view?.tokens ?? [];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const combat = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^combat$/i }).locator("visible=true").first();
    await eventually(() => combat.count(), { timeoutMs: 30_000, label: "the console's combat tab" });
    await t.tap(combat);
    const opener = page.getByRole("button", { name: /^Start a fight/ }).locator("visible=true").first();
    await eventually(() => opener.count(), { label: "Start a fight" });
    await t.tap(opener);
    await untilStill(page);

    // ---- The control, its default, and one character picked ----
    const away = page.getByRole("group", { name: "Not at this fight" }).locator("visible=true").first();
    await eventually(() => away.count(), { label: "Not at this fight, a named group" });
    const cora = away.getByRole("button", { name: /Cora Vale/ });
    check((await cora.getAttribute("aria-pressed")) === "false", "nobody is picked by default: everyone is in the fight");
    await away.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("default");
    const enemies = page.getByLabel("Enemies", { exact: true }).locator("visible=true").first();
    await enemies.fill("goblin");
    await t.tap(cora);
    check((await cora.getAttribute("aria-pressed")) === "true", "Cora picked");
    await cora.focus();
    const box = await cora.boundingBox();
    console.log(`  fight-away ${viewport}: chip height ${box?.height}px`);
    check(Boolean(box) && box.height >= (viewport === "phone" ? 40 : 36), `a chip a finger can press (${box?.height}px)`);
    await away.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("picked");
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
      await t.shot(`picked-${theme}`);
      const found = await axeViolations(page, '[role="group"][aria-label="Not at this fight"]');
      check(!found.length, `axe on the picker (${theme}): ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
    }

    // ---- The fight opens without them ----
    const ran = page.waitForResponse((response) => response.url().endsWith("/dm/invoke") && response.request().method() === "POST", { timeout: 30_000 });
    ran.catch(() => {});
    await t.tap(page.getByRole("button", { name: /^\s*Run\s*$/ }).locator("visible=true").first());
    const answer = await ran;
    check(answer.ok(), `Run answered ${answer.status()}: ${await answer.text()}`);
    const opened = await answer.json();
    check(/Cora Vale: not at this fight/.test(opened.result?.absent ?? ""), `the result says who is away: ${JSON.stringify(opened.result ?? opened).slice(0, 400)}`);
    await eventually(async () => (await board()).length >= 3, { label: "the board's tokens" });
    const before = await board();
    check(!before.some((token) => token.refId === table.cora), "no token for the one who is away");
    check(before.some((token) => token.refId === table.kael) && before.some((token) => token.refId === table.ilse), "those at the fight have tokens");
    await untilStill(page);
    await t.shot("fight-without");

    // ---- They arrive ----
    const rolled = await api.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name: "request_roll", args: { characterId: table.cora, kind: "initiative" } } });
    check(rolled.ok(), `the arrival's roll answered ${rolled.status()}: ${await rolled.text()}`);
    await eventually(async () => (await board()).some((token) => token.refId === table.cora), { label: "the arrival's token" });
    const after = await board();
    const arrival = after.find((token) => token.refId === table.cora);
    check(!before.some((token) => token.x === arrival.x && token.y === arrival.y), "the arrival stands on a free square");
    await untilStill(page);
    await t.shot("arrived");
  },
};
