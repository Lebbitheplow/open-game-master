// A player on real dice rolls their own hit dice at a short rest (issue 902).
// "Spend a hit die" on the sheet rolled at once on the server, for a seat
// that was told it rolls its own dice. It is the player's own request, with
// no roll card to wait on, so the sheet asks for the die where she pressed:
// the lead's fighter is hurt, the rest is over, a bard is in the party. She
// presses the button, is asked for a d10 and the Song of Rest's d6, and
// nothing is spent until she sends them. She types 7 and 3 and is healed by
// 7, her Constitution's 2 and 3. The next die asks for the d10 alone, and
// "Roll digitally instead" lets the server throw it. The rules are held by
// scripts/test-enforce-hit-dice-real-dice.mjs; this is the control where the
// player meets it: named, a finger's height on a phone, inside the phone's
// width, clean under axe, by night and day.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "hit-dice-entry",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport, api } = t;
    const table = ids.hitDiceTables[viewport];
    const hero = async () => {
      const seen = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      return seen.sheets.find((sheet) => sheet.id === table.hero);
    };
    await t.open(`/campaigns/${table.id}`);
    const before = await hero();

    // Her own sheet, from her party card.
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Maren Vost" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Maren's party card" });
    await t.tap(card);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Hit dice and resources" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Maren's sheet" });

    const spend = sheet.locator("button.hit-dice-spend").locator("visible=true");
    await eventually(() => spend.count(), { timeoutMs: 20_000, label: "Spend a hit die, while the rest is open" });
    await spend.first().scrollIntoViewIfNeeded();
    // The button knows she rolls her own: it opens the fields, and says so.
    await eventually(async () => (await spend.first().getAttribute("aria-expanded")) === "false", { timeoutMs: 15_000, label: "the button that opens the dice for a seat on real dice" });
    await t.tap(spend.first());

    const entry = sheet.locator('[role="group"][aria-label="Your hit die roll"]').locator("visible=true");
    await eventually(() => entry.count(), { timeoutMs: 15_000, label: "the fields for the hit die" });
    check((await spend.first().getAttribute("aria-expanded")) === "true", "the button says the fields are open");
    const d10 = entry.locator('input[aria-label="d10"]');
    const d6 = entry.locator('input[aria-label="d6"]');
    check((await d10.count()) === 1 && (await d6.count()) === 1, `one d10 and the song's d6 to enter (${await d10.count()}, ${await d6.count()})`);
    const words = (await entry.first().innerText()).replace(/\s+/g, " ");
    check(/Roll 1 × d10 and 1 × d6 at your table/.test(words), `the fields say what to roll: ${words.slice(0, 160)}`);
    check(/Constitution's \+2 is added for you/.test(words), `and that Constitution is added: ${words.slice(0, 200)}`);
    check(/The d6 is from Song of Rest/.test(words), `and whose the d6 is: ${words.slice(0, 240)}`);
    const send = entry.locator("button.hit-dice-submit");
    const digital = entry.locator("button.hit-dice-digital");
    check(await send.first().isDisabled(), "the roll cannot go before the dice are in");
    check((await hero()).hitDice.spent === before.hitDice.spent, "pressing the button spends nothing");

    if (viewport === "phone") {
      for (const [name, button] of [["Heal with this roll", send], ["Roll digitally instead", digital]]) {
        const box = await button.first().boundingBox();
        check(box && box.height >= 40, `${name} is a finger's height on a phone (${box?.height})`);
      }
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the fields do not push the page sideways");
    const serious = (await axeViolations(page, `${root}[role="dialog"]`)).filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    check(serious.length === 0, `the sheet with the fields open is clean under axe: ${serious.map((violation) => `${violation.id} (${violation.help})`).join("; ")}`);
    await entry.first().scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("hit-die-fields");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("hit-die-fields-day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    // By keyboard: the die's field takes the number, and the roll goes on Enter
    // from its button.
    await d10.first().fill("7");
    await d6.first().fill("3");
    await eventually(() => send.first().isEnabled(), { label: "the roll ready to send" });
    await send.first().focus();
    await page.keyboard.press("Enter");
    await eventually(async () => (await hero()).currentHp === before.currentHp + 12, { timeoutMs: 30_000, label: "healed by 7, Constitution's 2 and the song's 3" });
    check((await hero()).hitDice.spent === before.hitDice.spent + 1, "one hit die spent");
    await eventually(() => sheet.getByText(/Rolled: 12 hit points back/).count(), { timeoutMs: 15_000, label: "what the roll healed, said on the sheet" });
    await eventually(async () => (await entry.count()) === 0, { timeoutMs: 15_000, label: "the fields closed once the die is spent" });
    await untilStill(page);
    await t.shot("hit-die-healed");

    // The next die: the song's d6 went with the first, and the server may
    // throw this one.
    await eventually(() => spend.first().isEnabled(), { timeoutMs: 15_000, label: "the button ready for another die" });
    await t.tap(spend.first());
    await eventually(() => entry.count(), { timeoutMs: 15_000, label: "the fields for the second hit die" });
    await eventually(async () => (await d10.count()) === 1 && (await d6.count()) === 0, { timeoutMs: 15_000, label: "the d10 alone: the song's die is spent" });
    await t.tap(digital.first());
    await eventually(async () => (await hero()).hitDice.spent === before.hitDice.spent + 2, { timeoutMs: 30_000, label: "the second hit die, thrown by the server" });
    check((await hero()).currentHp >= before.currentHp + 12 + 3, "and healed by at least 1 and Constitution's 2");
  },
};

export default scenario;
