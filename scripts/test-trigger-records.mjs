// The trigger records the reactions and triggered uses of the class packages
// answer (src/lib/dm/last-save.ts recordTrigger, src/lib/srd/trigger-table.ts):
// each is written by the engine where the event happens, so a reaction to it
// answers the record and never the call's word. SRD 5.1, Reactions, "an
// instant response to a trigger of some kind".
//   cast              a character's spell at the allies it targets (cast_buff, heal)
//   steadied          a death save that succeeds, a creature stabilized
//   echo_destroyed    a Echo Knight's echo destroyed by an attack
//   inspired_success  a roll a Bardic Inspiration die made succeed
//   moved_near        a creature walking up to a character (move_token)
//   rage_entered      the turn a barbarian entered their rage (a turn mark)
//   save              a save the GM asked a player to roll on a foe's turn
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-trigger-records");
const { openFor, triggerSpecFor, eventOfRecord } = await import("../src/lib/srd/trigger-table.ts");

// ---- the table, pure ----

const near = () => true;
const ctx = (holderId, extra = {}) => ({ holderId, near, quarry: () => null, label: `x@${holderId}`, ...extra });
const record = (fields) => eventOfRecord({ id: "r1", characterId: "", ability: "con", forcerId: "", forcer: "", ...fields });

test("Halo of Spores answers a creature moving into 10 feet of the druid, not one already there", () => {
  const spec = triggerSpecFor("Halo of Spores");
  const walkedUp = record({ kind: "moved_near", characterId: "d1", forcerId: "e1", forcer: "Goblin", feet: 10, fromFeet: 25 });
  assert.equal(openFor(spec, [walkedUp], ctx("d1")).length, 1);
  assert.equal(openFor(spec, [{ ...walkedUp, fromFeet: 10 }], ctx("d1")).length, 0, "it stood within 10 feet already");
  assert.equal(openFor(spec, [{ ...walkedUp, feet: 15 }], ctx("d1")).length, 0, "it came no nearer than 15 feet");
  assert.equal(openFor(spec, [walkedUp], ctx("d2")).length, 0, "it walked up to someone else");
});

test("Defy Death answers the warlock's own death save succeeding, or a creature they stabilized with spare the dying", () => {
  const spec = triggerSpecFor("Defy Death", { counterId: "sub_defy_death" });
  const own = record({ kind: "steadied", characterId: "w1", forcerId: "w1", forcer: "Warlock", how: "death save" });
  const spared = record({ kind: "steadied", characterId: "a1", forcerId: "w1", forcer: "Warlock", how: "spare the dying" });
  const medicine = record({ kind: "steadied", characterId: "a1", forcerId: "w1", forcer: "Warlock", how: "medicine" });
  assert.equal(openFor(spec, [own], ctx("w1")).length, 1);
  assert.equal(openFor(spec, [spared], ctx("w1")).length, 1);
  assert.equal(openFor(spec, [medicine], ctx("w1")).length, 0, "a Medicine check is no spare the dying");
  assert.equal(openFor(spec, [spared], ctx("a1")).length, 0, "the one spared did not cheat death by a save");
});

test("Voice of Authority answers a spell of 1st level or higher its cleric cast at the ally", () => {
  const spec = triggerSpecFor("Voice of Authority");
  const blessed = record({ kind: "cast", characterId: "a1", forcerId: "c1", forcer: "Cleric", spell: "Bless", level: 1, enemy: false });
  assert.equal(openFor(spec, [blessed], ctx("a1", { featureHolderId: "c1" })).length, 1);
  assert.equal(openFor(spec, [{ ...blessed, level: 0 }], ctx("a1", { featureHolderId: "c1" })).length, 0, "a cantrip");
  assert.equal(openFor(spec, [blessed], ctx("a1", { featureHolderId: "c2" })).length, 0, "another caster's spell");
  assert.equal(openFor(spec, [blessed], ctx("a2", { featureHolderId: "c1" })).length, 0, "aimed at someone else");
});

test("Infectious Inspiration answers another creature's success with the bard's die, the Echo and the rage their own", () => {
  const infectious = triggerSpecFor("Infectious Inspiration", { counterId: "sub_infectious_inspiration" });
  const made = record({ kind: "inspired_success", characterId: "a1", forcerId: "b1", forcer: "Bard", how: "save" });
  assert.equal(openFor(infectious, [made], ctx("b1")).length, 1);
  assert.equal(openFor(infectious, [made], ctx("b2")).length, 0, "another bard's die");
  assert.equal(openFor(infectious, [made], ctx("b1", { near: () => false })).length, 0, "beyond 60 feet");
  const reclaim = triggerSpecFor("Reclaim Potential", { counterId: "sub_reclaim_potential" });
  const broken = record({ kind: "echo_destroyed", characterId: "k1", forcerId: "e1", forcer: "Ogre" });
  assert.equal(openFor(reclaim, [broken], ctx("k1")).length, 1);
  assert.equal(openFor(reclaim, [broken], ctx("k2")).length, 0);
  const hunt = triggerSpecFor("Call the Hunt", { counterId: "sub_call_the_hunt" });
  const raged = record({ kind: "rage_entered", characterId: "r1", forcerId: "r1", forcer: "Barbarian" });
  assert.equal(openFor(hunt, [raged], ctx("r1")).length, 1);
  assert.equal(openFor(hunt, [raged], ctx("r2")).length, 0);
});

// ---- the engine writes them ----

const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { triggerEvents } = await import("../src/lib/dm/reaction-triggers.ts");
const { rollDeathSave } = await import("../src/lib/dm/death.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

const hero = (extra) => world.addHero({ level: 17, maxHp: 80, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, ...extra });
const druid = hero({ class: "druid", subclass: "Circle of Spores" });
const cleric = hero({ class: "cleric", subclass: "Order Domain", spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: ["Bless", "Cure Wounds"], known: [], cantrips: [] } });
const barbarian = hero({ class: "barbarian", subclass: "Path of the Beast" });

async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [druid.id]: 19, [cleric.id]: 15, [barbarian.id]: 12 } });
  const [enemy] = world.enemies();
  kit.place(druid.id, 5, 5);
  kit.place(cleric.id, 4, 5);
  kit.place(barbarian.id, 6, 5);
  kit.place(enemy.id, 5, 12);
  return enemy;
}
const events = (kind) => triggerEvents(world.campaignId).filter((event) => event.kind === kind);
const enemyTurn = (enemyId) => {
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === enemyId), turnBudget: null });
};

await test("move_token: a creature walking up to the druid is on record with how far it stood and how near it came", async () => {
  const enemy = await stage();
  enemyTurn(enemy.id);
  const moved = await world.invoke("move_token", { token: enemy.id, x: 5, y: 7 });
  assert.equal(moved.ok, true, moved.error);
  const [up] = events("moved_near").filter((event) => event.characterId === druid.id);
  assert.ok(up, "the walk up to the druid is recorded");
  assert.equal(up.creatureId, enemy.id);
  assert.equal(up.feet, 10);
  assert.ok(up.fromFeet > 10);
});

await test("Rage marks the turn it is entered on", async () => {
  await stage();
  kit.giveTurn(barbarian.id);
  assert.equal(events("rage_entered").length, 0);
  const raged = await world.invoke("use_resource", { characterId: barbarian.id, resource: "Rage" });
  assert.equal(raged.ok, true, raged.error);
  const [mark] = events("rage_entered");
  assert.equal(mark?.characterId, barbarian.id);
});

await test("cast_buff and heal record the cleric's casting at each ally it targets, with its slot level", async () => {
  await stage();
  kit.giveTurn(cleric.id);
  const blessed = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Bless", targetCharacterIds: [druid.id, barbarian.id] });
  assert.equal(blessed.ok, true, blessed.error);
  const casts = events("cast").filter((event) => event.creatureId === cleric.id);
  assert.deepEqual(casts.map((event) => event.characterId).sort(), [druid.id, barbarian.id].sort());
  assert.ok(casts.every((event) => event.level === 1 && event.enemy === false));
});

await test("a death save that succeeds steadies the one who rolled it", async () => {
  await stage();
  world.patch(druid.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.dice(15);
  rollDeathSave(getCampaignById(world.campaignId), druid.id);
  world.clearDice();
  const [steadied] = events("steadied");
  assert.equal(steadied?.characterId, druid.id);
  assert.equal(steadied?.how, "death save");
});

await test("a save the GM asks of a player on a foe's turn goes on record with that foe as its forcer", async () => {
  const enemy = await stage();
  enemyTurn(enemy.id);
  world.dice(4);
  const rolled = await world.invoke("request_roll", { characterId: cleric.id, kind: "saving_throw", ability: "wis", dc: 15 });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  const [save] = events("save").filter((event) => event.characterId === cleric.id);
  assert.ok(save, "the requested save is on record");
  assert.equal(save.creatureId, enemy.id);
  assert.equal(save.success, false);
});

world.close();
finish();
