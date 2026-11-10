// What a limited-use feature costs of the turn, and whether the table sees
// the count move. use_resource charges the feature's own cost (the action,
// the bonus action or the reaction its rules name, ResourceDef.action in
// src/lib/srd/class-resources.ts), and every spend the engine writes reaches
// the clients as an encounter_updated, so the pips on the board and in the
// Hand never wait for the next roll to catch up.
//
// Found in play: a Hexblade warlock cast Wrathful Smite (a bonus action) and
// then used Hexblade's Curse, a second bonus action the engine accepted,
// while the board kept showing the bonus action unspent.
//
// The costs are the books' (2014 rules: the PHB, Xanathar's, Tasha's, Van
// Richten's, Fizban's, Monsters of the Multiverse, Wildemount, Dragonlance);
// the genre classes' are their catalogs' (src/lib/classes/*-features.json).
import assert from "node:assert/strict";
import { beginBoardlessFight, casting, openTable, refusedUnchanged } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-feature-costs");
const world = await openTable();
const kit = await combatKit(world);
const { getDatabase } = await import("../src/lib/db/core.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const spend = (who, resource, extra = {}) => world.invoke("use_resource", { characterId: who.id, resource, ...extra });
const used = (who, id) => world.sheet(who.id).resources[id]?.used;
const lastSeq = (campaignId) =>
  getDatabase().prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_events WHERE campaign_id = ?").get(campaignId).seq;
// The encounter updates published since `seq`, as the table receives them.
const updatesSince = (campaignId, seq) =>
  getDatabase()
    .prepare("SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND seq > ? AND type = 'encounter_updated' ORDER BY seq")
    .all(campaignId, seq)
    .map((row) => JSON.parse(row.payload_json).encounter);

const hexblade = world.addHero({
  class: "warlock",
  subclass: "The Hexblade",
  level: 3,
  abilities: { cha: 16 },
  spellcasting: casting("cha", { 1: [2, 0] }, { known: ["Wrathful Smite"] }),
});
const sorcerer = world.addHero({ class: "sorcerer", subclass: "Clockwork Soul", level: 6, abilities: { cha: 16 } });

// A fight with `first` at the pointer and every hero's uses back.
async function stage(first) {
  await kit.endFight();
  for (const sheet of world.sheets()) {
    world.patch(sheet.id, {
      resources: Object.fromEntries(Object.entries(sheet.resources).map(([id, counter]) => [id, { ...counter, used: 0 }])),
    });
  }
  await kit.fight(1);
  kit.giveTurn(first.id);
  // Beside the hero: Hexblade's Curse takes "a creature you can see within
  // 30 feet of you", and the scattered goblin could stand further off.
  const [enemy] = world.enemies();
  kit.place(first.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  return enemy;
}

// Restore Balance answers "a roll within 60 feet" made with advantage or
// disadvantage, on record (src/lib/srd/trigger-table.ts; SRD 5.1, Reactions:
// "an instant response to a trigger"): an enemy's attack on a restrained hero,
// made on its turn, which is where the pointer is left.
async function edgeRoll(enemy, on = hexblade) {
  kit.freshRound();
  const live = world.encounter();
  encounters.saveEncounter({ ...live, turnIndex: live.order.findIndex((entry) => entry.enemyId === enemy.id), turnBudget: null });
  kit.place(on.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const was = world.sheet(on.id).conditions;
  world.patch(on.id, { conditions: [...was, "restrained"] });
  world.dice(15, 3, 1);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: on.id });
  world.clearDice();
  world.patch(on.id, { conditions: was });
  assert.equal(out.ok, true, out.error);
}

await test("a bonus-action feature after a bonus-action spell is refused, and costs nothing", async () => {
  const enemy = await stage(hexblade);
  const smite = await world.invoke("cast_buff", { characterId: hexblade.id, spell: "Wrathful Smite", level: 1 });
  assert.equal(smite.ok, true, smite.error);
  assert.equal(smite.result.cost, "their bonus action");
  await refusedUnchanged(
    world,
    hexblade.id,
    () => spend(hexblade, "Hexblade's Curse", { targetEnemyId: enemy.id }),
    "a second bonus action",
  );
  assert.equal(used(hexblade, "sub_hexblades_curse"), 0);
  const refusal = await spend(hexblade, "Hexblade's Curse", { targetEnemyId: enemy.id });
  assert.match(refusal.error, /already used their bonus action/);

  kit.giveTurn(hexblade.id);
  const curse = await spend(hexblade, "Hexblade's Curse", { targetEnemyId: enemy.id });
  assert.equal(curse.ok, true, curse.error);
  assert.equal(curse.result.cost, "their bonus action");
  assert.equal(used(hexblade, "sub_hexblades_curse"), 1);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("a spend with no roll reaches the table with the new count", async () => {
  await stage(hexblade);
  let seq = lastSeq(world.campaignId);
  const smite = await world.invoke("cast_buff", { characterId: hexblade.id, spell: "Wrathful Smite", level: 1 });
  assert.equal(smite.ok, true, smite.error);
  const updates = updatesSince(world.campaignId, seq);
  assert.ok(updates.length > 0, "cast_buff published no encounter update");
  assert.equal(updates.at(-1).turn.bonusUsed, true);

  seq = lastSeq(world.campaignId);
  const dash = await world.invoke("take_action", { characterId: hexblade.id, action: "dash" });
  assert.equal(dash.ok, true, dash.error);
  const dashed = updatesSince(world.campaignId, seq);
  assert.ok(dashed.length > 0, "take_action published no encounter update");
  assert.equal(dashed.at(-1).turn.actionUsed, true);

  seq = lastSeq(world.campaignId);
  const refused = await world.invoke("take_action", { characterId: hexblade.id, action: "dodge" });
  assert.equal(refused.ok, false);
  assert.equal(updatesSince(world.campaignId, seq).length, 0, "a refused spend published an update");
});

await test("a reaction feature spends the reaction, on the character's turn or off it", async () => {
  const enemy = await stage(hexblade);
  await edgeRoll(enemy);
  const flare = await spend(sorcerer, "Restore Balance");
  assert.equal(flare.ok, true, flare.error);
  assert.equal(flare.result.cost, "their reaction");
  assert.ok(world.encounter().reactionsUsed.includes(sorcerer.id));
  await refusedUnchanged(world, sorcerer.id, () => spend(sorcerer, "Restore Balance"), "a second reaction off their turn");
  assert.equal(used(sorcerer, "sub_restore_balance"), 1);

  // On their own turn, against a roll just made: the reaction is theirs to spend
  // there too, and a reaction spell after it is refused. (Chronal Shift took
  // this part once; a plain use of it is now sent to use_reaction.)
  await edgeRoll(enemy);
  kit.giveTurn(sorcerer.id);
  const own = await spend(sorcerer, "Restore Balance");
  assert.equal(own.ok, true, own.error);
  assert.ok(world.encounter().reactionsUsed.includes(sorcerer.id), "a reaction on their own turn");
  await refusedUnchanged(
    world,
    sorcerer.id,
    () => world.invoke("use_reaction", { characterId: sorcerer.id, feature: "Shield", level: 1 }),
    "a reaction spell after a reaction feature",
  );
  const shield = await world.invoke("use_reaction", { characterId: sorcerer.id, feature: "Shield", level: 1 });
  assert.match(shield.error, /already used their reaction/);

  // The reaction comes back when their next turn starts.
  await edgeRoll(enemy);
  kit.giveTurn(sorcerer.id);
  const again = await spend(sorcerer, "Restore Balance");
  assert.equal(again.ok, true, again.error);
});

await test("a refused spend costs nothing and tells the table nothing, whatever its cost", async () => {
  await stage(hexblade);
  const seq = lastSeq(world.campaignId);
  // Out of uses: the action, bonus and reaction costs alike are checked
  // before anything is written.
  for (const [who, name, id] of [
    [hexblade, "Hexblade's Curse", "sub_hexblades_curse"],
    [sorcerer, "Restore Balance", "sub_restore_balance"],
  ]) {
    world.patch(who.id, { resources: { ...world.sheet(who.id).resources, [id]: { ...world.sheet(who.id).resources[id], used: world.sheet(who.id).resources[id].max } } });
    const budget = world.encounter().turnBudget;
    const reactions = world.encounter().reactionsUsed;
    await refusedUnchanged(world, who.id, () => spend(who, name), `${name} with no use left`);
    assert.deepEqual(world.encounter().turnBudget, budget);
    assert.deepEqual(world.encounter().reactionsUsed, reactions);
  }
  const audits = getDatabase().prepare("SELECT COUNT(*) AS n FROM sheet_audit WHERE campaign_id = ?").get(world.campaignId).n;
  // Not their turn: an action-cost feature off-turn is refused up front.
  const paladin = world.addHero({ class: "paladin", level: 3, abilities: { cha: 14 } });
  await refusedUnchanged(world, paladin.id, () => spend(paladin, "Divine Sense"), "an action off their turn");
  assert.equal(updatesSince(world.campaignId, seq).length, 0, "a refused spend published an update");
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS n FROM sheet_audit WHERE campaign_id = ?").get(world.campaignId).n, audits);
});

await test("every spend that rolls nothing reaches the table", async () => {
  const enemy = await stage(hexblade);
  let seq = lastSeq(world.campaignId);
  const curse = await spend(hexblade, "Hexblade's Curse", { targetEnemyId: enemy.id });
  assert.equal(curse.ok, true, curse.error);
  assert.equal(updatesSince(world.campaignId, seq).at(-1)?.turn?.bonusUsed, true, "use_resource");

  await edgeRoll(enemy);
  seq = lastSeq(world.campaignId);
  const flare = await spend(sorcerer, "Restore Balance");
  assert.equal(flare.ok, true, flare.error);
  assert.ok(updatesSince(world.campaignId, seq).at(-1)?.reactionsUsed?.includes(sorcerer.id), "a reaction feature");

  kit.giveTurn(hexblade.id);
  world.patch(hexblade.id, { equipment: [...world.sheet(hexblade.id).equipment, { name: "Potion of Healing", qty: 1 }] });
  seq = lastSeq(world.campaignId);
  const potion = await world.invoke("use_item", { characterId: hexblade.id, item: "Potion of Healing" });
  assert.equal(potion.ok, true, potion.error);
  assert.equal(updatesSince(world.campaignId, seq).at(-1)?.turn?.actionUsed, true, "use_item");
});

await test("a spend tells only its own campaign", async () => {
  const other = await openTable();
  const otherKit = await combatKit(other);
  const warlock = other.addHero({ class: "warlock", subclass: "The Hexblade", level: 3 });
  await otherKit.fight(1);
  otherKit.giveTurn(warlock.id);
  const theirs = { seq: lastSeq(other.campaignId), budget: other.encounter().turnBudget };

  const enemy = await stage(hexblade);
  const curse = await spend(hexblade, "Hexblade's Curse", { targetEnemyId: enemy.id });
  assert.equal(curse.ok, true, curse.error);
  assert.equal(updatesSince(other.campaignId, theirs.seq).length, 0);
  assert.deepEqual(other.encounter().turnBudget, theirs.budget);
});

await test("a feature's cost is the one its book gives, not the summary's", async () => {
  const artillerist = world.addHero({ class: "artificer", subclass: "Artillerist", level: 3, abilities: { int: 16 } });
  const beast = world.addHero({ class: "barbarian", subclass: "Path of the Beast", level: 14, abilities: { con: 16 } });
  const clockwork = world.addHero({ class: "sorcerer", subclass: "Clockwork Soul", level: 14, abilities: { cha: 16 } });
  // Eldritch Cannon: creating it is an action (Tasha's), not a bonus action.
  await stage(artillerist);
  const cannon = await spend(artillerist, "Eldritch Cannon");
  assert.equal(cannon.ok, true, cannon.error);
  assert.equal(cannon.result.cost, "their action");
  // Call the Hunt is used on entering the rage, with no action of its own:
  // Rage and Call the Hunt go together on one turn.
  await stage(beast);
  assert.equal((await spend(beast, "Rage")).ok, true);
  const hunt = await spend(beast, "Call the Hunt");
  assert.equal(hunt.ok, true, hunt.error);
  assert.equal(world.encounter().turnBudget.actionUsed, false);
  // Trance of Order is a bonus action (Tasha's); the summary named none.
  await stage(clockwork);
  const trance = await spend(clockwork, "Trance of Order");
  assert.equal(trance.ok, true, trance.error);
  assert.equal(trance.result.cost, "their bonus action");
});

await test("Hidden Paths costs a bonus action for the druid and an action for a creature they touch", async () => {
  const dreamer = world.addHero({ class: "druid", subclass: "Circle of Dreams", level: 10, abilities: { wis: 18 } });
  await stage(dreamer);
  const unnamed = await spend(dreamer, "Hidden Paths");
  assert.match(String(unnamed.error), /needs a variant/);
  assert.equal(used(dreamer, "sub_hidden_paths"), 0);
  const self = await spend(dreamer, "Hidden Paths", { variant: "self" });
  assert.equal(self.ok, true, self.error);
  assert.equal(self.result.cost, "their bonus action");
  assert.match(self.result.teleport, /moves up to 60 feet/);
  kit.giveTurn(dreamer.id);
  const touch = await spend(dreamer, "Hidden Paths", { variant: "touch" });
  assert.equal(touch.ok, true, touch.error);
  assert.equal(touch.result.cost, "their action");
  assert.match(touch.result.teleport, /A willing creature .* touches moves up to 30 feet/);
  assert.equal(world.encounter().turnBudget.bonusUsed, false);
  assert.equal(used(dreamer, "sub_hidden_paths"), 2);
});

await test("a reaction feature is refused to the surprised and the unconscious, as use_reaction refuses it", async () => {
  const enemy = await stage(hexblade);
  await edgeRoll(enemy);
  // Back to the first in the order, before the surprised sorcerer's turn.
  kit.giveTurn(hexblade.id);
  const live = world.encounter();
  encounters.saveEncounter({ ...live, round: 1, surprisedIds: [sorcerer.id] });
  const surprised = await spend(sorcerer, "Restore Balance");
  assert.match(String(surprised.error), /surprised/);
  assert.equal(used(sorcerer, "sub_restore_balance"), 0);

  // Down since an earlier hit: no reaction at all.
  encounters.saveEncounter({ ...world.encounter(), surprisedIds: [] });
  world.patch(sorcerer.id, { currentHp: 0, conditions: ["unconscious"] });
  await refusedUnchanged(world, sorcerer.id, () => spend(sorcerer, "Restore Balance"), "an unconscious sorcerer");
  world.patch(sorcerer.id, { currentHp: world.sheet(sorcerer.id).maxHp, conditions: [] });

  // Slowed: no reactions at all.
  world.patch(sorcerer.id, { conditions: ["slowed"] });
  const slowed = await spend(sorcerer, "Restore Balance");
  assert.match(String(slowed.error), /cannot take reactions/);
  world.patch(sorcerer.id, { conditions: [] });
});

await test("Adrenaline Surge and the grifter's Vanish take the bonus action and spend a use", async () => {
  const survivor = world.addHero({ class: "survivor", level: 1, abilities: { con: 14 } });
  const grifter = world.addHero({ class: "grifter", level: 18, abilities: { dex: 16 } });
  await stage(survivor);
  const before = world.sheet(survivor.id).resources.horror_adrenaline_surge;
  assert.ok(before, "the survivor holds the Adrenaline Surge counter");
  const dash = await world.invoke("take_action", { characterId: survivor.id, action: "dash", bonus: true });
  assert.equal(dash.ok, true, dash.error);
  assert.match(dash.result.cost, /Adrenaline Surge: their bonus action/);
  assert.equal(dash.result.uses, "1 use (Adrenaline Surge)");
  assert.equal(world.sheet(survivor.id).resources.horror_adrenaline_surge.used, before.used + 1);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  assert.equal(world.encounter().turnBudget.actionUsed, false);
  // With no use left the route is refused and nothing is spent.
  kit.giveTurn(survivor.id);
  world.patch(survivor.id, {
    resources: { ...world.sheet(survivor.id).resources, horror_adrenaline_surge: { max: before.max, used: before.max } },
  });
  await refusedUnchanged(
    world,
    survivor.id,
    () => world.invoke("take_action", { characterId: survivor.id, action: "disengage", bonus: true }),
    "Adrenaline Surge with no use left",
  );
  // Out of uses, a plain Dash once the action is gone does not reach for it.
  assert.equal((await world.invoke("take_action", { characterId: survivor.id, action: "dash" })).ok, true);
  assert.equal((await world.invoke("take_action", { characterId: survivor.id, action: "dash" })).ok, false);

  // Hiding needs somewhere to hide; a fight with no board asks nothing of it.
  await kit.endFight();
  await beginBoardlessFight(world, [{ monster: "goblin", count: 1 }]);
  kit.giveTurn(grifter.id);
  const vanishBefore = world.sheet(grifter.id).resources.mystery_vanish;
  assert.ok(vanishBefore, "the grifter holds the Vanish counter");
  const hide = await world.invoke("take_action", { characterId: grifter.id, action: "hide", bonus: true });
  assert.equal(hide.ok, true, hide.error);
  assert.equal(world.sheet(grifter.id).resources.mystery_vanish.used, vanishBefore.used + 1);
});

await finish();
