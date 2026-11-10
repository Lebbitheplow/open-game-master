// What GET /sheet/level-up offers is what PATCH /sheet then takes
// (src/lib/srd/level-up-options.ts): four ways the offer and the level-up
// had drifted apart, each checked at the route.
//
//   - an option whose prerequisite the character will not meet after the
//     level is listed apart, with its reason, never among the names to send
//     (SRD 5.1, Eldritch Invocations: "If an eldritch invocation has
//     prerequisites, you must meet them to learn it.")
//   - a second class's Fighting Style is offered at the level that opens it
//     (SRD 5.1, Paladin: "At 2nd level, you adopt a style of fighting as
//     your specialty."), counted per class (src/lib/srd/style-slots.ts)
//   - a third caster's offer names its two schools and how many spells may
//     come from any other (third-caster.ts, the rule the level-up enforces)
//   - a content pack's class (the Mechanist) is offered its level, as the
//     PATCH gives it (the route's classOf is the PATCH's classGrantsFor)
import assert from "node:assert/strict";
import { hasPack } from "./lib/enforce-world.mjs";
import { openLevelSweep } from "./lib/sweep-builder-levelup.mjs";
import { key } from "./lib/sweep-builder.mjs";

const sweep = await openLevelSweep();
let passed = 0;
const test = async (name, run) => {
  await run();
  passed += 1;
  console.log(`ok ${name}`);
};

await test("a warlock 7's offer lists Ascendant Step apart, with its level", async () => {
  await sweep.seat({ level: 1, classId: "warlock" });
  await sweep.climb({ to: 6 });
  const { status, json } = await sweep.offer();
  assert.equal(status, 200, JSON.stringify(json));
  const slot = (json.choices.featurePicks ?? []).find((entry) => /invocation/i.test(entry.label));
  assert.ok(slot, `no invocation pick at warlock 7: ${JSON.stringify(json.choices.featurePicks)}`);
  assert.ok(!slot.options.includes("Invocation: Ascendant Step"), "Ascendant Step (warlock level 9) is offered to a warlock 7");
  const apart = (slot.notYet ?? []).find((entry) => entry.option === "Invocation: Ascendant Step");
  assert.ok(apart && /level 9/.test(apart.reason), `Ascendant Step is not listed apart with its reason: ${JSON.stringify(slot.notYet)}`);
  // Every name the offer lists is one the level-up takes.
  for (const option of slot.options.slice(0, 3)) {
    const undo = sweep.snapshot();
    const answer = await sweep.patch({ level: 7, features: [{ name: option, source: "choice" }] });
    assert.ok(!/needs/.test(answer.json.error ?? ""), `${option} is offered and refused: ${answer.json.error}`);
    undo();
  }
});

await test("a fighter 1 taking paladin 2 is offered the paladin's Fighting Style", async () => {
  const seated = await sweep.seat({ level: 1, classId: "fighter" });
  sweep.world.patch(seated.id, { abilities: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } });
  const first = await sweep.patch({ level: 2, levelUpClass: "paladin" });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const { json } = await sweep.offer("?class=paladin");
  const style = (json.choices.featurePicks ?? []).find((entry) => entry.label === "Fighting Style");
  assert.ok(style, `paladin 2 offers no Fighting Style: ${JSON.stringify(json.choices.featurePicks)}`);
  assert.equal(style.count, 1);
  // The style the fighter's slot holds is not offered again. (A style only
  // the fighter's list has may still be offered: the held Defense then sits
  // in the paladin's slot, feature-effects.ts newStyleFits.)
  assert.ok(!style.options.includes("Fighting Style: Defense") || !sweep.sheet().features.some((feature) => feature.name === "Fighting Style: Defense"), style.options.join(", "));
  const pick = style.options.find((name) => name === "Fighting Style: Protection") ?? style.options[0];
  const taken = await sweep.patch({ level: 3, levelUpClass: "paladin", features: [{ name: pick, source: "choice" }] });
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
  assert.ok(sweep.sheet().features.some((feature) => feature.name === pick), `the level-up dropped ${pick}`);
  const after = await sweep.offer("?class=paladin");
  assert.ok(!after.json.owedFromEarlierLevels.some((line) => /fighting style/i.test(line)), `still owed: ${after.json.owedFromEarlierLevels}`);
});

await test("an Eldritch Knight's offer names its schools", async () => {
  await sweep.seat({ level: 1, classId: "fighter" });
  await sweep.climb({ to: 3, subclass: "Eldritch Knight" });
  const { json } = await sweep.offer();
  const spells = json.choices.spells;
  assert.ok(spells, `no spells in the offer: ${JSON.stringify(json.choices)}`);
  assert.deepEqual(spells.schools?.from.map(key), ["abjuration", "evocation"], JSON.stringify(spells));
  assert.equal(typeof spells.schools.otherSchoolPicks, "number");
  assert.match(spells.note, /abjuration and evocation/);
});

if (hasPack) {
  await test("the pack's Mechanist is offered its next level", async () => {
    if (!sweep.sb.classes.some((klass) => klass.id === "mechanist")) return;
    await sweep.seat({ level: 1, classId: "mechanist" });
    const { status, json } = await sweep.offer();
    assert.equal(status, 200, `the offer refused the Mechanist: ${JSON.stringify(json)}`);
    assert.equal(json.levelUpClass, "mechanist");
  });
}

sweep.close();
console.log(`${passed} passed`);
