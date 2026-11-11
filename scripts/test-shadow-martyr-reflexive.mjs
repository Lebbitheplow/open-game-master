// Shadow Martyr spent its use and changed nothing, from a card in the Hand on the
// fighter's own turn. It now answers a hit on another creature, which becomes a
// miss. Reflexive Resistance covered any ally and a ranger with no drake; it now
// covers the ranger, while their drake is out.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-shadow-martyr-reflexive");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionAim, reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");

const { ECHO_OUT } = await import("../src/lib/srd/authored-effects-data-b.ts");
const hero = (classId, subclass, level = 20) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });

async function stage(holder, ally, enemies = 1) {
  await kit.endFight();
  await kit.fight(enemies, { heroFaces: { [holder.id]: 3 } });
  const foes = world.enemies();
  foes.forEach((enemy, at) => {
    kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
    kit.place(enemy.id, 5 - at, 6);
  });
  kit.place(holder.id, 5, 5);
  kit.place(ally.id, 4, 5);
  kit.freshRound();
  for (const who of [holder, ally]) world.patch(who.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  // An Echo Knight's echo is out: Shadow Martyr sends it into a hit only while
  // it is (Manifest Echo leaves the mark, authored-effects-data-b.ts).
  if (/echo knight/i.test(world.sheet(holder.id).subclass ?? "")) world.patch(holder.id, { conditions: [ECHO_OUT], conditionMeta: { [ECHO_OUT]: { rounds: 600 } } });
  return foes;
}
// A club at +4, 1d6+2: a 16 on the die is a 20, through AC 12, for 6.
const strike = async (enemy, target) => {
  world.dice(16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
const offered = (who, name) => reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).filter((card) => card.name === name);
const onOwnTurn = (who, name) => deriveHand(world.sheet(who.id), FRESH_TURN, {}).some((card) => card.name === name);
const used = (who, id) => world.sheet(who.id).resources[id].used;
const setUsed = (who, id, count) => world.patch(who.id, { resources: { ...world.sheet(who.id).resources, [id]: { ...world.sheet(who.id).resources[id], used: count } } });
const martyr = (who, ally, extra = {}) => world.invoke("use_reaction", { characterId: who.id, feature: "Shadow Martyr", ...(ally ? { targetCharacterId: ally.id } : {}), ...extra });
const backReaction = () => kit.saveEncounter({ ...world.encounter(), reactionsUsed: [] });

const knight = hero("fighter", "Echo Knight");
const friend = hero("cleric", "Life Domain");
const COUNTER = "sub_shadow_martyr";

await test("Shadow Martyr: a card on an ally's hit, aimed at that ally; none on the fighter's turn or their own hit.", async () => {
  const [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  assert.equal(onOwnTurn(knight, "Shadow Martyr"), false);
  assert.equal(offered(knight, "Shadow Martyr").length, 0);
  await strike(enemy, knight);
  assert.equal(offered(knight, "Shadow Martyr").length, 0, "the fighter's own hit is not aimed at another creature");
  const [next] = await stage(knight, friend);
  await strike(next, friend);
  const [card] = offered(knight, "Shadow Martyr");
  assert.ok(card, "the ally's hit offers it");
  assert.match(card.rules, /echo/);
  assert.equal(reactionAim(card, hits(), knight.id, world.sheets())?.id, friend.id);
});

await test("Shadow Martyr: the ally takes no damage, one use is spent, and the hit is answered once.", async () => {
  const [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  await strike(enemy, friend);
  assert.equal(world.sheet(friend.id).currentHp, 44);
  const out = await martyr(knight, friend);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(friend.id).currentHp, 50);
  assert.equal(world.sheet(knight.id).currentHp, 50, "the fighter takes none of it");
  assert.equal(used(knight, COUNTER), 1);
  assert.ok(world.encounter().reactionsUsed.includes(knight.id));
  assert.match(out.result.applied, /echo/);
  assert.equal(offered(knight, "Shadow Martyr").length, 0, "the use is gone");

  // With the use and the reaction back, the same hit is still answered.
  setUsed(knight, COUNTER, 0);
  backReaction();
  assert.equal(offered(knight, "Shadow Martyr").length, 0, "the hit is answered");
  const again = await martyr(knight, friend);
  assert.equal(again.ok, false);
  assert.equal(used(knight, COUNTER), 0);
  assert.equal(world.sheet(friend.id).currentHp, 50);
});

await test("Shadow Martyr: the same roll is made against the echo, AC 14 + proficiency, and the reply says whether it is destroyed.", async () => {
  // A 20th-level knight: the echo's AC is 20.
  let [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  await strike(enemy, friend);
  let out = await martyr(knight, friend);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /20 hits the echo \(AC 20, 1 hit point\) and destroys it/);
  assert.equal(world.sheet(knight.id).conditions.includes(ECHO_OUT), false, "the destroyed echo is no longer out");
  // With no echo out there is nothing to send into the next hit.
  backReaction();
  setUsed(knight, COUNTER, 0);
  kit.freshRound();
  await strike(enemy, friend);
  const none = await martyr(knight, friend);
  assert.equal(none.ok, false, "Shadow Martyr went through with no echo out");
  assert.equal(used(knight, COUNTER), 0);
  [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  world.dice(12, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: friend.id });
  world.clearDice();
  assert.equal(world.sheet(friend.id).currentHp, 44, "16 hits the ally's AC 12");
  out = await martyr(knight, friend);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /16 misses the echo \(AC 20\), which stays/);
  assert.equal(world.sheet(friend.id).currentHp, 50);
});

await test("Shadow Martyr: a played card reaches the engine with the ally and the hit it names.", async () => {
  const [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  await strike(enemy, friend);
  const [card] = offered(knight, "Shadow Martyr");
  const aim = reactionAim(card, hits(), knight.id, world.sheets());
  const [call] = directCardCalls({ ...card.intent, targetId: aim.id, targetName: aim.name, targetKind: aim.kind }, knight.id);
  assert.equal(call.name, "use_reaction");
  assert.equal(call.args.targetCharacterId, friend.id);
  assert.equal(call.args.hit, card.answers.hitId);
  const out = await world.invoke(call.name, call.args);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(friend.id).currentHp, 50);
  assert.equal(used(knight, COUNTER), 1);
});

await test("Shadow Martyr: a refusal spends nothing.", async () => {
  let [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  const spare = () => {
    assert.equal(used(knight, COUNTER), 0);
    assert.equal(world.encounter().reactionsUsed.includes(knight.id), false);
  };

  // No hit on the ally.
  assert.equal((await martyr(knight, friend)).ok, false);
  spare();
  // The fighter's own hit: named or not, the echo answers another creature's.
  await strike(enemy, knight);
  for (const aimed of [null, knight]) {
    const out = await martyr(knight, aimed);
    assert.equal(out.ok, false);
    assert.match(out.error, /another creature/);
    spare();
  }
  assert.equal(world.sheet(knight.id).currentHp, 44);

  // An ally's hit, and no ally named.
  [enemy] = await stage(knight, friend);
  await strike(enemy, friend);
  assert.equal((await martyr(knight, null)).ok, false);
  spare();
  assert.equal(world.sheet(friend.id).currentHp, 44);

  // The use already gone.
  setUsed(knight, COUNTER, 1);
  const out = await martyr(knight, friend);
  assert.match(out.error, /nothing left/);
  assert.equal(world.sheet(friend.id).currentHp, 44);
  assert.equal(world.encounter().reactionsUsed.includes(knight.id), false);
});

await test("Shadow Martyr: two hits open on the ally are two cards, each naming its own.", async () => {
  await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  const open = ["h1", "h2"].map((id) => ({ id, characterId: friend.id, hit: true, hits: 1, source: "attack", ranged: false, attacker: "Goblin", attackerId: id, attack: "Club", type: "bludgeoning", damage: 6, answered: [] }));
  const cards = reactionCards(world.sheet(knight.id), { ...FRESH_TURN, myTurn: false }, open, world.sheets()).filter((card) => card.name === "Shadow Martyr");
  assert.deepEqual(cards.map((card) => card.answers?.hitId), ["h1", "h2"]);
});

await test("Shadow Martyr: of two hits open on the ally, it answers the one it names, and the other stands.", async () => {
  const [first, second] = await stage(knight, friend, 2);
  setUsed(knight, COUNTER, 0);
  const place = world.encounter().order.findIndex((entry) => entry.enemyId === first.id);
  kit.saveEncounter({ ...world.encounter(), orderReady: true, round: 2, turnIndex: place, turnBudget: null, surprisedIds: [], reactionsUsed: [], legendary: { ...world.encounter().legendary, due: [first.id, second.id] } });
  // One GM reply: an attack in a later one leaves the earlier hit past answering.
  const ai = { kind: "ai", turnId: createDmTurn(world.campaignId, [], "ai").id };
  for (const enemy of [first, second]) {
    world.dice(16, 4);
    const swing = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: enemy.id, targetCharacterId: friend.id } });
    world.clearDice();
    assert.equal(swing.ok, true, swing.error);
  }
  assert.equal(world.sheet(friend.id).currentHp, 38);
  const cards = offered(knight, "Shadow Martyr");
  assert.equal(cards.length, 2);
  const aim = cards.find((card) => card.answers?.attackerId === second.id);
  const out = await martyr(knight, friend, { hit: aim.answers.hitId });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(friend.id).currentHp, 44);
  const left = hits().filter((hit) => hit.characterId === friend.id && hit.hit);
  assert.deepEqual(left.map((hit) => hit.attackerId), [first.id]);
  assert.equal(used(knight, COUNTER), 1);
});

await test("Shadow Martyr: no reaction before 10th level, and use_resource points at use_reaction.", async () => {
  const young = hero("fighter", "Echo Knight", 9);
  const [enemy] = await stage(young, friend);
  await strike(enemy, friend);
  assert.equal(offered(young, "Shadow Martyr").length, 0);
  assert.equal((await martyr(young, friend)).ok, false);
  assert.equal(world.sheet(friend.id).currentHp, 44);

  await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  const out = await world.invoke("use_resource", { characterId: knight.id, resource: "Shadow Martyr" });
  assert.equal(out.ok, false);
  assert.match(out.error, /use_reaction/);
  assert.equal(used(knight, COUNTER), 0);
});

const RESIST = "sub_reflexive_resistance";
const reflexive = (who, ally) => world.invoke("use_reaction", { characterId: who.id, feature: "Reflexive Resistance", ...(ally ? { targetCharacterId: ally.id } : {}) });
const ranger = hero("ranger", "Drakewarden");
// Summoning the drake is an action on the ranger's own turn in a fight: the
// last case's fight is over before it is called.
await kit.endFight();
const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "drake", form: "drake", essence: "fire" });
assert.equal(summoned.ok, true, summoned.error);

await test("Reflexive Resistance: on the ranger's own hit, with the drake out, half comes back for one use.", async () => {
  const [enemy] = await stage(ranger, friend);
  await strike(enemy, ranger);
  assert.equal(offered(ranger, "Reflexive Resistance").length, 1);
  const before = used(ranger, RESIST);
  const out = await reflexive(ranger);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ranger.id).currentHp, 47);
  assert.equal(used(ranger, RESIST), before + 1);
  assert.equal(offered(ranger, "Reflexive Resistance").length, 0);
});

await test("Reflexive Resistance: no card for an ally's hit, and naming the ally is refused.", async () => {
  const [enemy] = await stage(ranger, friend);
  await strike(enemy, friend);
  assert.equal(offered(ranger, "Reflexive Resistance").length, 0);
  const before = used(ranger, RESIST);
  const out = await reflexive(ranger, friend);
  assert.equal(out.ok, false);
  assert.match(out.error, /covers only/);
  assert.equal(used(ranger, RESIST), before);
  assert.equal(world.sheet(friend.id).currentHp, 44);
});

await test("Reflexive Resistance: a ranger with no drake has no card, and is refused.", async () => {
  const lone = hero("ranger", "Drakewarden");
  const [enemy] = await stage(lone, friend);
  await strike(enemy, lone);
  assert.equal(offered(lone, "Reflexive Resistance").length, 0);
  const out = await reflexive(lone);
  assert.equal(out.ok, false);
  assert.match(out.error, /drake/);
  assert.equal(used(lone, RESIST), 0);
  assert.equal(world.sheet(lone.id).currentHp, 44);
});

await test("Reflexive Resistance: a drake at 0 hit points is not out.", async () => {
  const pets = world.sheet(ranger.id).pets;
  world.patch(ranger.id, { pets: pets.map((pet) => ({ ...pet, hp: 0 })) });
  const [enemy] = await stage(ranger, friend);
  await strike(enemy, ranger);
  assert.equal(offered(ranger, "Reflexive Resistance").length, 0);
  const before = used(ranger, RESIST);
  assert.equal((await reflexive(ranger)).ok, false);
  assert.equal(used(ranger, RESIST), before);
  assert.equal(world.sheet(ranger.id).currentHp, 44);
  world.patch(ranger.id, { pets });
});

await test("Dampen Elements, the other reaction of its kind, still covers an ally.", async () => {
  const cleric = hero("cleric", "Nature Domain");
  const open = [{ id: "h1", characterId: friend.id, hit: true, hits: 1, source: "attack", ranged: false, attacker: "Goblin", attackerId: "g", attack: "Firebolt", type: "fire", damage: 4, answered: [] }];
  const cards = reactionCards(world.sheet(cleric.id), { ...FRESH_TURN, myTurn: false }, open, world.sheets());
  assert.equal(cards.filter((card) => card.name === "Dampen Elements").length, 1);
});

// The echo's limits the fighter round left: with two echoes out (Legion of
// One) Shadow Martyr took the mark and both tokens when the one sent into the
// hit fell; an area never asked the echo's save; and a Beguiling Arrow's
// charm held through its ally's area.
const maps = await import("../src/lib/db/battle-maps.ts");
const { BEGUILED } = await import("../src/lib/srd/mt-fb-arcane-shot.ts");
const echoesOf = (who) => maps.listTokens(kit.map().id).filter((token) => token.kind === "prop" && token.refId.endsWith(who.id)).map((token) => token.refId.split(":")[0]).sort();
const putEcho = (who, ref, x, y) => maps.insertToken({ mapId: kit.map().id, campaignId: world.campaignId, kind: "prop", refId: `${ref}:${who.id}`, name: "echo", x, y });

await test("Shadow Martyr with two echoes out: only the one sent into the hit (the nearer the ally) is destroyed, and the mark stays.", async () => {
  const [enemy] = await stage(knight, friend);
  setUsed(knight, COUNTER, 0);
  backReaction();
  putEcho(knight, "echo", 4, 4);
  putEcho(knight, "echo2", 9, 9);
  await strike(enemy, friend);
  const out = await martyr(knight, friend);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(echoesOf(knight), ["echo2"], "the echo beside the ally took the hit; the far one stays");
  assert.ok(world.sheet(knight.id).conditions.includes(ECHO_OUT), "an echo is still out");
});

await test("An area asks the echo standing in it for its knight's save: failed, it is destroyed; and the caster's area ends their Beguiling Arrow charm.", async () => {
  const wizard = hero("wizard", "School of Evocation");
  const [enemy] = await stage(knight, friend);
  world.patch(wizard.id, { spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } }, prepared: ["Fireball"], known: [], cantrips: [], spellbook: ["Fireball"] }, equipment: [{ name: "Component pouch", qty: 1 }] });
  kit.place(wizard.id, 6, 5);
  kit.place(enemy.id, 14, 12);
  putEcho(knight, "echo", 14, 13);
  world.patch(knight.id, { conditions: [ECHO_OUT], conditionMeta: { [ECHO_OUT]: { rounds: 600 } } });
  kit.setEnemy(enemy.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: wizard.id, [BEGUILED]: true } } });
  kit.giveTurn(wizard.id);
  world.dice(2, 2, 2, 2, 2, 2, 2, 2, 20, 1);
  const out = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fireball", atX: 14, atY: 12 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(echoesOf(knight), [], `the echo failed its Dexterity save: ${JSON.stringify(out.result).slice(0, 300)}`);
  assert.ok(!world.sheet(knight.id).conditions.includes(ECHO_OUT), "the last echo gone, the mark goes");
  assert.ok(!world.enemies()[0].conditions.includes("charmed"), "the wizard's Fireball ends the charm the arrow laid for them");
});

world.close();
finish();
