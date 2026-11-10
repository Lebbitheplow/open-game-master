// The counters the gap sweep found broken outright (scripts/test-enforce-sweep-
// spends-*.mjs), each held here on the path a table plays it:
//
//   - Defensive Field: the Armorer's counter matched a feature nobody holds,
//     so the Guardian's temporary hit points could never be spent;
//   - Psionic Recovery is held in scripts/test-authored-spend-cards.mjs (the
//     die comes back);
//   - a counter that makes creatures save rolls them in the spend, and asks
//     for them by id when none is named (src/lib/dm/counter-saves.ts);
//   - Gathered Swarm's push follows a hit, not a miss, and takes the swarm's
//     die back off;
//   - a pool spent only through a named option refuses a bare spend (WAVE1
//     R10), and a counter whose use is a spell is paid by the spell's cast;
//   - the Hand's card reads the counter's cost and precondition from the
//     field use_resource reads (src/lib/srd/counter-rules.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-counter-repairs");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { wildShapeForms } = await import("../src/lib/srd/beast-forms.ts");
const { BEAST_INDEX } = await import("../src/lib/srd/wild-shape-caps.ts");
const world = await openWorld({ campaign: { maxPlayers: 40 } });
const kit = await combatKit(world);

const abilities = { str: 16, dex: 14, con: 14, int: 16, wis: 12, cha: 10 };
const hero = (klass, subclass, level, extra = {}) =>
  world.addHero({ user: world.owner, class: klass, subclass, level, abilities, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }], ...extra });

await test("An Armorer holds Defensive Field's uses, and in Guardian armor a bonus action gives temporary hit points equal to the artificer level.", async () => {
  // SRD-style text (src/lib/srd/subclasses.json, Armor Model): "Defensive Field
  // (a bonus action gives you temporary hit points equal to your artificer
  // level, a proficiency-bonus number of times per long rest)".
  const armorer = hero("artificer", "Armorer", 5);
  assert.ok(world.sheet(armorer.id).resources.sub_defensive_field, `no Defensive Field counter: ${Object.keys(world.sheet(armorer.id).resources).join(", ")}`);
  assert.equal(world.sheet(armorer.id).resources.sub_defensive_field.max, 3, "a proficiency-bonus number of uses");
  const chosen = await world.invoke("use_resource", { characterId: armorer.id, resource: "Armor Model", variant: "Guardian" });
  assert.equal(chosen.ok, true, chosen.error);
  await kit.fight(1, { heroFaces: { [armorer.id]: 19 } });
  kit.giveTurn(armorer.id);
  const out = await world.invoke("use_resource", { characterId: armorer.id, resource: "Defensive Field" });
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(armorer.id);
  assert.equal(sheet.tempHp, 5);
  assert.equal(sheet.resources.sub_defensive_field.used, 1);
  await kit.endFight();
});

await test("An Infiltrator's Defensive Field is refused with nothing spent: it belongs to the Guardian armor.", async () => {
  const armorer = hero("artificer", "Armorer", 5);
  await world.invoke("use_resource", { characterId: armorer.id, resource: "Armor Model", variant: "Infiltrator" });
  const out = await world.invoke("use_resource", { characterId: armorer.id, resource: "Defensive Field" });
  assert.notEqual(out.ok, true);
  assert.equal(world.sheet(armorer.id).resources.sub_defensive_field.used, 0);
});

const cardOf = (sheet, id, turn = FRESH_TURN) => deriveHand(sheet, turn, {}).find((card) => card.id === id || card.intent?.resourceId === id);

await test("The Hand's beast list is the engine's: every SRD beast, its challenge rating and the speeds Wild Shape gates.", () => {
  const engine = wildShapeForms({ maxCr: 30, fly: true, swim: true }).map((form) => `${form.name}|${form.cr}|${Boolean(form.fly)}|${Boolean(form.swim)}`).sort();
  const hand = BEAST_INDEX.map((form) => `${form.n}|${form.cr}|${Boolean(form.fly)}|${Boolean(form.swim)}`).sort();
  assert.deepEqual(hand, engine);
});

await test("A Drake's Breath names its creatures and the spend rolls each one's save and deals the damage; named none, it asks and spends nothing.", async () => {
  const ranger = hero("ranger", "Drakewarden", 11, { abilities: { ...abilities, wis: 16 } });
  await kit.fight(1, { heroFaces: { [ranger.id]: 19 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 200, currentHp: 200 });
  kit.place(ranger.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.giveTurn(ranger.id);
  const before = world.sheet(ranger.id).resources.sub_drakes_breath.used;
  const bare = await world.invoke("use_resource", { characterId: ranger.id, resource: "Drake's Breath" });
  assert.notEqual(bare.ok, true, "no creature named");
  assert.equal(world.sheet(ranger.id).resources.sub_drakes_breath.used, before, "the refusal spends nothing");
  world.dice(1, ...Array(8).fill(6));
  const out = await world.invoke("use_resource", { characterId: ranger.id, resource: "Drake's Breath", targetEnemyId: goblin.id, variant: "fire" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.resolveWith, undefined, "nothing is handed back for a second call");
  assert.ok(kit.enemy(goblin.id).currentHp < 200, `the breath landed: ${JSON.stringify(out).slice(0, 300)}`);
  assert.equal(world.sheet(ranger.id).resources.sub_drakes_breath.used, before + 1);
  await kit.endFight();
});

await test("Gathered Swarm moves the creature the ranger hit, in place of the swarm's damage: refused after a miss, and the die the hit dealt comes back.", async () => {
  const swarm = hero("ranger", "Swarmkeeper", 5, { abilities: { ...abilities, wis: 16 } });
  await kit.fight(1, { heroFaces: { [swarm.id]: 19 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 200, currentHp: 200 });
  kit.place(swarm.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.giveTurn(swarm.id);
  const missed = await kit.swing(swarm.id, goblin.id, [2]);
  assert.equal(missed.ok, true, missed.error);
  const afterMiss = await world.invoke("use_resource", { characterId: swarm.id, resource: "Gathered Swarm", targetEnemyId: goblin.id });
  assert.notEqual(afterMiss.ok, true, "a miss lets the swarm do nothing");
  kit.freshTurn();
  const struck = await kit.swing(swarm.id, goblin.id, [18, 4, 6]);
  assert.equal(struck.ok, true, struck.error);
  const hurt = kit.enemy(goblin.id).currentHp;
  world.dice(1);
  const push = await world.invoke("use_resource", { characterId: swarm.id, resource: "Gathered Swarm", targetEnemyId: goblin.id });
  world.clearDice();
  assert.equal(push.ok, true, push.error);
  assert.equal(kit.enemy(goblin.id).currentHp, hurt + 6, "the swarm's 1d6 (a 6) taken back");
  const again = await world.invoke("use_resource", { characterId: swarm.id, resource: "Gathered Swarm", targetEnemyId: goblin.id });
  assert.notEqual(again.ok, true, "once a turn");
  await kit.endFight();
});

await test("Sorcery points refuse a bare spend and spend nothing; a named option still goes through (WAVE1 R10).", async () => {
  await kit.endFight();
  const sorcerer = hero("sorcerer", "Draconic Bloodline", 5, { spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Magic Missile"], cantrips: [] } });
  const bare = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "sorcery_points" });
  assert.notEqual(bare.ok, true);
  assert.match(String(bare.error), /not spent by a use_resource call of its own/);
  assert.equal(world.sheet(sorcerer.id).resources.sorcery_points.used, 0);
  const slots = world.sheet(sorcerer.id).spellcasting.slots;
  world.patch(sorcerer.id, { spellcasting: { ...world.sheet(sorcerer.id).spellcasting, slots: { ...slots, 1: { ...slots[1], used: 1 } } } });
  const made = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "sorcery_points", variant: "create slot", amount: 1 });
  assert.equal(made.ok, true, made.error);
  assert.equal(world.sheet(sorcerer.id).resources.sorcery_points.used, 2);
});

await test("Star Map's guiding bolt is cast with no slot and spends the map's use; a bare spend of the counter is refused.", async () => {
  const druid = hero("druid", "Circle of Stars", 3, { abilities: { ...abilities, wis: 16 }, spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: [] } });
  const bare = await world.invoke("use_resource", { characterId: druid.id, resource: "sub_star_map" });
  assert.notEqual(bare.ok, true);
  await kit.fight(1, { heroFaces: { [druid.id]: 19 } });
  const [goblin] = world.enemies();
  kit.giveTurn(druid.id);
  const slots = JSON.stringify(world.sheet(druid.id).spellcasting.slots);
  world.dice(15, 4, 4, 4, 4);
  const cast = await world.invoke("pc_attack", { characterId: druid.id, spell: "Guiding Bolt", targetEnemyId: goblin.id });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(JSON.stringify(world.sheet(druid.id).spellcasting.slots), slots, "no slot spent");
  assert.equal(world.sheet(druid.id).resources.sub_star_map.used, 1, "the map's use spent");
  await kit.endFight();
});

await test("The Hand's card reads the counter's own cost and precondition: Rage is shut while raging, Wild Shape offers the forms the druid can take, Bardic Inspiration offers no (you) chip.", async () => {
  await kit.endFight();
  const barbarian = hero("barbarian", "Path of the Berserker", 3);
  const raged = await world.invoke("use_resource", { characterId: barbarian.id, resource: "rage" });
  assert.equal(raged.ok, true, raged.error);
  const rage = cardOf(world.sheet(barbarian.id), "feature:rage");
  assert.ok(rage?.disabled, `Rage is shut while raging: ${JSON.stringify(rage)?.slice(0, 200)} ${world.sheet(barbarian.id).conditions}`);
  const druid = hero("druid", "Circle of the Land", 4);
  const shape = cardOf(world.sheet(druid.id), "feature:wild_shape");
  assert.equal(shape.choice?.arg, "variant");
  assert.ok(shape.choice.options.some((option) => option.value === "Wolf"), "a CR 1/4 beast at 4th level");
  assert.ok(!shape.choice.options.some((option) => option.value === "Brown Bear"), "not a CR 1 beast at 4th level");
  const shaped = await world.invoke("use_resource", { characterId: druid.id, resource: "wild_shape", variant: "Wolf" });
  assert.equal(shaped.ok, true, shaped.error);
  const bard = hero("bard", "College of Lore", 3);
  assert.equal(cardOf(world.sheet(bard.id), "feature:bardic_inspiration").othersOnly, true);
});

finish();
