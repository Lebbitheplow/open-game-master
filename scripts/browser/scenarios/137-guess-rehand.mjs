// PR 939 review: an archer whose pack lists the shortsword before the
// longbow, and whose sheet never said what she holds, was handed the sword
// when the fight began; the bow's card was shut for full hands, and the only
// way to shoot on turn one was to drop the sword. The engine's guess now
// never costs a turn (src/lib/dm/held-default.ts): while it stands the bow's
// card is open, still marked Packed, and the first change is free. A plain
// weapon has a row on the sheet too, reading In hand or Packed as the Hand
// does: pressing the bow's row takes it up and puts the sword away, says so,
// and ends the guess, so the sword's row is then refused in the Hand's own
// words. Checked at phone width with finger-sized toggles, by day and night.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "guess-rehand",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const table = ids.guessTables[viewport];
    const gear = async () => {
      const body = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      const ayla = (body.sheets ?? []).find((sheet) => sheet.id === table.hero);
      return Object.fromEntries((ayla?.equipment ?? []).map((item) => [item.name, item]));
    };
    const start = await gear();
    check(start.Shortsword?.equipped === true && start.Longbow?.equipped === false, "the guess put the sword in hand and packed the bow");
    check(start.Shortsword?.heldGuess === true && start.Longbow?.heldGuess === true, "the marks are the engine's guess");

    await t.open(`/campaigns/${table.id}`);
    const tableTab = async () => {
      if (viewport === "phone") await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }));
    };
    await tableTab();
    const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
    await eventually(() => hand.isVisible(), { timeoutMs: 30_000, label: "the archer's Hand" });
    const card = (id) => hand.locator(`[data-card-id="${id}"]`).locator("visible=true").first();
    await eventually(() => card("attack:longbow").count(), { timeoutMs: 15_000, label: "the longbow's card" });
    // Open, not shut for full hands, and honest that the bow is packed.
    check((await card("attack:longbow").getAttribute("aria-disabled")) !== "true", "the longbow's card can be played while the guess stands");
    check((await card("attack:longbow").locator(".hand-wield").getAttribute("data-wield")) === "stowed", "the longbow's mark still reads Packed");
    check(!/hands are full/i.test((await card("attack:longbow").getAttribute("aria-label")) ?? ""), "no hands-full reason on the card");
    await t.shot("bow-open");

    // The sheet's weapon rows.
    const party = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Ayla Venn" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await party.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => party.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => party.count(), { timeoutMs: 30_000, label: "Ayla's party card" });
    await t.tap(party);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Worn gear sets your AC" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Ayla's sheet with her gear" });
    const toggle = (name) => sheet.locator(`[data-gear-row="${name}"] button`).first();
    await eventually(async () => ((await toggle("Longbow").textContent()) ?? "").trim() === "Packed", { label: "the longbow's row reads Packed" });
    check(((await toggle("Shortsword").textContent()) ?? "").trim() === "In hand", "the shortsword's row reads In hand");
    check(/Longbow: Packed\. Take it in hand\./.test((await toggle("Longbow").getAttribute("aria-label")) ?? ""), "a screen reader hears where the bow is and what the press does");
    if (viewport === "phone") {
      // In CSS pixels: the dialog's own scale (and the app's text size) moves
      // the painted box, not the target's layout size.
      const box = await toggle("Longbow").evaluate((node) => ({ width: node.offsetWidth, height: node.offsetHeight }));
      check(box.height >= 40 && box.width >= 40, `the toggle is finger-sized on a phone (${JSON.stringify(box)})`);
    }
    await toggle("Longbow").scrollIntoViewIfNeeded().catch(() => undefined);
    await untilStill(page);
    await t.shot("rows-night");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await page.waitForTimeout(800);
    await t.shot("rows-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    // The free first change: the bow taken up, the sword put away, said so.
    await t.tap(toggle("Longbow"));
    const said = sheet.getByRole("status").filter({ hasText: "puts away Shortsword and takes up Longbow, free" });
    await eventually(() => said.count(), { timeoutMs: 15_000, label: "the line that says what the free change did" });
    await eventually(async () => {
      const now = await gear();
      return now.Longbow?.equipped === true && now.Shortsword?.equipped === false && !now.Longbow?.heldGuess && !now.Shortsword?.heldGuess;
    }, { label: "the bow in hand, the sword packed, the guess over" });
    await eventually(async () => ((await toggle("Longbow").textContent()) ?? "").trim() === "In hand", { label: "the longbow's row reads In hand" });
    const body = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
    check(!body.encounter?.turnBudget?.interaction, `the change spent no interaction (${JSON.stringify(body.encounter?.turnBudget ?? null)})`);
    await t.shot("rehanded");

    // The guess is over: the sword's row meets full hands, in the Hand's words.
    await t.tap(toggle("Shortsword"));
    const refused = sheet.getByRole("alert").filter({ hasText: "Ayla Venn's hands are full (Longbow), so Shortsword cannot be drawn yet" });
    await eventually(() => refused.count(), { timeoutMs: 15_000, label: "the sword refused for full hands" });
    const words = (await refused.first().textContent()) ?? "";
    check(!/\b[a-z]+_[a-z_]+\b/.test(words), `the refusal names no tool (${words})`);
    check((await gear()).Shortsword?.equipped === false, "the sword stayed packed");
    await t.shot("refused");
  },
};
