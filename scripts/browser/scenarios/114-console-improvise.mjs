// The GM console's Action offers an improvised action (take_action improvise,
// SRD 5.1 Actions in Combat). Picking Improvise brings in what the engine
// needs to rule it, each labelled: the character's check or ability, the
// creature's resisting check, the difficulty, what a win does and its damage;
// Skill shows for Improvise and Search and is gone for a Dodge, where it
// cannot matter. At phone width each picker is a target a finger can reach,
// in the night and day themes. The seed's Enemy Turn Table, which the
// signed-in player runs.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const scenario = {
  name: "console-improvise",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.enemyTurns[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^combat$/i }).locator("visible=true").first();
    await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's Combat tab" });
    await t.tap(tab);
    const open = page.getByRole("button", { name: /^Action\b.*improvised action/ }).locator("visible=true").first();
    await eventually(() => open.count(), { label: "the console's Action" });
    await t.tap(open);
    await untilStill(page);

    // The kit's Select: a menu button named by its label, rows as radio items.
    const picker = (label) => page.getByRole("button", { name: label, exact: true }).locator("visible=true");
    const pick = async (label, option) => {
      const button = picker(label).first();
      await eventually(() => button.count(), { label: `the ${label} picker` });
      await t.tap(button);
      const row = page.getByRole("menuitemradio", { name: option }).locator("visible=true").first();
      await eventually(() => row.count(), { label: `${option} under ${label}` });
      await t.tap(row);
      await untilStill(page);
    };

    await pick("Action", "Dodge");
    check((await picker("Skill").count()) === 0, "Skill shows for a Dodge, where it cannot matter");
    check((await picker("Difficulty").count()) === 0, "Difficulty shows for a Dodge");

    await pick("Action", "Improvise");
    const asked = ["Skill", "Or an ability", "Enemy resists with", "Difficulty", "On a win", "Damage on a win", "Damage type"];
    for (const label of asked) {
      await eventually(() => picker(label).count(), { label: `the ${label} picker, labelled` });
    }
    if (viewport === "phone") {
      for (const label of asked) {
        const box = await picker(label).first().boundingBox();
        check(Boolean(box && box.height >= 39.5), `${label} is a target a finger can reach (${box?.height}px)`);
      }
    }
    await pick("Difficulty", "Hard (DC 20)");
    await pick("On a win", "Prone");
    await t.shot("improvise");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("improvise-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    await pick("Action", "Search");
    await eventually(() => picker("Skill").count(), { label: "Skill for a Search" });
    check((await picker("Difficulty").count()) === 0, "an improvised action's Difficulty stayed for a Search");
    await t.shot("search");
  },
};

export default scenario;
