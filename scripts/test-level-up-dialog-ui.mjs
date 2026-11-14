// The level-up dialog's own steps, rendered to a string. The server suites
// send the body the dialog would send, but never load the dialog, so a step
// the dialog failed to show passed there unseen: a fighter that reached
// level 3 without a Martial Archetype (a level 1 build seated at a higher
// table) was offered none at any later level, while the server took the
// pick and the sheet listed it as owed.
import assert from "node:assert/strict";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { withAsiLedger } = await import("../src/lib/srd/asi-ledger.ts");
const { LevelUpDialog } = await import("../src/app/campaigns/[campaignId]/LevelUpDialog.tsx");

const { test, finish } = suite("test-level-up-dialog-ui");
const world = await openWorld();

// A fighter with its style chosen and every improvement it has earned taken,
// going up one level to 3 or 5. Neither level brings an improvement, a style
// or a pick, so the hit points are the dialog's only step unless the
// subclass is still to choose. The first step's button says which: "Next"
// when a step follows it, "Confirm level up" when the level is taken there.
function firstStep(level, subclass) {
  const hero = world.addHero({ class: "fighter", level, name: "Corin" });
  const sheet = {
    ...hero,
    subclass,
    xp: 6500,
    features: withAsiLedger([...hero.features, { name: "Fighting Style: Defense", source: "choice" }], level >= 4 ? 1 : 0),
  };
  const markup = renderToStaticMarkup(
    createElement(LevelUpDialog, { campaignId: world.campaignId, sheet, multiclassAllowed: false, onDone() {} }),
  );
  assert.ok(markup.includes(`Level ${level + 1}!`), "the dialog did not render");
  return { asksMore: markup.includes(">Next<"), confirms: markup.includes("Confirm level up") };
}

// Fighting Initiate opens a fighting style slot of its own: a barbarian who
// holds the feat with no style picked is asked for one at the level-up, as a
// fighter's class slot asks (feature-effects.ts featStyleSlotFeatures).
await test("A barbarian holding Fighting Initiate with no style picked is asked for one by the level-up dialog", () => {
  const ask = (feats) => {
    const hero = world.addHero({ class: "barbarian", level: 4, name: "Brakka", feats });
    const sheet = { ...hero, subclass: "Path of the Berserker", xp: 6500, feats, features: withAsiLedger(hero.features, 1) };
    const markup = renderToStaticMarkup(createElement(LevelUpDialog, { campaignId: world.campaignId, sheet, multiclassAllowed: false, onDone() {} }));
    return { asksMore: markup.includes(">Next<"), confirms: markup.includes("Confirm level up") };
  };
  assert.deepEqual(ask([]), { asksMore: false, confirms: true }, "the staging: a barbarian with nothing to choose");
  assert.deepEqual(ask(["Fighting Initiate"]), { asksMore: true, confirms: false }, "the feat's style was never asked");
});

await test("A fighter past its subclass level without a Martial Archetype is asked for one by the level-up dialog", () => {
  assert.deepEqual(firstStep(4, ""), { asksMore: true, confirms: false }, "the dialog takes the level without asking for the missed subclass");
});

await test("A fighter reaching level 3 is asked for its Martial Archetype, as before", () => {
  assert.deepEqual(firstStep(2, ""), { asksMore: true, confirms: false });
});

await test("A fighter with its Martial Archetype is not asked again, and takes the level from the hit points", () => {
  assert.deepEqual(firstStep(4, "Champion"), { asksMore: false, confirms: true }, "a step followed the hit points for a fighter with nothing to choose");
});

world.close();
finish();
