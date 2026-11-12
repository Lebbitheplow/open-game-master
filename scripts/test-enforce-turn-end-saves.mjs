// The save a held creature makes "at the end of each of its turns" (SRD 5.1,
// Hold Person) comes at the end of a turn it took under the hold.
//
// The pointer never rests on an enemy: it walks past one, the enemy's turn
// is played in the DM turn after, and the save that turn's end grants is
// rolled when the pointer moves again (src/lib/dm/encounter-tools.ts
// advancePointer, src/lib/dm/condition-tick.ts endTurnSaves). In the
// 2026-11-09 play-test a bugbear went, then a companion held it with Hold
// Person, and the bugbear shook it off as the companion's turn ended, before
// it ever had a turn paralyzed. Only what held an enemy as its turn began is
// saved against at that turn's end now; a character's own save comes as
// their turn ends, as before.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-turn-end-saves");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listEffects } = await import("../src/lib/db/active-effects.ts");

const fighter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const wizard = world.addHero({
  class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED,
});

// The order of the play-test: the fighter, the creature, then the wizard
// who holds it. The fighter has the floor.
async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [fighter.id]: 18, [wizard.id]: 10 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((each) => (each.kind === "pc" ? each.characterId : each.enemyId) === id);
  const legendary = { ...encounter.legendary };
  delete legendary.walked;
  delete legendary.walkedHolds;
  kit.saveEncounter({
    ...encounter,
    order: [entry(fighter.id), entry(enemy.id), entry(wizard.id)],
    turnIndex: 0,
    turnBudget: null,
    legendary,
  });
  return enemy;
}

// Hold Person's paralysis as cast_at_enemy lays it, with a DC any roll
// passes: a save rolled at all ends it.
const HELD = { paralyzed: { spell: "Hold Person", source: wizard.id, saveEnds: { ability: "wis", dc: 1 } } };
const hold = (enemy) => kit.setEnemy(enemy.id, { conditions: ["paralyzed"], conditionMeta: HELD });
const held = (enemy) => kit.enemy(enemy.id).conditions.includes("paralyzed");

function endTurnOf(hero) {
  assert.equal(kit.current()?.characterId, hero.id, `${hero.name}'s turn`);
  assert.equal(kit.endTurn(hero.userId), true);
}

await test("A creature held after its turn this round does not save as the holder's turn ends: it saves at the end of its own next turn.", async () => {
  const enemy = await stage();
  endTurnOf(fighter);
  // The GM hands the turn on: the creature's turn is over; the wizard's has come.
  kit.handOnEnemies();
  hold(enemy);
  endTurnOf(wizard);
  assert.ok(held(enemy), "saved before it had a turn under the hold");
  endTurnOf(fighter);
  assert.ok(held(enemy), "its turn has only begun");
  endTurnOf(wizard);
  assert.ok(!held(enemy), "the end of its own turn brings the save");
});

await test("A creature held before its turn saves as that turn ends.", async () => {
  const enemy = await stage();
  hold(enemy);
  endTurnOf(fighter);
  assert.ok(held(enemy), "its turn has only begun");
  endTurnOf(wizard);
  assert.ok(!held(enemy), "the end of its turn brings the save");
});

await test("An effect with a save laid on a creature after its turn waits for the end of its next turn too.", async () => {
  const enemy = await stage();
  endTurnOf(fighter);
  kit.handOnEnemies();
  const out = await world.invoke("set_effect", {
    enemyId: enemy.id, name: "Witch's Curse", modifiers: [{ field: "attack", mode: "add", value: -2 }],
    saveAbility: "wis", saveDc: 1, visible: true,
  });
  assert.equal(out.ok, true, out.error);
  const cursed = () => listEffects(world.campaignId).some((effect) => effect.targetId === enemy.id);
  endTurnOf(wizard);
  assert.ok(cursed(), "saved before it had a turn under the curse");
  endTurnOf(fighter);
  endTurnOf(wizard);
  assert.ok(!cursed(), "the end of its own turn brings the save");
});

// The creature's turn runs from the move that walks past it until the turn
// after it begins: while it is still the creature's to play, a hold laid on
// it (a readied Hold Person released as it moves, a reaction) holds it
// through that turn's end, and the save comes then (SRD 5.1, Hold Person).
await test("A creature held while its own turn is still being played saves as that turn ends.", async () => {
  const enemy = await stage();
  endTurnOf(fighter);
  assert.deepEqual(world.encounter().legendary.due, [enemy.id], "the creature's turn is still to play");
  hold(enemy);
  endTurnOf(wizard);
  assert.ok(!held(enemy), "the end of the turn it was held in brings the save");
  // The same when the character after it begins their turn by acting: the
  // creature, paralyzed, has nothing left of its turn to wait for.
  const again = await stage();
  endTurnOf(fighter);
  hold(again);
  const dodged = await world.invoke("take_action", { characterId: wizard.id, action: "dodge" });
  assert.ok(!dodged.error, dodged.error);
  endTurnOf(wizard);
  assert.ok(!held(again), "the turn the wizard's act began ends the creature's, held");
});

await test("Once the character after it acts, the creature's turn is over: a hold that character lays waits for the creature's next turn.", async () => {
  const enemy = await stage();
  endTurnOf(fighter);
  const struck = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id });
  assert.ok(!struck.error, struck.error);
  const dodged = await world.invoke("take_action", { characterId: wizard.id, action: "dodge" });
  assert.ok(!dodged.error, dodged.error);
  hold(enemy);
  endTurnOf(wizard);
  assert.ok(held(enemy), "saved before it had a turn under the hold");
  endTurnOf(fighter);
  endTurnOf(wizard);
  assert.ok(!held(enemy), "the end of its own turn brings the save");
});

// The AI's own end_turn hands the creature to the reply it ends: what that
// reply lays on it before the turn after begins is laid in the creature's
// turn, and the pass is over once the reply is narrated.
await test("A curse the AI's reply lays on the creature it was handed is saved against as that creature's turn ends.", async () => {
  const enemy = await stage();
  model.script([
    reply({ calls: [modelCall("end_turn", { characterId: fighter.id }), modelCall("set_effect", { enemyId: enemy.id, name: "Witch's Curse", modifiers: [{ field: "attack", mode: "add", value: -2 }], saveAbility: "wis", saveDc: 1, visible: true })] }),
    reply({ text: "The curse settles on it." }),
  ]);
  await model.turn(world, "I step back and end my turn.", fighter.id, fighter.userId);
  await settleQueue(world.campaignId);
  const cursed = () => listEffects(world.campaignId).some((effect) => effect.targetId === enemy.id);
  assert.ok(cursed(), "the curse is laid");
  endTurnOf(wizard);
  assert.ok(!cursed(), "the end of the turn it was cursed in brings the save");
});

// A paralyzed character's turn is walked past, starting and ending in the
// one move, so a hold that leaves them able to act shows whose turn's end
// the save waits for.
await test("A character held after their turn saves at the end of their own next turn, not at the end of the holder's.", async () => {
  await stage();
  endTurnOf(fighter);
  world.patch(fighter.id, { conditions: ["frightened"], conditionMeta: { frightened: { spell: "Fear", source: "a caster", saveEnds: { ability: "wis", dc: 1 } } } });
  const frightened = () => world.sheet(fighter.id).conditions.includes("frightened");
  endTurnOf(wizard);
  assert.ok(frightened(), "saved as another's turn ended");
  endTurnOf(fighter);
  assert.ok(!frightened(), "the end of their own turn brings the save");
});

model.close();
finish();
