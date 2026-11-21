// Every attack and damage roll the engine stores records who made it, and
// its detail says what was used and against whom, at every site that rolls
// one: a character's weapon or spell (digital and with real dice), their
// features and reactions, a companion beast, an enemy, a fall, an area, and
// the spells cast at a creature, which store the damage card of the dice they
// roll. characterId keeps its meaning (the PC the roll concerns: the target
// of an enemy's blow) and every such roll stays public. The text the readers
// build from these is pinned in test-roll-labels.mjs.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit, ROWS } from "./lib/enforce-monsters.mjs";
import { caster, closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-roll-attacker");
const world = await openWorld({ campaign: { maxPlayers: 20 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { resolveOpportunityAttacks, resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const hero = (overrides) => world.addHero({ maxHp: 300, proficiencies: TRAINED, ...overrides });
const aria = hero({ name: "Aria", class: "fighter", level: 5, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
const rogue = hero({ name: "Rook", class: "rogue", level: 5, abilities: { dex: 16 } });
const guard = hero({ name: "Garr", class: "fighter", level: 3, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }, { name: "Shield", qty: 1 }] });
const monk = hero({ name: "Mae", class: "monk", level: 5, abilities: { dex: 16, wis: 14 } });
const warlock = hero({ name: "Wren", class: "warlock", subclass: "The Fiend", level: 14, abilities: { str: 14, cha: 16 }, equipment: [{ name: "Mace", qty: 1 }] });
const hunter = hero({ name: "Hale", class: "ranger", subclass: "Hunter", level: 15, abilities: { dex: 16 }, equipment: [{ name: "Shortsword", qty: 1 }] });
const ranger = hero({ name: "Rhea", class: "ranger", subclass: "Beast Master", level: 3, abilities: { dex: 16, wis: 14 }, equipment: [{ name: "Longbow", qty: 1 }] });
const stalker = hero({ name: "Sable", class: "ranger", subclass: "Gloom Stalker", level: 15, abilities: { dex: 16, wis: 14 } });
const watcher = hero({ name: "Vale", class: "paladin", subclass: "Oath of the Watchers", level: 7, abilities: { str: 16, cha: 16 } });
const heroes = [aria, rogue, guard, monk, warlock, hunter, ranger, stalker, watcher];
// A pick or a style is recorded after the sheet is made, as the builder does.
for (const [who, names] of [
  [guard, ["Fighting Style: Protection"]],
  [warlock, ["Hurl Through Hell"]],
  [hunter, ["Superior Hunter's Defense: Stand Against the Tide"]],
  [stalker, ["Shadowy Dodge"]],
  [watcher, ["Vigilant Rebuke"]],
]) {
  world.patch(who.id, { features: [...world.sheet(who.id).features, ...names.map((name) => ({ name, description: "" }))] });
}
const base = new Map(heroes.map((entry) => [entry.id, world.sheet(entry.id)]));

const asSheet = (who) => ({ kind: "sheet", id: who.id, name: world.sheet(who.id).name });
const asEnemy = (enemy) => ({ kind: "enemy", id: enemy.id, name: enemy.displayName });
const snapshot = () => new Set(listRecentRolls(world.campaignId, 200).map((roll) => roll.id));
// The combat rolls stored since a snapshot, oldest first.
const combatSince = (before, campaignId = world.campaignId) =>
  listRecentRolls(campaignId, 200).filter((roll) => !before.has(roll.id) && (roll.kind === "attack" || roll.kind === "damage"));
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });

// The roll as the table and the readers see it: who, what against whom, the
// PC it concerns, and that everybody sees it.
function expectRoll(roll, { kind, attacker, detail, characterId }) {
  assert.ok(roll, `no ${kind} roll "${detail}" was stored`);
  assert.equal(roll.kind, kind);
  assert.deepEqual(roll.attacker, attacker);
  assert.equal(roll.detail, detail);
  assert.equal(roll.characterId, characterId);
  assert.equal(roll.visibility, "public");
}

// `first` at the pointer beside one dummy, everyone else's slate wiped.
async function stage(first, { enemies = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { equipment: made.equipment, resources: made.resources, ac: 12, acOverride: true, currentHp: 300 });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === first.id ? 19 : 2]));
  await kit.fight(enemies, { heroFaces });
  const list = world.enemies();
  for (const enemy of list) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.giveTurn(first.id);
  kit.place(first.id, 5, 5);
  kit.place(list[0].id, 5, 6);
  return world.enemies();
}

async function enemyHits(enemy, target, faces) {
  kit.freshRound();
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out;
}

// ---- a character's own blows ----

await test("pc_attack: the attack and its damage are the character's, against the creature they targeted.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  const swing = await kit.swing(aria.id, enemy.id, [15, 4]);
  assert.equal(swing.ok, true, swing.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: `Longsword vs ${enemy.displayName}`, characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A spell attack's half damage on a miss (Acid Arrow) is the caster's, against the target.", async () => {
  const { world: spells, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Acid Arrow"], [], 5)]);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(2, 2, 2, 2, 2);
  const out = await spells.invoke("pc_attack", { characterId: wizard.id, targetEnemyId: goblin.id, enemyId: goblin.id, spell: "Acid Arrow" });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const damage = combatSince(before, spells.campaignId).find((roll) => roll.kind === "damage");
  expectRoll(damage, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: `Acid Arrow (half on a miss) vs ${goblin.displayName}`, characterId: wizard.id });
});

await test("With real dice, the parked roll still says what it is for, and the rolls the player submits carry the attacker and the new detail, marked physical.", async () => {
  const [enemy] = await stage(aria);
  setMemberRealDice(world.campaignId, aria.userId, true);
  const before = snapshot();
  const parked = await world.invoke("pc_attack", { characterId: aria.id, targetEnemyId: enemy.id, enemyId: enemy.id });
  assert.equal(parked.ok, true, parked.error);
  const answer = async (kind, faces) => {
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === kind);
    assert.ok(pending, `no ${kind} roll was parked`);
    world.signIn({ id: aria.userId });
    const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return pending;
  };
  const toHit = await answer("attack", [18]);
  assert.equal(toHit.reason, `Longsword attack against ${enemy.displayName}`);
  const damage = await answer("damage", [5]);
  assert.equal(damage.reason, `Longsword damage against ${enemy.displayName}`);
  setMemberRealDice(world.campaignId, aria.userId, false);
  const [hitRoll, damageRoll] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: `Longsword vs ${enemy.displayName} (physical)`, characterId: aria.id };
  expectRoll(hitRoll, { kind: "attack", ...expected });
  expectRoll(damageRoll, { kind: "damage", ...expected });
});

await test("A character's opportunity attack is theirs, against the creature that broke away.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  world.clearDice();
  world.dice(15, 4);
  resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: `Longsword (opportunity attack) vs ${enemy.displayName}`, characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A blow at an object is the character's, against the object.", async () => {
  await kit.endFight();
  const before = snapshot();
  world.dice(15, 6);
  const out = await world.invoke("damage_object", { name: "the oak door", material: "wood", size: "medium", characterId: aria.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(aria), detail: "Longsword vs the oak door", characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A coated weapon's poison is the character's, against the creature hit.", async () => {
  const [enemy] = await stage(aria);
  world.patch(aria.id, { equipment: [{ name: "Longsword", qty: 1 }, { name: "Poison, basic (vial)", qty: 1 }] });
  const coat = await world.invoke("use_item", { characterId: aria.id, item: "Poison, basic (vial)" });
  assert.equal(coat.ok, true, coat.error);
  kit.freshTurn();
  const before = snapshot();
  // Hit, the longsword's d8, the dummy's CON save on a 1, the poison's d4.
  const swing = await kit.swing(aria.id, enemy.id, [15, 4, 1, 3]);
  assert.equal(swing.ok, true, swing.error);
  const poison = combatSince(before).find((roll) => roll.kind === "damage" && roll.detail.startsWith("Basic poison"));
  expectRoll(poison, { kind: "damage", attacker: asSheet(aria), detail: `Basic poison vs ${enemy.displayName}`, characterId: aria.id });
});

await test("Hurl Through Hell's return damage is the warlock's, against the creature that comes back.", async () => {
  const [enemy] = await stage(warlock);
  world.patch(warlock.id, { resources: { ...world.sheet(warlock.id).resources, hurl_through_hell: { max: 1, used: 0 } } });
  const hit = await kit.swing(warlock.id, enemy.id, [15, 3], { weapon: "Mace", hurlThroughHell: true });
  assert.equal(hit.ok, true, hit.error);
  assert.ok(kit.endTurn(world.sheet(warlock.id).userId));
  for (let step = 0; step < 20 && kit.current().characterId !== warlock.id; step += 1) {
    assert.ok(kit.endTurn(world.sheet(kit.current().characterId).userId));
  }
  const before = snapshot();
  world.clearDice();
  world.dice(new Array(10).fill(5));
  assert.ok(kit.endTurn(world.sheet(warlock.id).userId));
  world.clearDice();
  const [back] = combatSince(before);
  expectRoll(back, { kind: "damage", attacker: asSheet(warlock), detail: `Hurl Through Hell vs ${enemy.displayName}`, characterId: warlock.id });
});

// ---- reactions ----

await test("Deflect Missiles' throw back is the monk's, against the archer.", async () => {
  const [enemy] = await stage(aria);
  world.patch(monk.id, { resources: { ...world.sheet(monk.id).resources, ki: { max: 5, used: 0 } } });
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(monk.id, 5, 5);
  kit.place(aria.id, 9, 9);
  kit.place(enemy.id, 5, 8);
  await enemyHits(enemy, monk, [15, 6]);
  const before = snapshot();
  world.dice(10, 15, 4);
  const out = await react(monk, "Deflect Missiles", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asSheet(monk), detail: `Caught missile vs ${enemy.displayName}`, characterId: monk.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("Protection's second roll of the attack is the enemy's, against the protected ally.", async () => {
  const [enemy] = await stage(aria);
  kit.place(aria.id, 9, 9);
  kit.place(rogue.id, 5, 5);
  kit.place(guard.id, 5, 4);
  await enemyHits(enemy, rogue, [10, 3]);
  const before = snapshot();
  world.dice(2);
  const out = await react(guard, "Protection", { targetCharacterId: rogue.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [again] = combatSince(before);
  expectRoll(again, { kind: "attack", attacker: asEnemy(enemy), detail: "Club again, at disadvantage (Protection) vs Rook", characterId: null });
});

await test("An authored reaction's second roll of the attack (Shadowy Dodge) is the enemy's, against the one it hit.", async () => {
  const [enemy] = await stage(aria);
  kit.place(aria.id, 9, 9);
  kit.place(stalker.id, 5, 5);
  await enemyHits(enemy, stalker, [10, 3]);
  const before = snapshot();
  world.dice(2);
  const out = await react(stalker, "Shadowy Dodge");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [again] = combatSince(before);
  expectRoll(again, { kind: "attack", attacker: asEnemy(enemy), detail: "Club again, at disadvantage (Shadowy Dodge) vs Sable", characterId: null });
});

await test("An authored reaction that strikes back (Vigilant Rebuke) is the holder's, against the creature it strikes.", async () => {
  const [enemy] = await stage(aria);
  kit.place(watcher.id, 5, 4);
  // What it answers, on record: a Wisdom save the creature forced and the
  // paladin made (a reaction answers its trigger, src/lib/dm/last-save.ts).
  world.dice(19);
  const forced = await world.invoke("cast_at_player", { characterId: watcher.id, casterEnemyId: enemy.id, saveAbility: "wis", dc: 5, condition: "frightened" });
  world.clearDice();
  assert.equal(forced.ok, true, forced.error);
  const before = snapshot();
  world.dice(4, 4);
  const out = await react(watcher, "Vigilant Rebuke", { targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [rebuke] = combatSince(before);
  expectRoll(rebuke, { kind: "damage", attacker: asSheet(watcher), detail: `Vigilant Rebuke vs ${enemy.displayName}`, characterId: watcher.id });
});

await test("Stand Against the Tide's repeated attack is the enemy's, against the creature the Hunter turned it on.", async () => {
  const [attacker, other] = await stage(hunter, { enemies: 2 });
  kit.place(hunter.id, 5, 5);
  kit.place(other.id, 4, 5);
  kit.setEnemy(other.id, { ac: 5 });
  world.patch(hunter.id, { ac: 30, acOverride: true });
  await enemyHits(attacker, hunter, [2]);
  const before = snapshot();
  world.dice(18, 5);
  const out = await react(hunter, "Stand Against the Tide", { targetEnemyId: other.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [toHit, damage] = combatSince(before);
  expectRoll(toHit, { kind: "attack", attacker: asEnemy(attacker), detail: `Club again (Stand Against the Tide) vs ${other.displayName}`, characterId: null });
  expectRoll(damage, { kind: "damage", attacker: asEnemy(attacker), detail: `Club (Stand Against the Tide) vs ${other.displayName}`, characterId: null });
});

// ---- a companion beast ----

await test("A companion beast's attack is the beast's (its owner's sheet holds it), against its target.", async () => {
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  base.set(ranger.id, world.sheet(ranger.id));
  const [enemy] = await stage(ranger);
  const wolf = world.sheet(ranger.id).pets[0];
  const before = snapshot();
  world.dice(15, 3, 3);
  const bite = await world.invoke("pet_attack", { characterId: ranger.id, petName: wolf.name, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: { kind: "pet", id: ranger.id, name: wolf.name }, detail: `${wolf.attacks[0].name} vs ${enemy.displayName}`, characterId: ranger.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

// ---- an enemy's blows ----

await test("enemy_attack: the attack and its damage are the enemy's, against the character, whom characterId still names.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  await enemyHits(enemy, aria, [15, 3]);
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asEnemy(enemy), detail: "Club vs Aria", characterId: aria.id };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A hit's rider damage (a giant spider's poison) is the enemy's, against the character.", async () => {
  const [spider] = await stage(aria);
  mk.stage(spider.id, ROWS.giantSpider);
  kit.freshRound();
  const before = snapshot();
  const out = await mk.forced([15, 8, 20, 6, 6], () => world.invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: aria.id }));
  assert.equal(out.ok, true, out.error);
  const rider = combatSince(before).find((roll) => roll.kind === "damage" && roll.detail.includes("(poison)"));
  expectRoll(rider, { kind: "damage", attacker: asEnemy(kit.enemy(spider.id)), detail: "Bite (poison) vs Aria", characterId: aria.id });
});

await test("An enemy's opportunity attack is the enemy's, against the character who pulled away.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  world.clearDice();
  world.dice(18, 6);
  resolveOpportunityAttacks(world.campaign(), aria.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
  world.clearDice();
  const [toHit, damage] = combatSince(before);
  const expected = { attacker: asEnemy(enemy), detail: "Club (opportunity attack) vs Aria", characterId: null };
  expectRoll(toHit, { kind: "attack", ...expected });
  expectRoll(damage, { kind: "damage", ...expected });
});

await test("A falling enemy's damage is the fall's roll and names the creature it lands on.", async () => {
  const [enemy] = await stage(aria);
  const before = snapshot();
  const out = await mk.forced([3, 3, 3], () => world.invoke("damage_enemy", { enemyId: enemy.id, source: "hazard", fallFeet: 30 }));
  assert.equal(out.ok, true, out.error);
  const [fall] = combatSince(before);
  expectRoll(fall, { kind: "damage", attacker: { kind: "hazard", id: null, name: "the fall", hazard: "fall" }, detail: `30 ft, 3d6 bludgeoning on ${enemy.displayName}`, characterId: null });
});

await test("The post-fight summary does not give a character the enemy's natural 20 against them.", async () => {
  const [enemy] = await stage(aria);
  await enemyHits(enemy, aria, [20, 3, 3]);
  const encounterId = world.encounter().id;
  await kit.endFight();
  const row = getDatabase().prepare("SELECT summary_json FROM encounters WHERE id = ?").get(encounterId);
  const fighter = JSON.parse(row.summary_json).fighters.find((line) => line.characterId === aria.id);
  assert.equal(fighter.nat20s, 0);
});

// ---- spells cast at a creature, and areas ----

const onTurn = (campaignId, rollId) =>
  getDatabase().prepare("SELECT COUNT(*) AS n FROM dm_turns WHERE campaign_id = ? AND roll_ids_json LIKE ?").get(campaignId, `%${rollId}%`).n > 0;

await test("cast_at_enemy stores a public damage card of its dice: the caster's, against the target, on the turn, not applied.", async () => {
  const { world: spells, sheets: [cleric], enemies: [goblin] } = await table([caster("cleric", "wis", [], ["Sacred Flame"], 5)]);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(1, 6);
  const out = await spells.invoke("cast_at_enemy", { characterId: cleric.id, targetEnemyId: goblin.id, spell: "Sacred Flame", saveAbility: "dex" });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [card] = combatSince(before, spells.campaignId);
  expectRoll(card, { kind: "damage", attacker: { kind: "sheet", id: cleric.id, name: cleric.name }, detail: `Sacred Flame vs ${goblin.displayName}`, characterId: cleric.id });
  assert.equal(card.applied, false);
  assert.ok(onTurn(spells.campaignId, card.id), "the card is not on the turn's rolls");
});

await test("cast_at_player stores a public damage card: the casting enemy's, or its named source's, against the character.", async () => {
  const { world: spells, sheets: [fighter], enemies: [shaman] } = await table([{ ...FIGHTER, name: "Aria" }], 1, { spells: ["Sacred Flame"] });
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(1, 6);
  const cast = await spells.invoke("cast_at_player", { characterId: fighter.id, casterEnemyId: shaman.id, spell: "Sacred Flame", saveAbility: "dex", dc: 13, damage: "1d8", damageType: "radiant" });
  spells.clearDice();
  assert.equal(cast.ok, true, cast.error);
  spells.dice(1, 3);
  const trap = await spells.invoke("cast_at_player", { characterId: fighter.id, source: "Poison dart trap", saveAbility: "dex", dc: 12, damage: "1d4", damageType: "poison" });
  spells.clearDice();
  assert.equal(trap.ok, true, trap.error);
  const [spell, dart] = combatSince(before, spells.campaignId);
  expectRoll(spell, { kind: "damage", attacker: asEnemy(shaman), detail: "Sacred Flame vs Aria", characterId: fighter.id });
  expectRoll(dart, { kind: "damage", attacker: { kind: "hazard", id: null, name: "Poison dart trap", hazard: "named" }, detail: "1d4 poison on Aria", characterId: fighter.id });
  assert.ok(onTurn(spells.campaignId, spell.id), "the card is not on the turn's rolls");
});

// ---- rolls nobody at the table made (issue 915, ruling 2) ----
// Each names its source as its attacker: a "hazard" with no id, a field that
// says what it is, and the name it was given (src/lib/roll-sources.ts). The
// character or creature it lands on is its target: characterId for a
// character, and the detail says who. Named in front of the card, a source is
// not named again in the detail.

const source = (hazard, name) => ({ kind: "hazard", id: null, name, hazard });
const idsOf = (campaignId) => new Set(listRecentRolls(campaignId, 200).map((roll) => roll.id));

await test("A trap's attacks and the damage of each are the trap's own rolls, against the character it springs on.", async () => {
  const { world: traps, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(traps.campaignId);
  // The first dart's d20: a hit whatever the armour.
  traps.dice(20);
  const out = await traps.invoke("apply_hazard", { type: "trap", trap: "Poison Darts", characterIds: [fighter.id] });
  traps.clearDice();
  assert.equal(out.ok, true, out.error);
  const rolls = combatSince(before, traps.campaignId);
  assert.ok(rolls.some((roll) => roll.kind === "attack") && rolls.some((roll) => roll.kind === "damage"), JSON.stringify(rolls.map((roll) => roll.detail)));
  for (const roll of rolls) {
    assert.deepEqual(roll.attacker, source("trap", "Poison Darts"), roll.detail);
    assert.equal(roll.characterId, fighter.id, roll.detail);
    assert.equal(roll.visibility, "public");
    assert.ok(!roll.detail.includes("Poison Darts"), `the trap is named twice: ${roll.detail}`);
    assert.match(roll.detail, roll.kind === "attack" ? /^Attack vs Aria, AC \d+$/ : / on Aria$/);
  }
});

await test("A pit's fall is the fall's roll and its spikes are the pit's, against the character who fell in.", async () => {
  const { world: traps, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(traps.campaignId);
  const out = await traps.invoke("apply_hazard", { type: "trap", trap: "Spiked Pit", characterIds: [fighter.id] });
  assert.equal(out.ok, true, out.error);
  const [fall, spikes, ...more] = combatSince(before, traps.campaignId);
  assert.deepEqual(more, []);
  expectRoll(fall, { kind: "damage", attacker: source("fall", "the fall"), detail: "10 ft into Spiked Pit, 1d6 bludgeoning on Aria", characterId: fighter.id });
  expectRoll(spikes, { kind: "damage", attacker: source("trap", "Spiked Pit"), detail: "2d10 piercing on Aria", characterId: fighter.id });
});

await test("A trap sprung on a creature is the trap's own roll too, against the creature.", async () => {
  const { world: traps, enemies: [goblin] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(traps.campaignId);
  traps.dice(20);
  const out = await traps.invoke("apply_hazard", { type: "trap", trap: "Poison Darts", enemyIds: [goblin.id] });
  traps.clearDice();
  assert.equal(out.ok, true, out.error);
  const rolls = combatSince(before, traps.campaignId);
  assert.ok(rolls.some((roll) => roll.kind === "attack") && rolls.some((roll) => roll.kind === "damage"), JSON.stringify(rolls.map((roll) => roll.detail)));
  for (const roll of rolls) {
    assert.deepEqual(roll.attacker, source("trap", "Poison Darts"), roll.detail);
    assert.equal(roll.characterId, null);
    assert.ok(!roll.detail.includes("Poison Darts"), `the trap is named twice: ${roll.detail}`);
    assert.ok(roll.detail.includes(goblin.displayName), `the creature is not named: ${roll.detail}`);
  }
});

await test("A spell the GM casts at a character with no creature behind it is the spell's own roll, or its named source's.", async () => {
  const { world: spells, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(spells.campaignId);
  const bare = await spells.invoke("cast_at_player", { characterId: fighter.id, spell: "Burning Hands", saveAbility: "dex", dc: 12, damage: "3d6", damageType: "fire", halfOnSave: true });
  assert.equal(bare.ok, true, bare.error);
  const named = await spells.invoke("cast_at_player", { characterId: fighter.id, spell: "Burning Hands", source: "a glyph on the door", saveAbility: "dex", dc: 12, damage: "3d6", damageType: "fire", halfOnSave: true });
  assert.equal(named.ok, true, named.error);
  const [first, second] = combatSince(before, spells.campaignId);
  expectRoll(first, { kind: "damage", attacker: source("effect", "Burning Hands"), detail: "3d6 fire on Aria", characterId: fighter.id });
  expectRoll(second, { kind: "damage", attacker: source("named", "a glyph on the door"), detail: "Burning Hands, 3d6 fire on Aria", characterId: fighter.id });
});

await test("A damage roll the GM asks the server to throw for a character is that character's own.", async () => {
  const { world: asks, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(asks.campaignId);
  const own = await asks.invoke("request_roll", { characterId: fighter.id, kind: "damage", expression: "1d8+3", reason: "a thrown chair" });
  assert.equal(own.ok, true, own.error);
  const [roll] = combatSince(before, asks.campaignId);
  assert.ok(roll, "no damage roll was stored");
  assert.deepEqual(roll.attacker, { kind: "sheet", id: fighter.id, name: "Aria" });
  assert.equal(roll.characterId, fighter.id);
});

await test("The helpers that put a source's roll on record word it from what it threw and on whom, and do not say the source again.", async () => {
  const { castDamage, castersDamage, sourceAttack, sourceDamage, sourceDamageThrown } = await import("../src/lib/dm/roll-card.ts");
  const { rollExpression } = await import("../src/lib/dice.ts");
  const { castSource, effectSource, fallSource, gmSource, itemSource, namedSource, trapSource } = await import("../src/lib/roll-sources.ts");
  const { world: words, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const campaign = words.campaign();
  const before = idsOf(words.campaignId);
  const aria = { characterId: fighter.id, names: ["Aria"] };
  sourceDamage(campaign, null, trapSource("Scything Blade"), aria, { dice: "2d10", type: "slashing" });
  sourceDamage(campaign, null, fallSource(), aria, { note: "30 ft", dice: "3d6", type: "bludgeoning" });
  sourceDamage(campaign, null, itemSource("Potion of Poison"), aria, { note: "turn 2", dice: "2d6", type: "poison" });
  sourceAttack(campaign, null, trapSource("Scything Blade"), { characterId: fighter.id, name: "Aria" }, 16, "1d20+8");
  // A character's later damage is theirs while their sheet is there, a creature's is that creature's, and the spell's own once neither is left.
  castersDamage(campaign, null, fighter, "Bestow Curse vs Goblin", "Bestow Curse", "Goblin", { dice: "1d8", type: "necrotic" });
  castersDamage(campaign, null, null, "Bestow Curse vs Goblin", "Bestow Curse", "Goblin", { dice: "1d8", type: "necrotic" });
  castersDamage(campaign, null, null, "Acid Arrow (second burn) vs Aria", "Acid Arrow", "Aria", { dice: "2d4", type: "acid" }, { id: "enemy-mage", displayName: "Mage" });
  // Dice a site threw itself are worded the same way.
  sourceDamageThrown(campaign, null, gmSource(), { names: ["Goblin 1", "Goblin 2"] }, { dice: "2d6", type: "fire" }, rollExpression("2d6"));
  // A cast with no creature behind it: the named source says its spell, the spell alone says what it throws, and so do the GM's own dice.
  const on = { characterId: fighter.id, name: "Aria" };
  castDamage(campaign, null, castSource("a glyph on the door", "Burning Hands"), "Burning Hands", on, { dice: "3d6", type: "fire" });
  castDamage(campaign, null, castSource(undefined, "Burning Hands"), "Burning Hands", on, { dice: "3d6", type: "fire" });
  castDamage(campaign, null, castSource("a gout of flame", undefined), undefined, on, { dice: "2d6", type: "fire" });
  castDamage(campaign, null, castSource("  ", ""), undefined, on, { dice: "2d6", type: "fire" });
  // A trap that casts a spell says the spell too.
  castDamage(campaign, null, castSource("a rune trap", "Fireball", true), "Fireball", on, { dice: "8d6", type: "fire" });
  const told = combatSince(before, words.campaignId).map((roll) => [roll.attacker.kind === "hazard" ? `${roll.attacker.hazard}:${roll.attacker.name}` : roll.attacker.name, roll.kind, roll.detail, roll.characterId]);
  assert.deepEqual(told, [
    ["trap:Scything Blade", "damage", "2d10 slashing on Aria", fighter.id],
    ["fall:the fall", "damage", "30 ft, 3d6 bludgeoning on Aria", fighter.id],
    ["item:Potion of Poison", "damage", "turn 2, 2d6 poison on Aria", fighter.id],
    ["trap:Scything Blade", "attack", "Attack vs Aria, AC 16", fighter.id],
    ["Aria", "damage", "Bestow Curse vs Goblin", fighter.id],
    ["effect:Bestow Curse", "damage", "1d8 necrotic on Goblin", null],
    ["Mage", "damage", "Acid Arrow (second burn) vs Aria", null],
    ["gm:the GM", "damage", "2d6 fire on Goblin 1, Goblin 2", null],
    ["named:a glyph on the door", "damage", "Burning Hands, 3d6 fire on Aria", fighter.id],
    ["effect:Burning Hands", "damage", "3d6 fire on Aria", fighter.id],
    ["named:a gout of flame", "damage", "2d6 fire on Aria", fighter.id],
    ["gm:the GM", "damage", "2d6 fire on Aria", fighter.id],
    ["trap:a rune trap", "damage", "Fireball, 8d6 fire on Aria", fighter.id],
  ]);
  // A name is kept as it was given, and a source with no name is the GM's own dice.
  assert.deepEqual(namedSource("  a gout of flame "), { kind: "hazard", id: null, name: "a gout of flame", hazard: "named" });
  assert.deepEqual(trapSource(""), gmSource());
  assert.deepEqual(effectSource("  "), gmSource());
});

await test("A spell that hits with no roll and no creature behind it is the spell's own roll, and the hit's record names the same source.", async () => {
  const { openHits } = await import("../src/lib/dm/last-hit.ts");
  const { world: spells, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(spells.campaignId);
  const out = await spells.invoke("cast_at_player", { characterId: fighter.id, spell: "Magic Missile", damage: "3d4+3", damageType: "force" });
  assert.equal(out.ok, true, out.error);
  const [roll] = combatSince(before, spells.campaignId);
  expectRoll(roll, { kind: "damage", attacker: source("effect", "Magic Missile"), detail: "3d4+3 force on Aria", characterId: fighter.id });
  const record = openHits(spells.campaignId, fighter.id).at(-1);
  assert.ok(record, "the missiles left no record of the hit");
  assert.deepEqual(record.attacker, roll.attacker);
});

await test("An improvised action's damage is the character's roll, and its card does not say their name twice.", async () => {
  const { world: acts, sheets: [fighter], enemies: [goblin] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(acts.campaignId);
  acts.say("dm", "A chandelier hangs low over the hall on a single rope.");
  // The creature's d20, then the character's: the action carries.
  acts.dice(1, 20);
  const out = await acts.invoke("take_action", { characterId: fighter.id, action: "improvise", reason: "drops the chandelier", skill: "athletics", difficulty: "easy", scene: "the chandelier", targetEnemyId: goblin.id, damage: "1d10", damageType: "bludgeoning" });
  acts.clearDice();
  assert.equal(out.ok, true, out.error);
  const roll = combatSince(before, acts.campaignId).find((entry) => entry.kind === "damage");
  assert.ok(roll, `the improvised action rolled no damage: ${JSON.stringify(out).slice(0, 300)}`);
  expectRoll(roll, { kind: "damage", attacker: { kind: "sheet", id: fighter.id, name: "Aria" }, detail: "drops the chandelier", characterId: fighter.id });
});

await test("One hazard names one source for everyone it catches: the words the GM gave it, a trap by them when it is one, else the GM's own dice.", async () => {
  const { world: pipes, sheets: [fighter], enemies: [goblin] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const rollsOf = async (args) => {
    const before = idsOf(pipes.campaignId);
    // Each save's d20: a failure, so the damage is rolled.
    pipes.dice(1, 1);
    const out = await pipes.invoke("apply_hazard", { characterIds: [fighter.id], enemyIds: [goblin.id], saveAbility: "dex", dc: 25, damage: "2d6", damageType: "fire", ...args });
    pipes.clearDice();
    assert.equal(out.ok, true, out.error);
    return combatSince(before, pipes.campaignId);
  };
  const named = await rollsOf({ type: "generic", reason: "a burst pipe" });
  assert.equal(named.length, 2, JSON.stringify(named.map((roll) => roll.detail)));
  for (const roll of named) {
    assert.deepEqual(roll.attacker, source("named", "a burst pipe"), roll.detail);
    assert.ok(!roll.detail.includes("burst pipe"), `the source is said twice: ${roll.detail}`);
  }
  assert.equal(named.find((roll) => roll.characterId)?.detail, "2d6 fire on Aria");
  assert.ok(named.find((roll) => !roll.characterId)?.detail.endsWith(` on ${goblin.displayName}`));
  // Left unnamed, it is the GM's own dice: the words the server has for it sit in a sentence, never in front of a roll.
  const { rollCardLabel } = await import("../src/lib/roll-labels.ts");
  const plain = (key) => key;
  for (const [args, words] of [[{ type: "generic" }, "the hazard"], [{ type: "trap" }, "a trap"]]) {
    const unnamed = await rollsOf(args);
    assert.ok(unnamed.length >= 2, JSON.stringify(unnamed.map((roll) => roll.detail)));
    for (const roll of unnamed) {
      assert.deepEqual(roll.attacker, source("gm", words), roll.detail);
      assert.ok(rollCardLabel(plain, roll, "Aria").startsWith("The GM · "), rollCardLabel(plain, roll, "Aria"));
    }
  }
  // A trap the GM describes is a trap by their words, for the character and the creature alike.
  const trap = await rollsOf({ type: "trap", reason: "a scything blade" });
  assert.ok(trap.length >= 2, JSON.stringify(trap.map((roll) => roll.detail)));
  for (const roll of trap) {
    assert.deepEqual(roll.attacker, source("trap", "a scything blade"), roll.detail);
  }
});

await test("A trap cast_at_player is told of is the trap's roll.", async () => {
  const { world: spells, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(spells.campaignId);
  spells.dice(1);
  const told = await spells.invoke("cast_at_player", { characterId: fighter.id, source: "a dart trap", hazard: "trap", saveAbility: "dex", dc: 25, damage: "1d4", damageType: "poison" });
  spells.clearDice();
  assert.equal(told.ok, true, told.error);
  const [roll] = combatSince(before, spells.campaignId);
  expectRoll(roll, { kind: "damage", attacker: source("trap", "a dart trap"), detail: "1d4 poison on Aria", characterId: fighter.id });
});

await test("Dice the GM sends for harm name the words they gave it, and the hit's record names the same source.", async () => {
  const { openHits } = await import("../src/lib/dm/last-hit.ts");
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
  const { world: harm, sheets: [fighter] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const turn = createDmTurn(harm.campaignId, []);
  const before = idsOf(harm.campaignId);
  const out = await invokeEngine(harm.campaign(), { kind: "ai", turnId: turn.id }, { name: "apply_damage", args: { characterId: fighter.id, dice: "2d6", type: "bludgeoning", reason: "falling rubble" } });
  assert.equal(out.ok, true, out.error);
  const [roll] = combatSince(before, harm.campaignId);
  expectRoll(roll, { kind: "damage", attacker: source("named", "falling rubble"), detail: "2d6 bludgeoning on Aria", characterId: fighter.id });
  const record = openHits(harm.campaignId, fighter.id).at(-1);
  assert.ok(record, "the harm left no record of the hit");
  assert.deepEqual(record.attacker, roll.attacker);
});

await test("An area of harm with no creature behind it names the words the GM gave it, or is the GM's own dice, and names the creatures it catches.", async () => {
  const { world: areas, enemies: [goblin] } = await table([{ ...FIGHTER, name: "Aria" }]);
  const before = idsOf(areas.campaignId);
  const out = await areas.invoke("aoe_damage", { enemyIds: [goblin.id], damage: "2d6", type: "fire", saveAbility: "dex", dc: 12, halfOnSave: true, reason: "a vat of oil catches" });
  assert.equal(out.ok, true, out.error);
  const [roll] = combatSince(before, areas.campaignId);
  expectRoll(roll, { kind: "damage", attacker: source("named", "a vat of oil catches"), detail: `2d6 fire on ${goblin.displayName}`, characterId: null });
  const again = idsOf(areas.campaignId);
  const bare = await areas.invoke("aoe_damage", { enemyIds: [goblin.id], damage: "2d6", type: "fire", saveAbility: "dex", dc: 12, halfOnSave: true });
  assert.equal(bare.ok, true, bare.error);
  const [own] = combatSince(again, areas.campaignId);
  expectRoll(own, { kind: "damage", attacker: source("gm", "the GM"), detail: `2d6 fire on ${goblin.displayName}`, characterId: null });
});

await test("A damage roll the GM asks of a player on their own dice lands as that character's roll.", async () => {
  await kit.endFight();
  setMemberRealDice(world.campaignId, aria.userId, true);
  const before = snapshot();
  const parked = await world.invoke("request_roll", { characterId: aria.id, kind: "damage", expression: "1d8+3", reason: "a thrown chair" });
  assert.equal(parked.ok, true, parked.error);
  const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === "damage");
  assert.ok(pending, "no damage roll was parked");
  world.signIn({ id: aria.userId });
  const out = await call(submitRoute, "POST", { dice: [5] }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  setMemberRealDice(world.campaignId, aria.userId, false);
  const [roll] = combatSince(before);
  assert.ok(roll, "the damage the player rolled is on no record");
  assert.deepEqual(roll.attacker, asSheet(aria));
  assert.equal(roll.characterId, aria.id);
  assert.match(roll.detail, /\(physical\)$/);
});

await test("Each damaging ray of Prismatic Spray stores a card: the caster's, against the creature it strikes.", async () => {
  const { world: spells, sheets: [wizard, fighter], enemies: [goblin] } = await table([caster("wizard", "int", ["Prismatic Spray"], [], 13), { ...FIGHTER, name: "Bren" }]);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  // Each creature: its DEX save, its ray (1: red), the ray's 10d6.
  spells.dice(1, 1, ...new Array(10).fill(2), 1, 1, ...new Array(10).fill(2));
  const out = await spells.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Prismatic Spray", enemyIds: [goblin.id], characterIds: [fighter.id], saveAbility: "dex", dc: 17, level: 7 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const wizardRoller = { kind: "sheet", id: wizard.id, name: wizard.name };
  const [onGoblin, onBren] = combatSince(before, spells.campaignId);
  expectRoll(onGoblin, { kind: "damage", attacker: wizardRoller, detail: `Prismatic Spray (red) vs ${goblin.displayName}`, characterId: wizard.id });
  expectRoll(onBren, { kind: "damage", attacker: wizardRoller, detail: "Prismatic Spray (red) vs Bren", characterId: fighter.id });
});

await test("A character's area spell is theirs and names the creatures it can harm, not the ally Sculpt Spells shapes it around.", async () => {
  const { world: spells, sheets: [wizard, fighter], enemies } = await table([caster("wizard", "int", ["Fireball"], [], 5), { ...FIGHTER, name: "Bren" }], 3);
  spells.patch(wizard.id, { features: [...spells.sheet(wizard.id).features, { name: "Sculpt Spells", source: "test" }] });
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1, 1, 1);
  const out = await spells.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fireball", enemyIds: enemies.map((enemy) => enemy.id), characterIds: [fighter.id], saveAbility: "dex", dc: 15, level: 3 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: `Fireball on ${enemies.map((enemy) => enemy.displayName).join(", ")}`, characterId: null });
});

await test("An enemy's area spell is the enemy's and names every character it catches.", async () => {
  const { world: spells, sheets, enemies: [mage] } = await table(
    [{ ...FIGHTER, name: "Aria" }, { ...FIGHTER, name: "Bren" }, { ...FIGHTER, name: "Cora" }], 1, { spells: ["Fireball"] },
  );
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1, 1, 1);
  const out = await spells.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Fireball", characterIds: sheets.map((sheet) => sheet.id), saveAbility: "dex", dc: 15, damage: "8d6", type: "fire" });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: asEnemy(mage), detail: "Fireball on Aria, Bren, Cora", characterId: null });
});

await test("An area roll leaves out an enemy whose token the players cannot see.", async () => {
  const { world: spells, sheets: [wizard], enemies: [seen, unseen] } = await table([caster("wizard", "int", ["Fireball"], [], 5)], 2);
  await layMap(spells, ["..........", "..........", ".........."], { [wizard.id]: { x: 0, y: 0 }, [seen.id]: { x: 6, y: 1 }, [unseen.id]: { x: 7, y: 1 } });
  getDatabase().prepare("UPDATE battle_tokens SET hidden = 1 WHERE ref_id = ?").run(unseen.id);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1, 1);
  const out = await spells.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fireball", enemyIds: [seen.id, unseen.id], saveAbility: "dex", dc: 15, level: 3 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: `Fireball on ${seen.displayName}`, characterId: null });
  // Left off the card, not out of the blast.
  const hidden = spells.enemies().find((enemy) => enemy.id === unseen.id);
  assert.ok(hidden.currentHp < hidden.maxHp, "the hidden goblin took no damage");
});

await test("An area that catches only hidden enemies names none of them, and they still take the damage.", async () => {
  const { world: spells, sheets: [wizard], enemies: [unseen] } = await table([caster("wizard", "int", ["Fireball"], [], 5)]);
  await layMap(spells, ["..........", "..........", ".........."], { [wizard.id]: { x: 0, y: 0 }, [unseen.id]: { x: 7, y: 1 } });
  getDatabase().prepare("UPDATE battle_tokens SET hidden = 1 WHERE ref_id = ?").run(unseen.id);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1);
  const out = await spells.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fireball", enemyIds: [unseen.id], saveAbility: "dex", dc: 15, level: 3 });
  spells.clearDice();
  assert.equal(out.ok, true, out.error);
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: { kind: "sheet", id: wizard.id, name: wizard.name }, detail: "Fireball", characterId: null });
  const hidden = spells.enemies().find((enemy) => enemy.id === unseen.id);
  assert.equal(hidden.currentHp, hidden.maxHp - 24);
});

await test("A dead character caught in an area rolls no save, takes nothing and is not named; the result says they were skipped.", async () => {
  const { world: spells, sheets: [aria, bren], enemies: [mage] } = await table(
    [{ ...FIGHTER, name: "Aria" }, { ...FIGHTER, name: "Bren" }], 1, { spells: ["Fireball"] },
  );
  spells.patch(bren.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const dead = spells.sheet(bren.id);
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  spells.dice(...new Array(8).fill(3), 1);
  const out = await spells.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Fireball", characterIds: [aria.id, bren.id], saveAbility: "dex", dc: 15, damage: "8d6", type: "fire" });
  assert.equal(spells.clearDice(), 0, "a die was queued for a save nobody rolled");
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result.skippedDead, ["Bren"]);
  assert.deepEqual(out.result.results.map((row) => row.target), ["Aria"]);
  const made = listRecentRolls(spells.campaignId, 200).filter((roll) => !before.has(roll.id));
  assert.equal(made.some((roll) => roll.characterId === bren.id), false, "the dead character rolled a save");
  const [blast] = combatSince(before, spells.campaignId);
  expectRoll(blast, { kind: "damage", attacker: asEnemy(mage), detail: "Fireball on Aria", characterId: null });
  assert.deepEqual(spells.sheet(bren.id), dead);
});

await test("An area that catches only the dead is refused, and the caster's action is not spent.", async () => {
  const { world: spells, sheets: [aria, bren], enemies: [mage] } = await table(
    [{ ...FIGHTER, name: "Aria" }, { ...FIGHTER, name: "Bren" }], 1, { spells: ["Fireball"] },
  );
  spells.patch(bren.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const before = new Set(listRecentRolls(spells.campaignId, 200).map((roll) => roll.id));
  const refused = await spells.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Fireball", characterIds: [bren.id], saveAbility: "dex", dc: 15, damage: "8d6", type: "fire" });
  assert.equal(refused.ok, false, "a Fireball on the dead alone went through");
  assert.equal(listRecentRolls(spells.campaignId, 200).filter((roll) => !before.has(roll.id)).length, 0);
  spells.dice(...new Array(8).fill(3), 1);
  const cast = await spells.invoke("aoe_damage", { casterEnemyId: mage.id, spell: "Fireball", characterIds: [aria.id], saveAbility: "dex", dc: 15, damage: "8d6", type: "fire" });
  spells.clearDice();
  assert.equal(cast.ok, true, `the refused cast spent the action: ${cast.error}`);
});

await kit.endFight();
closeTables();
world.close();
finish();
