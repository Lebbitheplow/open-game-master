// A reaction answers what happened (src/lib/srd/trigger-table.ts, the door in
// src/lib/dm/reaction-triggers.ts, the records in src/lib/dm/last-save.ts):
// SRD 5.1, Reactions, "an instant response to a trigger of some kind". With
// nothing on record it is refused and nothing is spent; with its trigger open
// it is taken, and the Hand deals its card then and only then.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-reaction-triggers");
const { openFor, triggerSpecFor, eventOfRecord } = await import("../src/lib/srd/trigger-table.ts");

// ---- the table, pure ----

const near = () => true;
const ctx = (holderId, extra = {}) => ({ holderId, near, quarry: () => null, label: `x@${holderId}`, ...extra });

test("a death opens Tokens of the Departed within its 30 feet, and nothing else does", () => {
  const spec = triggerSpecFor("Tokens of the Departed");
  const died = eventOfRecord({ id: "d1", kind: "death", characterId: "", ability: "con", forcerId: "e1", forcer: "Goblin", creatureType: "humanoid" });
  const hit = eventOfRecord({ id: "s1", kind: "save", characterId: "h1", ability: "wis", forcerId: "e1", forcer: "Goblin", success: true });
  assert.equal(openFor(spec, [died], ctx("h1")).length, 1);
  assert.equal(openFor(spec, [hit], ctx("h1")).length, 0);
  assert.equal(openFor(spec, [died], ctx("h1", { near: () => false })).length, 0, "beyond 30 feet");
  assert.equal(openFor(spec, [{ ...died, answered: ["x@h1"] }], ctx("h1")).length, 0, "answered once by this holder");
});

test("Skirmisher answers an enemy's turn ending beside the scout, not an ally's", () => {
  const spec = triggerSpecFor("Skirmisher");
  const enemyEnd = eventOfRecord({ id: "t1", kind: "turn_end", characterId: "", ability: "con", forcerId: "e1", forcer: "Goblin", enemy: true });
  const allyEnd = eventOfRecord({ id: "t2", kind: "turn_end", characterId: "", ability: "con", forcerId: "h2", forcer: "Ally", enemy: false });
  assert.equal(openFor(spec, [enemyEnd], ctx("h1")).length, 1);
  assert.equal(openFor(spec, [allyEnd], ctx("h1")).length, 0);
});

test("Slayer's Counter answers only the save its prey forced", () => {
  const spec = triggerSpecFor("Slayer's Counter");
  const save = eventOfRecord({ id: "s1", kind: "save", characterId: "h1", ability: "wis", forcerId: "e1", forcer: "Goblin", success: false });
  assert.equal(openFor(spec, [save], ctx("h1", { quarry: () => "e1" })).length, 1);
  assert.equal(openFor(spec, [save], ctx("h1", { quarry: () => "e2" })).length, 0);
});

test("the names are found as the engine names them (textKey): apostrophes and Raging Storm's environments", () => {
  assert.ok(triggerSpecFor("Slayer's Counter"));
  assert.ok(triggerSpecFor("Raging Storm", { gateCondition: "storm aura (desert)" }));
  assert.equal(triggerSpecFor("Uncanny Dodge"), null, "a hit reaction answers its own hit lookup");
});

// ---- the engine and the Hand ----

const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { closeHitsAtTurnEnd } = await import("../src/lib/dm/last-hit.ts");

const hero = (extra) => world.addHero({ level: 17, maxHp: 80, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, ...extra });
const phantom = hero({ class: "rogue", subclass: "Phantom" });
const warlock = hero({ class: "warlock", subclass: "The Archfey", spellcasting: { ability: "cha", slots: {}, pact: { level: 5, max: 3, used: 0 }, prepared: [], known: ["Hellish Rebuke"], cantrips: [] } });
const scout = hero({ class: "rogue", subclass: "Scout" });

async function stage() {
  await kit.endFight();
  // Two foes, so the fight goes on when one of them dies.
  await kit.fight(2, { heroFaces: { [phantom.id]: 19, [warlock.id]: 3, [scout.id]: 2 } });
  const [enemy, other] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.setEnemy(other.id, { maxHp: 300, currentHp: 300 });
  kit.place(other.id, 15, 15);
  kit.place(phantom.id, 5, 5);
  kit.place(warlock.id, 4, 5);
  kit.place(scout.id, 6, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(phantom.id);
  return enemy;
}
const view = () => activePublicEncounter(world.campaignId);
const cards = (who, name) => reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, view()?.lastHits ?? [], world.sheets(), "you", undefined, view()?.lastSaves ?? []).filter((card) => card.name === name);
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });

await test("Tokens of the Departed: refused with nobody dead, taken once a creature dies within 30 feet", async () => {
  const enemy = await stage();
  const before = world.encounter().reactionsUsed.length;
  const idle = await react(phantom, "Tokens of the Departed");
  assert.equal(idle.ok, false);
  assert.equal(idle.refused, "rules");
  assert.equal(world.encounter().reactionsUsed.length, before, "the refusal spent nothing");
  assert.equal(cards(phantom, "Tokens of the Departed").length, 0, "no card with nobody dead");
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.giveTurn(scout.id);
  world.dice(19, 5);
  const killed = await world.invoke("pc_attack", { characterId: scout.id, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(killed.ok, true, killed.error);
  assert.equal(cards(phantom, "Tokens of the Departed").length, 1, "the death deals the card");
  const out = await react(phantom, "Tokens of the Departed");
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(phantom.id).conditions.includes("soul trinket"));
});

await test("Hellish Rebuke answers a creature's damage through a failed save, and its card comes up for it", async () => {
  const enemy = await stage();
  assert.equal(cards(warlock, "Hellish Rebuke").length, 0);
  world.dice(1, 3, 3);
  const forced = await world.invoke("cast_at_player", { characterId: warlock.id, casterEnemyId: enemy.id, saveAbility: "wis", dc: 25, damage: "2d6", damageType: "psychic" });
  world.clearDice();
  assert.equal(forced.ok, true, forced.error);
  const [card] = cards(warlock, "Hellish Rebuke");
  assert.ok(card, "the save's damage deals Hellish Rebuke");
  assert.equal(card.answers?.attackerId, enemy.id);
  world.dice(2, 5, 5, 5);
  const out = await react(warlock, "Hellish Rebuke", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

await test("Misty Escape waits for damage: no own-turn spend with nothing taken, accepted after a hit", async () => {
  const enemy = await stage();
  const idle = await world.invoke("use_resource", { characterId: warlock.id, resource: "Misty Escape" });
  assert.equal(idle.ok, false);
  assert.equal(world.sheet(warlock.id).resources.sub_misty_escape.used, 0);
  world.dice(19, 4);
  assert.equal((await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: warlock.id })).ok, true);
  world.clearDice();
  const out = await react(warlock, "Misty Escape");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(warlock.id).resources.sub_misty_escape.used, 1);
});

await test("Skirmisher answers an enemy ending its turn beside the scout, and refuses one ending it farther off", async () => {
  const enemy = await stage();
  kit.place(enemy.id, 6, 6);
  const encounter = world.encounter();
  closeHitsAtTurnEnd(world.campaignId, encounter, encounter.order.find((entry) => entry.enemyId === enemy.id));
  const out = await react(scout, "Skirmisher", { x: 7, y: 3 });
  assert.equal(out.ok, true, out.error);
  const again = await stage();
  kit.place(again.id, 9, 9);
  const live = world.encounter();
  closeHitsAtTurnEnd(world.campaignId, live, live.order.find((entry) => entry.enemyId === again.id));
  const far = await react(scout, "Skirmisher", { x: 7, y: 3 });
  assert.equal(far.ok, false);
  assert.match(far.error, /beyond 5 feet/);
});

// Halo of Spores answers "a creature you can see" starting its turn within
// 10 feet (authored sees: "attacker", refused in authored-reactions.ts): the
// Hand deals no card for a creature the druid cannot see, as the engine
// refuses it.
await test("Halo of Spores: no card for a creature the druid cannot see starting its turn beside them", async () => {
  const { triggerCards } = await import("../src/lib/battlemap/hand-react-triggers.ts");
  const druid = hero({ class: "druid", subclass: "Circle of Spores" });
  const sheet = world.sheet(druid.id);
  const began = { id: "ts1", kind: "turn_start", characterId: "", ability: "con", forcerId: "e9", forcer: "Goblin", enemy: true };
  const offTurn = { ...FRESH_TURN, myTurn: false };
  const halo = (unseen) => triggerCards(sheet, offTurn, [], [began], () => true, unseen).filter((card) => card.name === "Halo of Spores");
  assert.equal(halo(undefined).length, 1, "a seen goblin starting its turn beside the druid deals the card");
  assert.equal(halo({ has: () => false }).length, 1);
  assert.equal(halo({ has: (id) => id === "e9" }).length, 0, "an unseen goblin deals none");
});

world.close();
finish();
