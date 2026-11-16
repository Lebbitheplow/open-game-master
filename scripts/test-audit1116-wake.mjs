// Shaking a sleeper awake, from the 2026-11-16 audit's effects lens (Y17).
// SRD 5.1, Sleep: "Each creature affected by this spell falls unconscious
// until the spell ends, the sleeper takes damage, or someone uses an action
// to shake or slap the sleeper awake." Hypnotic Pattern: "The spell ends for
// an affected creature if it takes any damage or if someone else uses an
// action to shake the creature out of its stupor." take_action had no such
// action, so a sleeping ally stayed asleep until the GM cleared it by hand.
// Every door: a hero's take_action, a commanded companion's, a creature's
// for its ally, the Hand's Wake card (only beside such a sleeper), and the
// console's action list on a host that has it.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-wake");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");

const SLEEP = (source) => ({ spell: "Sleep", source, rounds: 10, endsOnDamage: true });
const PATTERN = (source) => ({ spell: "Hypnotic Pattern", source, rounds: 10, endsOnDamage: true });

// A fighter, a wizard and two goblins on a board, the fighter's turn.
async function stage() {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const fighter = world.addHero({ name: "Fig", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  const wizard = world.addHero({ name: "Wiz", class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED });
  await kit.fight(2, { heroFaces: { [fighter.id]: 20, [wizard.id]: 2 } });
  const [first, second] = world.enemies();
  for (const enemy of [first, second]) {
    kit.setEnemy(enemy.id, { maxHp: 40, currentHp: 40, stats: { ...DUMMY } });
  }
  kit.scatter();
  kit.place(fighter.id, 5, 5);
  kit.place(wizard.id, 6, 5);
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.characterId === fighter.id), turnBudget: null });
  return { world, kit, fighter, wizard, first, second };
}

const asleep = (world, id) => world.sheet(id).conditions.includes("unconscious");

await test("Y17: a hero spends their action to shake an ally out of Sleep, who wakes still prone", async () => {
  const { world, fighter, first } = await stage();
  const { wizard } = { wizard: world.sheets().find((sheet) => sheet.name === "Wiz") };
  world.patch(wizard.id, { conditions: ["unconscious", "prone"], conditionMeta: { unconscious: SLEEP(first.id), prone: { source: first.id } } });
  const out = await world.invoke("take_action", { characterId: fighter.id, action: "wake", targetCharacterId: wizard.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(!asleep(world, wizard.id), "awake");
  assert.ok(world.sheet(wizard.id).conditions.includes("prone"), "still lying where they fell");
  const again = await world.invoke("take_action", { characterId: fighter.id, action: "dodge" });
  assert.notEqual(again.ok, true, "the shake was the fighter's action");
});

await test("Y17: shaking a sleeper awake takes a creature within 5 feet, and spends nothing from farther", async () => {
  const { world, kit, fighter, wizard, first } = await stage();
  world.patch(wizard.id, { conditions: ["unconscious"], conditionMeta: { unconscious: SLEEP(first.id) } });
  kit.place(wizard.id, 9, 5);
  const out = await world.invoke("take_action", { characterId: fighter.id, action: "wake", targetCharacterId: wizard.id });
  assert.equal(out.refused, "rules", out.error ?? "it woke them");
  assert.ok(asleep(world, wizard.id));
  const dodge = await world.invoke("take_action", { characterId: fighter.id, action: "dodge" });
  assert.equal(dodge.ok, true, "the action is still theirs");
});

await test("Y17: a creature knocked out at 0 hit points is not shaken awake", async () => {
  const { world, fighter, wizard } = await stage();
  world.patch(wizard.id, { currentHp: 0, conditions: ["unconscious"], conditionMeta: {} });
  const out = await world.invoke("take_action", { characterId: fighter.id, action: "wake", targetCharacterId: wizard.id });
  assert.notEqual(out.ok, true);
  assert.ok(asleep(world, wizard.id));
});

await test("Y17: a commanded companion shakes a hero out of Hypnotic Pattern, and the speed hold goes with it", async () => {
  const { world, fighter, wizard, first } = await stage();
  getDatabase().prepare("UPDATE character_sheets SET is_companion = 1 WHERE id = ?").run(fighter.id);
  world.patch(wizard.id, { conditions: ["charmed", "incapacitated", "hypnotized"], conditionMeta: { charmed: PATTERN(first.id), incapacitated: PATTERN(first.id), hypnotized: PATTERN(first.id) } });
  const out = await world.invoke("take_action", { characterId: fighter.id, action: "wake", targetCharacterId: wizard.id });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.sheet(wizard.id).conditions, [], "out of the stupor");
});

await test("Y17: a creature shakes its ally out of Hypnotic Pattern with its own action", async () => {
  const { world, kit, wizard, first, second } = await stage();
  patchEnemyConditions(second.id, ["charmed", "incapacitated", "hypnotized"], { charmed: PATTERN(wizard.id), incapacitated: PATTERN(wizard.id), hypnotized: PATTERN(wizard.id) });
  kit.place(first.id, 10, 10);
  kit.place(second.id, 11, 10);
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === first.id), turnBudget: null, legendary: { ...encounter.legendary, due: [first.id], acted: null } });
  const out = await world.invoke("take_action", { enemyId: first.id, action: "wake", targetEnemyId: second.id });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(kit.enemy(second.id).conditions, [], "the goblin is free of the pattern");
  const dodge = await world.invoke("take_action", { enemyId: first.id, action: "dodge" });
  assert.notEqual(dodge.ok, true, "the shake was its action");
});

// ---- the Hand ----

const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");

await test("Y17: the Hand deals Wake only beside an ally held by Sleep or Hypnotic Pattern, and it plays take_action wake", async () => {
  const { world, fighter, wizard, first } = await stage();
  world.patch(wizard.id, { conditions: ["unconscious"], conditionMeta: { unconscious: SLEEP(first.id) } });
  const sheets = world.sheets();
  const hero = sheets.find((sheet) => sheet.id === fighter.id);
  const wake = (feet, offered = true) => deriveHand(hero, undefined, { gear: { sleepers: offered ? [{ id: wizard.id, name: "Wiz", feet }] : undefined } }).find((card) => card.id === "basic:wake");
  assert.ok(wake(5), "an ally asleep beside them");
  assert.equal(wake(10), undefined, "no card for one 10 feet away");
  assert.equal(wake(5, false), undefined, "no card from a host that does not resolve it");
  assert.ok(wake(undefined), "off the board nothing measures, as the engine's own reach says");
  const call = directCardCall({ card: "basic", action: "wake", targetId: wizard.id, targetKind: "ally" }, fighter.id);
  assert.deepEqual(call, { name: "take_action", args: { characterId: fighter.id, action: "wake", targetCharacterId: wizard.id } });
});

// ---- the console ----

await test("Y17: the console's take_action offers Wake on a host that has it, and an older host is offered none", async () => {
  const fs = await import("node:fs");
  const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
  const { fieldForHost } = await import("../src/lib/dm/catalog-types.ts");
  const action = adjudication("take_action").fields.find((field) => field.name === "action");
  const values = (offers) => fieldForHost(action, offers).options.map((option) => option.value);
  assert.ok(values(() => true).includes("wake"));
  assert.ok(!values(() => false).includes("wake"));
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(read("src/lib/capabilities.ts"), /^\s*shakeAwake: true,$/m);
  assert.match(read("src/lib/use-capabilities.ts"), /features\?: \{[^}]*shakeAwake\?: boolean/);
});

finish();
