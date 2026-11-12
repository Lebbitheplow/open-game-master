// The after-the-roll card on an attack (PR 848, src/lib/dm/after-roll-logic.ts
// afterAttackOptions): the GM's seat makes the lead's fighter swing at a
// goblin, the lead enters a 10 on their real dice, and the miss waits on the
// card with Lucky and the Bardic die both on offer. (The server's own throw
// reaches the same card through the same options; that path is held by the
// suite below.) The lead adds
// the die from the keyboard, the swing hits, and the server lands its damage.
// The rules are held by scripts/test-enforce-after-roll-attacks.mjs; this is
// what only a page can see: the card's line for an attack, finger-sized,
// inside the phone's width, by day and by night and in the app shell, and
// the End Turn button waiting for the card, and a card whose dice were
// never entered leaving with the turn the lead skipped.
import { request } from "playwright-core";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const GROUP = '[role="group"][aria-label="Change this roll, or keep it"]';

const scenario = {
  name: "after-roll-attack",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.afterAttackTables[viewport];
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const swung = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, {
        data: { name: "pc_attack", args: { characterId: table.hero, targetEnemyId: table.goblin, weapon: "Longsword" } },
      });
      const body = await swung.json().catch(() => ({}));
      check(swung.ok(), `the swing was made (${swung.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      // The lead's real d20 shows a 10, entered as their card would send it.
      const parked = (await (await gm.get(`${base}/api/campaigns/${table.id}`)).json()).pendingRolls?.find((entry) => entry.kind === "attack");
      check(parked, "the to-hit roll waits for the lead's dice");
      const entered = await page.evaluate(
        async ({ campaignId, id }) => (await fetch(`/api/campaigns/${campaignId}/pending-rolls/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dice: [10] }) })).status,
        { campaignId: table.id, id: parked.id },
      );
      check(entered === 200, `the 10 was entered (${entered})`);

      const choices = page.locator(`${root}${GROUP}`).locator("visible=true");
      await eventually(() => choices.count(), { timeoutMs: 30_000, label: "the after-the-roll card on the attack" });
      const card = page.locator(`${root}*:has(> ${GROUP})`).locator("visible=true").first();
      check(/As it stands, the attack misses\./.test(await card.innerText()), "the card says the attack misses as it stands");
      const bardic = choices.getByRole("button", { name: "Add Bardic Inspiration (d8)" });
      const lucky = choices.getByRole("button", { name: "Lucky: roll another d20" });
      const keep = choices.getByRole("button", { name: "Keep this roll" });
      // The fight's opening splash plays over the table on a fresh load; the
      // card is shot once it has gone.
      await page.getByText(/roll initiative/i).locator("visible=true").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      await untilStill(page);
      for (const button of [bardic, lucky, keep]) {
        const box = await button.boundingBox();
        check((box?.height ?? 0) >= 40, `a finger-sized button (${box?.height}px)`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      const night = await axeViolations(page, `${root}${GROUP}`);
      check(!night.length, `axe on the card: ${night.map((entry) => entry.id).join(", ")}`);
      await t.shot("attack");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}${GROUP}`);
      check(!day.length, `axe on the card by day: ${day.map((entry) => entry.id).join(", ")}`);
      await t.shot("attack-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // End Turn with the card open (table report, 2026-11-10): alone at
      // the table no clock keeps the roll, and the turn used to end under
      // it. The button now answers with the roll to settle, the card stays,
      // and the turn is still the fighter's.
      const endTurn = page.locator(root || "body").getByRole("button", { name: "End turn", exact: true }).locator("visible=true").first();
      await t.tap(endTurn);
      const held = page.getByText("is waiting on your choice. Change the roll or keep it, then end the turn.").locator("visible=true").first();
      await held.waitFor({ state: "visible", timeout: 15_000 });
      check(await lucky.count(), "the card is still open after End Turn");
      const order = (await (await gm.get(`${base}/api/campaigns/${table.id}`)).json()).encounter;
      check(order.order[order.turnIndex]?.id === table.hero, "the turn is still the fighter's");
      await untilStill(page);
      await t.shot("end-turn-waits");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("end-turn-waits-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // From the keyboard: the die goes on. A die too small to reach still
      // leaves Lucky on offer, and the card stays for it; keeping the roll
      // lands it. Either way the card goes, with the die spent.
      await bardic.focus();
      await page.keyboard.press("Enter");
      await eventually(async () => !(await bardic.count()), { timeoutMs: 15_000, label: "the die spent" });
      if (await choices.count()) {
        check(await lucky.count(), "only Lucky is left on offer");
        await keep.focus();
        await page.keyboard.press("Enter");
      }
      await eventually(async () => !(await choices.count()), { timeoutMs: 15_000, label: "the card gone once the roll lands" });
      const snapshot = await (await gm.get(`${base}/api/campaigns/${table.id}`)).json();
      // On real dice a hit asks the lead for its damage; nothing else waits.
      const left = (snapshot.pendingRolls ?? []).map((entry) => entry.kind);
      check(left.every((kind) => kind === "damage") && left.length <= 1, `only a hit's damage roll is left waiting (${left.join(", ")})`);
      const hero = snapshot.sheets.find((sheet) => sheet.id === table.hero);
      check(!(hero?.conditions ?? []).includes("bardic inspiration (d8)"), `the die is spent (${JSON.stringify(hero?.conditions)})`);

      // A swing whose real d20 is never entered: the lead skips the turn, and
      // the card goes with it, on the open page, by the stream's word. Left
      // up, it could only land nothing.
      const skipped = ids.skippedTables[viewport];
      await t.open(`/campaigns/${skipped.id}`);
      if (viewport === "phone") {
        const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true });
        if (await tab.count()) await t.tap(tab);
      }
      const unrolled = await gm.post(`${base}/api/campaigns/${skipped.id}/dm/invoke`, {
        data: { name: "pc_attack", args: { characterId: skipped.hero, targetEnemyId: skipped.goblin, weapon: "Longsword" } },
      });
      check(unrolled.ok(), `the second swing was made (${unrolled.status()})`);
      const submit = page.locator(root || "body").getByRole("button", { name: "Submit roll" }).locator("visible=true");
      await eventually(() => submit.count(), { timeoutMs: 30_000, label: "the dice card for the unrolled swing" });
      const skip = await gm.post(`${base}/api/campaigns/${skipped.id}/floor`, { data: {} });
      check(skip.ok(), `the lead skipped the turn (${skip.status()})`);
      await eventually(async () => !(await submit.count()), { timeoutMs: 15_000, label: "the card gone with the skipped turn" });
      const after = await (await gm.get(`${base}/api/campaigns/${skipped.id}`)).json();
      check(!(after.pendingRolls ?? []).some((entry) => entry.kind === "attack"), "no to-hit roll is left waiting");
      await untilStill(page);
      await t.shot("skipped-card-gone");
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
