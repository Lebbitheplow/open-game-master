// A workshop item can add to unarmed strikes. A monk's wraps had nothing to
// set: the weapon effect listed only the SRD's weapons and had no bonus to
// hit, so "+3 to unarmed attacks" could only be written as prose nothing read.
// Here the form sets both, on desktop and phone, and the entry keeps them; then
// the Hand's Unarmed strike card shows Demon Armor's gauntlets.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

async function pick(t, trigger, choice) {
  await t.tap(trigger);
  const option = t.page.getByRole("menu").getByText(choice, { exact: true }).first();
  await eventually(() => option.isVisible(), { timeoutMs: 5_000, label: `the option ${choice}` });
  await t.tap(option);
}

export default {
  name: "item-unarmed-bonus",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api, ids } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Wraps ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    const name = `Tested Wraps ${stamp}`;
    let entryId = null;
    let equipmentBefore = null;
    try {
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Items/ }));
      await t.tap(page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first());
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.locator('[data-tour="homebrew-save"]').isVisible(), { timeoutMs: 20_000, label: "the item form" });
      await editor.getByLabel("Name", { exact: true }).first().fill(name);
      await pick(t, editor.getByRole("button", { name: "Kind", exact: true }), "Magic item");
      await t.tap(editor.getByRole("button", { name: /Add an effect/ }));
      await pick(t, editor.getByRole("button", { name: "Effect kind" }), "Training and bonuses with weapons");

      const chip = editor.getByRole("button", { name: "Unarmed strike", exact: true });
      await chip.scrollIntoViewIfNeeded();
      await t.shot("item-effect-default");
      // The starting effect is the Bracers of Archery's: swap it for wraps.
      for (const bow of ["Longbow", "Shortbow"]) {
        await t.tap(editor.getByRole("button", { name: bow, exact: true }));
      }
      await t.tap(editor.getByRole("button", { name: "Unarmed strike", exact: true }));
      // The effect starts ranged, which a fist can never be: picking it clears
      // that, or the bonus would silently never apply.
      check((await editor.getByRole("switch", { name: "Only at range" }).count()) === 0, "Only at range leaves with the fist");
      await t.tap(editor.getByRole("switch", { name: "Trained with them" }));
      const hit = editor.getByRole("spinbutton", { name: "Bonus to hit", exact: true });
      await hit.fill("3");
      await hit.press("Tab");
      const damage = editor.getByRole("spinbutton", { name: "Extra damage", exact: true });
      await damage.fill("3");
      await damage.press("Tab");
      const summary = editor.getByText(/with unarmed strike.*\+3 to hit.*\+3 damage/);
      await eventually(() => summary.isVisible(), { timeoutMs: 5_000, label: "the summary of the bonus" });
      await hit.scrollIntoViewIfNeeded();
      await t.shot("item-effect");
      const night = await axeViolations(page, '[role="dialog"]');
      check(!night.length, `the form passes axe (${night.map((violation) => violation.id).join(", ")})`);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, '[role="dialog"]');
      check(!day.length, `the form passes axe in the day theme (${day.map((violation) => violation.id).join(", ")})`);
      await t.shot("item-effect-day");
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await t.tap(editor.locator('[data-tour="homebrew-save"]'));
      const saved = await eventually(
        async () => {
          const entries = (await (await api.get(`${base}/api/homebrew?kind=item`)).json()).entries ?? [];
          return entries.find((entry) => entry.name === name) ?? null;
        },
        { timeoutMs: 15_000, label: "the item saved" },
      );
      entryId = saved.id;
      const [effect] = saved.data.effects ?? [];
      check(effect?.kind === "weapon_rider", "the item keeps the effect");
      check(effect.weapons.join() === "unarmed strike", `it names the unarmed strike (${effect.weapons})`);
      check(effect.attack === 3 && effect.damage === 3, `at +3 and +3 (${effect.attack}, ${effect.damage})`);

      // ---- the Hand: the card says what the strike will roll ----
      // Demon Armor, the SRD item that reaches a fist, on the seat in the fight.
      const table = ids.campaignId;
      const sheetOf = async () => ((await (await api.get(`${base}/api/campaigns/${table}`)).json()).sheets ?? []).find((sheet) => sheet.id === ids.tavi);
      equipmentBefore = (await sheetOf()).equipment;
      const worn = await api.patch(`${base}/api/campaigns/${table}/sheets/${ids.tavi}`, {
        data: { equipment: [...equipmentBefore, { name: "Demon Armor", qty: 1, equipped: true, attuned: true }], reason: "Trying on the gauntlets" },
      });
      check(worn.ok(), `Tavi wears the armor (${worn.status()})`);
      const put = await api.post(`${base}/api/campaigns/${table}/sheet/usage`, { data: { gear: { "Demon Armor": { equipped: true, attuned: true } } } });
      check(put.ok(), `and is attuned to it (${put.status()}: ${await put.text()})`);
      await t.open(`/campaigns/${table}`);
      if (t.viewport === "phone") {
        // The phone's Table tab holds the Hand.
        const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^s*tables*$/i }).locator("visible=true");
        if (await tab.count()) await t.tap(tab.first());
      }
      const card = page.locator(`${root}button.hand-card[aria-label^="Unarmed strike"]`).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the Unarmed strike card" });
      const label = await card.innerText();
      check(/1d8/i.test(label) && /slashing/i.test(label), `the card shows the gauntlets (${label})`);
      await card.scrollIntoViewIfNeeded();
      if (t.viewport === "desktop") {
        // The fan lays each card over the right of the one before, and how
        // far depends on how many cards the Hand holds: Tavi's gear actions
        // fold under Items at four and stand alone at three, and
        // 68-board-move-confirm walks Tavi a square, which can take one away.
        // So the hover goes to a point of this card nothing lies over.
        const spot = await card.evaluate((node) => {
          const box = node.getBoundingClientRect();
          for (let x = 4; x < box.width; x += 4) {
            const hit = document.elementFromPoint(box.left + x, box.top + box.height / 2);
            if (hit && node.contains(hit)) return { x, y: box.height / 2 };
          }
          return null;
        });
        check(spot, "some of the Unarmed strike card shows in the fan");
        await card.hover({ position: spot });
      }
      // The fight's opening banner covers the page for its first seconds.
      await page.waitForTimeout(6_000);
      await t.shot("hand-card");
    } finally {
      if (equipmentBefore) {
        await api.patch(`${base}/api/campaigns/${ids.campaignId}/sheets/${ids.tavi}`, { data: { equipment: equipmentBefore, reason: "Back as it was" } }).catch(() => {});
      }
      if (entryId) await api.delete(`${base}/api/homebrew/${entryId}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
