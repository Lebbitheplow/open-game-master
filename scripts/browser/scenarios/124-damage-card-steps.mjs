// The damage roll card for a hit on real dice says what the hit's feats do to
// the dice (play-test 2026-11-07, B5): the GM's seat swings the lead's
// fighter, who holds Piercer and Savage Attacker, at the goblin beside her;
// the lead types a natural 20, and the damage card asks for three d8s and says
// to roll the rapier's dice twice and reroll the lowest die. Until then only
// the GM's note said so. The rules are held by
// scripts/test-enforce-real-dice-parity.mjs; this is the line where the player
// reads it, inside the phone's width, in the day and night themes. She is a
// halfling: her attack card asks for one d20 (Lucky's reroll is hers to make
// with the die in hand) and says so, where it once asked for two and the
// server refused them.
import { request } from "playwright-core";
import { check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "damage-card-steps",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.damageStepTables[viewport];
    // The table is the player's to run: the GM's calls go out as them.
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
        data: { name: "pc_attack", args: { characterId: table.hero, targetEnemyId: table.goblin, weapon: "Rapier" } },
      });
      const body = await swung.json().catch(() => ({}));
      check(swung.ok(), `the swing waits on the lead's d20 (${swung.status()}): ${JSON.stringify(body).slice(0, 200)}`);

      // The to-hit card: a natural 20, typed and sent.
      const d20 = page.locator(`${root}input[aria-label="d20"]`).locator("visible=true");
      await eventually(() => d20.count(), { timeoutMs: 30_000, label: "the attack roll card" });
      check((await d20.count()) === 1, `one d20 to enter for a halfling's attack (${await d20.count()})`);
      const lucky = page.locator(`${root}p`).filter({ hasText: /A d20 that shows a 1: roll it again, once/ }).locator("visible=true");
      check((await lucky.count()) === 1, "the attack card says Lucky's reroll");
      await untilStill(page);
      await t.shot("attack-card-lucky");
      await d20.first().fill("20");
      const send = page.locator(`${root}button`).filter({ hasText: /^\s*Submit roll\s*$/ }).locator("visible=true");
      await eventually(async () => (await send.count()) && (await send.first().isEnabled()), { label: "the attack roll ready to send" });
      await t.tap(send.first());

      // The damage card: the critical's dice and Piercer's extra die, and what
      // the two feats ask of them.
      const steps = page.locator(`${root}p`).filter({ hasText: /Before you enter your dice:/ }).locator("visible=true");
      await eventually(() => steps.count(), { timeoutMs: 30_000, label: "the damage card's feat steps" });
      const line = (await steps.first().innerText()).trim();
      check(/\(Savage Attacker\)/.test(line) && /\(Piercer\)/.test(line), `the card names both feats (${line})`);
      const d8s = page.locator(`${root}input[aria-label="d8"]`).locator("visible=true");
      check((await d8s.count()) === 3, `three d8s to enter (${await d8s.count()})`);
      await steps.first().scrollIntoViewIfNeeded();
      await untilStill(page);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the card does not push the page sideways");
      await t.shot("damage-card");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("damage-card-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    } finally {
      await gm.dispose();
    }
  },
};

export default scenario;
