// The final engine round of the second rules-enforcement repair: what the
// earlier workstreams left for want of a hook (FIXBRIEF.md, wave 3,
// "final-engine").
//
//   - Holy Nimbus (Oath of Devotion 20, SRD 5.1): "you have advantage on
//     saving throws against spells cast by fiends or undead."
//   - An enemy's repeat save (a save-ends condition at the end of its turn, a
//     running spell's save as its turn starts) is a roll like any other: it is
//     kept as a roll row only the DM sees.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-final-engine");
const world = await openWorld({ campaign: { maxPlayers: 40 } });
const kit = await combatKit(world);
const conditionTick = await import("../src/lib/dm/condition-tick.ts");

const hero = (overrides) =>
  world.addHero({ maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, ...overrides });
const fresh = (id, patch = {}) =>
  world.patch(id, { conditions: [], conditionMeta: {}, exhaustion: 0, tempHp: 0, ...patch });
// Several rolls can share a timestamp: the rolls a call made are the ones
// that were not there before it.
const newRolls = (before) => kit.lastRolls(60).filter((roll) => !before.has(roll.id));

// A fight with `first` holding the floor and one sturdy dummy beside them.
async function stage(first, { enemies = 1, hp: enemyHp = 300, stats = {} } = {}) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(world.sheets().map((entry) => [entry.id, entry.id === first.id ? 19 : 3]));
  await kit.fight(enemies, { heroFaces });
  const list = world.enemies();
  for (const enemy of list) {
    kit.setEnemy(enemy.id, { maxHp: enemyHp, stats });
  }
  kit.place(first.id, 5, 5);
  kit.place(list[0].id, 5, 6);
  kit.giveTurn(first.id);
  return world.enemies();
}

// ---- Holy Nimbus: advantage against the spells of fiends and undead ----

const devoted = hero({
  class: "paladin", subclass: "Oath of Devotion", level: 20, abilities: { str: 16, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1 }],
});

async function holdPersonAgainst(type) {
  const [caster] = await stage(devoted, { stats: { type, spells: ["Hold Person"] } });
  fresh(devoted.id, { conditions: ["holy nimbus"], conditionMeta: { "holy nimbus": { rounds: 10, source: devoted.id } } });
  world.clearDice();
  world.dice(20, 20);
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  const out = await world.invoke("cast_at_player", {
    characterId: devoted.id, spell: "Hold Person", saveAbility: "wis", dc: 15, condition: "paralyzed", casterEnemyId: caster.id,
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return newRolls(before).find((roll) => roll.kind === "saving_throw" && roll.characterId === devoted.id) ?? null;
}

await test("A paladin under Holy Nimbus has advantage on saving throws against spells cast by fiends or undead.", async () => {
  const fiend = await holdPersonAgainst("fiend (devil)");
  assert.equal(d20Faces(fiend).length, 2, "a fiend's spell: the paladin rolls two d20s");
  const undead = await holdPersonAgainst("undead");
  assert.equal(d20Faces(undead).length, 2, "an undead's spell: two d20s");
  const humanoid = await holdPersonAgainst("humanoid");
  assert.equal(d20Faces(humanoid).length, 1, "a humanoid's spell is saved against with one d20");
});

// ---- an enemy's repeat saves are on the record ----

await test("An enemy's repeat save against a save-ends condition at the end of its turn is kept as a roll row only the DM sees, naming the creature and the condition.", async () => {
  const [enemy] = await stage(devoted);
  kit.setEnemy(enemy.id, {
    conditions: ["restrained"],
    conditionMeta: { restrained: { saveEnds: { ability: "str", dc: 30 } } },
  });
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  conditionTick.endTurnSaves(world.campaign(), world.encounter(), [enemy.id]);
  const made = kit.lastRolls(60).filter((roll) => !before.has(roll.id));
  const row = made.find((roll) => roll.kind === "saving_throw" && roll.characterId === null);
  assert.ok(row, "no roll row for the enemy's repeat save");
  assert.equal(row.visibility, "dm");
  assert.equal(row.dc, 30);
  assert.match(row.detail, /restrained/);
  assert.ok(row.detail.includes(enemy.displayName), row.detail);
});

await test("An enemy's save against a running spell as its turn starts (Spirit Guardians) is kept as a DM-only roll row and counts as a save against magic.", async () => {
  const cleric = hero({
    class: "cleric", level: 5, abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 3: { max: 2, used: 0 } }, prepared: ["Spirit Guardians"], known: [], cantrips: [] },
  });
  const [enemy] = await stage(cleric, { stats: { traits: ["Magic Resistance. The creature has advantage on saving throws against spells and other magical effects."] } });
  fresh(cleric.id, { conditions: ["spirit guardians"], conditionMeta: { "spirit guardians": { spell: "Spirit Guardians", source: cleric.id, slotLevel: 3 } }, concentratingOn: "Spirit Guardians" });
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  conditionTick.startTurnConditions(world.campaign(), world.encounter(), [enemy.id]);
  const made = kit.lastRolls(60).filter((roll) => !before.has(roll.id));
  const row = made.find((roll) => roll.kind === "saving_throw" && roll.characterId === null);
  assert.ok(row, "no roll row for the enemy's save against Spirit Guardians");
  assert.equal(row.visibility, "dm");
  assert.match(row.detail, /Spirit Guardians/);
  assert.equal(d20Faces(row).length, 2, "Magic Resistance: the save against the spell is at advantage");
});

// ---- the prompt: what the model is told matches what the engine now does ----
//
// The "Requests: prompt" of tail-spells, authored and ui-play
// (/tmp/odm-enf2/fixes/*.md), read as built text and offered schemas. A later
// edit that drops a sentence the engine relies on fails here.

const { buildDmMessages, requestRollTool, describeSheet } = await import("../src/lib/dm/prompt.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");

function systemText() {
  const encounter = {
    round: 1, orderReady: true, order: [{ name: "Hero", current: true }], awaitingInitiative: [], turnBudget: null,
    enemies: [], map: null,
  };
  return buildDmMessages(
    { campaign: world.campaign(), members: listMembers(world.campaignId), sheets: world.sheets(), encounter, recentRolls: [], storySummary: "" },
    [],
  )[0].content;
}
const offered = (name) => dmTurnToolCatalogue(world.campaign(), true, false).find((entry) => entry.function.name === name)?.function;

await test("The prompt sends subclass features to use_resource by name, their choices as the variant, their reactions to use_reaction, and their bonus attack to a pc_attack part's feature by name; the rest the server applies.", () => {
  const text = systemText();
  assert.match(text, /spend one with use_resource by its own name \(Kensei's Shot/);
  assert.match(text, /A subclass choice \(Totem Spirit, Aspect of the Beast, Totemic Attunement, Transmuter's Stone, Elemental Gift, Armor Model\) is made once with use_resource and the option as the variant, outside a fight/);
  assert.match(text, /Subclass reactions go through use_reaction by name \(Spectral Defense/);
  assert.match(text, /a subclass's or feat's bonus-action weapon attack by its name \(Battle Magic, War Magic/);
  assert.match(text, /never add them by hand and never pass advantage for them/);
  const feature = offered("pc_attack").parameters.properties.attacks.items.properties.feature;
  assert.match(feature.description, /Any other feat or feature granting a bonus weapon attack by its name/, "pc_attack's feature takes no subclass attack");
  const reaction = JSON.stringify(offered("use_reaction"));
  for (const name of ["Spectral Defense", "Spirit Shield", "Divine Allegiance", "Storm's Fury", "Opportunist"]) {
    assert.ok(reaction.includes(name), `use_reaction never names ${name}`);
  }
});

await test("GAME STATE tags a subclass feature the engine holds with how it is held.", () => {
  const forge = hero({ class: "cleric", subclass: "Forge Domain", level: 6 });
  const kensei = hero({ class: "monk", subclass: "Way of the Kensei", level: 6 });
  const forgeLine = describeSheet(world.sheet(forge.id), "player", false);
  assert.match(forgeLine, /Soul of the Forge \([^)]*\) \[server\]/);
  const kenseiLine = describeSheet(world.sheet(kensei.id), "player", false);
  assert.match(kenseiLine, /Kensei's Shot \([^)]*\) \[use_resource\]/);
});

await test("The prompt says what a spell does beyond its damage is the server's, names the choice words for cast_at_enemy, sends the restorations to cast_buff and spell holds to take_action escape, and teaches Sculpt Spells, Overchannel and Signature Spells.", () => {
  const text = systemText();
  assert.match(text, /The server applies what a spell does beyond its damage: Thunderwave's and Gust of Wind's push, Vicious Mockery's disadvantage/);
  assert.match(text, /saves at the end of a turn \(Phantasmal Killer, Weird, Flesh to Stone, Acid Arrow's second burn\)/);
  assert.match(text, /Name the choice in condition on cast_at_enemy: Command's word \(grovel, halt\), Eyebite's form \(unconscious, frightened, sickened\), Bestow Curse's curse/);
  assert.match(text, /Lesser Restoration, Greater Restoration and Remove Curse go through cast_buff/);
  assert.match(text, /A creature held by Entangle, Web or Black Tentacles breaks free the same way, take_action escape/);
  assert.match(text, /Sculpt Spells; send sparedCharacterIds \[\] on aoe_damage to spare nobody/);
  assert.match(text, /Overchannel is overchannel true on cast_at_enemy or aoe_damage/);
  assert.match(text, /Signature Spells cost no slot once per short rest/);
  assert.doesNotMatch(text, /Phantasmal Killer[^.]*start of (the target's|its) turn/);
  const aoe = offered("aoe_damage").parameters.properties;
  assert.ok(aoe.sparedCharacterIds && aoe.overchannel, "aoe_damage does not take sparedCharacterIds and overchannel");
  assert.ok(offered("cast_at_enemy").parameters.properties.overchannel, "cast_at_enemy does not take overchannel");
});

await test("request_roll offers advantageReason, which the engine reads, and names the spell's caster for Holy Nimbus.", () => {
  const roll = requestRollTool.function.parameters.properties;
  assert.ok(roll.advantageReason, "request_roll's schema has no advantageReason");
  assert.match(roll.advantageReason.description, /sets the claim aside/);
  assert.match(roll.advantage.description, /advantageReason/);
  assert.match(roll.casterType.description, /Holy Nimbus/);
  assert.ok(roll.casterType.enum.includes("fiend") && roll.casterType.enum.includes("undead"));
  assert.match(systemText(), /gives the paladin advantage on saves against spells cast by fiends or undead/);
});

await test("A card's parenthesised arguments are passed as written, and a reaction card on another character's turn goes to use_reaction at once.", () => {
  const text = systemText();
  assert.match(text, /A card line's parenthesised arguments are the tool's own: pass them as written/);
  assert.match(text, /A player may play a reaction card on another character's turn \(Shield, Uncanny Dodge, Cutting Words\.\.\.\): its line names the reaction, and you resolve it with use_reaction at once, even though it is not their turn/);
});

// ---- the authored features left narrated for want of a hook (authored.md) ----

const { slotsOf, FULL_CASTER_SLOTS } = await import("./lib/enforce-spells.mjs");
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const diceOf = (roll, sides) =>
  (roll?.breakdown?.terms ?? []).filter((term) => term.sides === sides).reduce((sum, term) => sum + term.dice.length, 0);
const spend = (who, resource, args = {}) => world.invoke("use_resource", { characterId: who.id, resource, ...args });
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });
const tokenAt = (id) => {
  const found = kit.token(id);
  return { x: found.x, y: found.y };
};
async function enemyHits(enemy, target, faces) {
  kit.freshRound();
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out.result;
}

const beast = hero({ class: "barbarian", subclass: "Path of the Beast", level: 3, abilities: { str: 16 }, equipment: [] });

await test("Form of the Beast: while raging the barbarian attacks with claws (1d6 slashing), a bite (1d8 piercing, healing the proficiency bonus below half hit points) or a tail (1d8 piercing, 10-foot reach), proficient with STR; one more claw attack a turn; none of them without the rage.", async () => {
  const [enemy] = await stage(beast);
  const early = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "claws" });
  assert.equal(early.ok, false, "claws swung without a rage");
  const rage = await spend(beast, "Rage");
  assert.equal(rage.ok, true, rage.error);
  const first = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "claws" });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.toHit.total, 18 + 3 + 2, "STR + proficiency to hit");
  assert.equal(diceOf(first.damage, 6), 1, "the claw's d6");
  assert.equal(first.result.damageType, "slashing");
  assert.equal(first.damage.total, 4 + 3 + 2, "1d6 + STR + rage");
  const second = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "claws" });
  assert.equal(second.ok, true, `the extra claw attack: ${second.error}`);
  const third = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "claws" });
  assert.equal(third.ok, false, "a third attack at level 3");
  kit.freshTurn();
  kit.place(enemy.id, 5, 7);
  const far = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "claws" });
  assert.equal(far.ok, false, "claws reach 5 feet");
  const tail = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "tail" });
  assert.equal(tail.ok, true, `the tail reaches 10 feet: ${tail.error}`);
  assert.equal(diceOf(tail.damage, 8), 1);
  kit.freshTurn();
  kit.place(enemy.id, 5, 6);
  world.patch(beast.id, { currentHp: 20 });
  const bite = await kit.swing(beast.id, enemy.id, [18, 4], { weapon: "bite" });
  assert.equal(bite.ok, true, bite.error);
  assert.equal(world.sheet(beast.id).currentHp, 22, "the bite below half heals the proficiency bonus");
});

const soulknife = hero({ class: "rogue", subclass: "Soulknife", level: 3, abilities: { dex: 16 }, equipment: [] });

await test("Psychic Blades: the Soulknife's blade is a finesse, thrown weapon dealing 1d6 psychic + the ability modifier, proficient, that Sneak Attack rides; the bonus-action second blade deals 1d4.", async () => {
  const ally = hero({ class: "fighter", level: 3 });
  const [enemy] = await stage(soulknife);
  kit.place(ally.id, 6, 6);
  const blade = await kit.swing(soulknife.id, enemy.id, [15, 4, 3, 3], { weapon: "psychic blade" });
  assert.equal(blade.ok, true, blade.error);
  assert.equal(blade.toHit.total, 15 + 3 + 2);
  assert.equal(blade.result.damageType, "psychic");
  assert.equal(diceOf(blade.damage, 6), 3, "the blade's d6 and Sneak Attack's 2d6");
  const second = await kit.swing(soulknife.id, enemy.id, [15, 2], { weapon: "psychic blade", offHand: true });
  assert.equal(second.ok, true, second.error);
  assert.equal(diceOf(second.damage, 4), 1, "the second blade's d4");
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

const sunSoul = hero({ class: "monk", subclass: "Way of the Sun Soul", level: 3, abilities: { dex: 16, str: 10 }, equipment: [] });

await test("Radiant Sun Bolt: a ranged attack at 30 feet with DEX and proficiency, dealing the Martial Arts die + DEX in radiant damage.", async () => {
  const [enemy] = await stage(sunSoul);
  kit.place(enemy.id, 5, 10);
  const bolt = await kit.swing(sunSoul.id, enemy.id, [15, 3], { weapon: "radiant sun bolt" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(bolt.toHit.total, 15 + 3 + 2, "DEX + proficiency");
  assert.equal(bolt.result.damageType, "radiant");
  assert.equal(diceOf(bolt.damage, 4), 1, "the Martial Arts d4 at 3rd level");
  assert.equal(bolt.damage.total, 3 + 3);
});

const colossus = hero({ class: "barbarian", subclass: "Path of the Giant", level: 10, abilities: { str: 16 }, equipment: [{ name: "Greataxe", qty: 1 }] });

await test("Demiurgic Colossus: while raging the barbarian's melee reach grows by 5 feet.", async () => {
  const [enemy] = await stage(colossus);
  kit.place(enemy.id, 5, 7);
  const calm = await kit.swing(colossus.id, enemy.id, [18, 6]);
  assert.equal(calm.ok, false, "a greataxe reaches 5 feet without the rage");
  assert.equal((await spend(colossus, "Rage")).ok, true);
  const raging = await kit.swing(colossus.id, enemy.id, [18, 6]);
  assert.equal(raging.ok, true, `10 feet while raging: ${raging.error}`);
});

const cavalier = hero({ class: "fighter", subclass: "Cavalier", level: 18, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });

async function walkAway(owner, count) {
  const list = await stage(owner, { enemies: count });
  kit.place(owner.id, 5, 5);
  list.forEach((enemy, index) => kit.place(enemy.id, 4 + index * 2, 6));
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  for (const [index, enemy] of list.entries()) {
    kit.freshRound();
    world.clearDice();
    world.dice(15, 4);
    await world.invoke("move_token", { token: enemy.id, x: 1 + index * 8, y: 10 });
    world.clearDice();
  }
  return newRolls(before).filter((roll) => roll.kind === "attack" && roll.characterId === owner.id).length;
}

await test("Vigilant Defender: the fighter makes an opportunity attack on every other creature's turn, with a reaction for each, not one a round.", async () => {
  const plain = hero({ class: "fighter", level: 18, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
  assert.equal(await walkAway(plain, 2), 1, "one reaction, one opportunity attack a round");
  assert.equal(await walkAway(cavalier, 2), 2, "an opportunity attack on each creature's turn");
});

// One wearer for Demon Armor's tests, so the fights after them meet no
// extra fighter in reach.
const demonWearer = hero({ class: "fighter", level: 18, abilities: { str: 16 }, equipment: [{ name: "Demon Armor", qty: 1, equipped: true, attuned: true }] });

await test("Demon Armor: 'clawed gauntlets turn unarmed strikes with your hands into magic weapons that deal slashing damage, with a +1 bonus to attack rolls and damage rolls and a damage die of 1d8', on the turn and on an opportunity attack.", async () => {
  const wearer = demonWearer;
  const [enemy] = await stage(wearer);
  const out = await kit.swing(wearer.id, enemy.id, [15, 5], { weapon: "unarmed strike" });
  assert.equal(out.ok, true, out.error);
  // 15 + 3 (Strength) + 6 (proficiency) + 1, and 5 + 3 + 1.
  assert.equal(out.toHit?.total, 25);
  assert.equal(out.damage?.total, 9);
  assert.equal(out.result.damageType, "slashing");
  // The reaction's swing reads the same gauntlets.
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  kit.place(wearer.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  world.clearDice();
  world.dice(15, 4);
  await world.invoke("move_token", { token: enemy.id, x: 1, y: 10 });
  world.clearDice();
  const swing = newRolls(before).find((roll) => roll.kind === "attack" && roll.characterId === wearer.id);
  assert.ok(swing, "no opportunity attack was rolled");
  assert.equal(swing.total, 25, "the opportunity attack lost the gauntlets' bonus");
});

await test("Demon Armor's curse: 'While wearing the armor, you have disadvantage on attack rolls against demons', on the turn and on an opportunity attack; a devil is no demon.", async () => {
  const wearer = demonWearer;
  const [demon] = await stage(wearer, { stats: { type: "fiend (demon)" } });
  // The lower of 18 and 2: 2 + 3 (Strength) + 6 (proficiency) + 1.
  const cursed = await kit.swing(wearer.id, demon.id, [18, 2, 5], { weapon: "unarmed strike" });
  assert.equal(cursed.ok, true, cursed.error);
  assert.equal(cursed.toHit?.total, 12, "the curse gave no disadvantage against a demon");
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  kit.place(wearer.id, 5, 5);
  kit.place(demon.id, 5, 6);
  kit.freshRound();
  world.clearDice();
  world.dice(18, 2, 4);
  await world.invoke("move_token", { token: demon.id, x: 1, y: 10 });
  world.clearDice();
  const swing = newRolls(before).find((roll) => roll.kind === "attack" && roll.characterId === wearer.id);
  assert.ok(swing, "no opportunity attack was rolled");
  assert.equal(swing.total, 12, "the opportunity attack against a demon lost the curse");
  const [devil] = await stage(wearer, { stats: { type: "fiend (devil)" } });
  const plain = await kit.swing(wearer.id, devil.id, [18, 2, 5], { weapon: "unarmed strike" });
  assert.equal(plain.toHit?.total, 28, "a devil drew the demons' curse");
});

await test("Demon Armor's curse: 'disadvantage ... on saving throws against their spells and special abilities', a demon's spell and its ability alike; a devil's spell is saved against with one d20.", async () => {
  const wearer = demonWearer;
  async function forced(type, args) {
    const [caster] = await stage(wearer, { stats: { type, ...(args.spell ? { spells: [args.spell] } : {}) } });
    world.clearDice();
    world.dice(20, 2);
    const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
    const out = await world.invoke("cast_at_player", { characterId: wearer.id, saveAbility: "wis", dc: 15, casterEnemyId: caster.id, ...args });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    return newRolls(before).find((roll) => roll.kind === "saving_throw" && roll.characterId === wearer.id) ?? null;
  }
  const spell = await forced("fiend (demon)", { spell: "Hold Person", condition: "paralyzed" });
  assert.equal(d20Faces(spell).length, 2, "a demon's spell: the wearer rolls two d20s");
  assert.ok(spell.total < 15, `the lower d20 is kept (${spell.total})`);
  const ability = await forced("fiend (demon)", { enemyAbility: "Abyssal Stare", condition: "frightened" });
  assert.equal(d20Faces(ability).length, 2, "a demon's special ability: two d20s");
  const devil = await forced("fiend (devil)", { spell: "Hold Person", condition: "paralyzed" });
  assert.equal(d20Faces(devil).length, 1, "a devil draws no curse");
});

const samurai = hero({ class: "fighter", subclass: "Samurai", level: 15, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });

await test("Rapid Strike: once a turn, an attack with advantage forgoes it for one more attack of the Attack action; with no advantage there is nothing to trade.", async () => {
  const [enemy] = await stage(samurai);
  const plain = await kit.swing(samurai.id, enemy.id, [15, 5], { rapidStrike: true });
  assert.equal(plain.ok, false, "Rapid Strike with no advantage to forgo");
  kit.freshTurn();
  kit.setEnemy(enemy.id, { conditions: ["prone"], conditionMeta: {} });
  const traded = await kit.swing(samurai.id, enemy.id, [15, 5, 5], { rapidStrike: true });
  assert.equal(traded.ok, true, traded.error);
  assert.equal(d20Faces(traded.toHit).length, 1, "the advantage is forgone");
  assert.equal(world.encounter().turnBudget.attacksAllowed, 4, "one more attack of the action");
  const again = await kit.swing(samurai.id, enemy.id, [15, 5, 5], { rapidStrike: true });
  assert.equal(again.ok, false, "once a turn");
});

const inquisitive = hero({ class: "rogue", subclass: "Inquisitive", level: 17, abilities: { dex: 16 }, equipment: [{ name: "Rapier", qty: 1 }] });

await test("Eye for Weakness: Sneak Attack against the Inquisitive's Insightful Fighting target deals 3d6 more.", async () => {
  const [enemy] = await stage(inquisitive);
  kit.setEnemy(enemy.id, { conditions: ["insightful fighting"], conditionMeta: { "insightful fighting": { source: inquisitive.id, rounds: 10 } } });
  const out = await kit.swing(inquisitive.id, enemy.id, [15, 4, ...Array(12).fill(3)]);
  assert.equal(out.ok, true, out.error);
  assert.equal(diceOf(out.damage, 6), 9 + 3, "Sneak Attack's 9d6 and Eye for Weakness's 3d6");
});

const drunkard = hero({ class: "monk", subclass: "Way of the Drunken Master", level: 6, abilities: { dex: 16, wis: 14 }, equipment: [] });

await test("Tipsy Sway: standing up from prone costs the monk 5 feet, and for 1 ki a reaction turns a melee attack that missed them onto another creature within 5 feet.", async () => {
  const [attacker, other] = await stage(drunkard, { enemies: 2 });
  kit.place(other.id, 4, 5);
  fresh(drunkard.id, { conditions: ["prone"], conditionMeta: {} });
  const board = kit.map();
  const budget = pcMoveBudget(world.campaignId, world.encounter(), board, world.sheet(drunkard.id), kit.token(drunkard.id));
  assert.equal(budget.tiles, budget.fullTiles - 1, "standing costs one square");
  fresh(drunkard.id);
  world.patch(drunkard.id, { ac: 30, acOverride: true });
  await enemyHits(attacker, drunkard, [2]);
  const ki = world.sheet(drunkard.id).resources.ki.used;
  const hpBefore = kit.enemy(other.id).currentHp;
  world.dice(5);
  const out = await react(drunkard, "Tipsy Sway", { targetEnemyId: other.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(kit.enemy(other.id).currentHp < hpBefore, "the missed blow lands on the other creature");
  assert.equal(world.sheet(drunkard.id).resources.ki.used, ki + 1, "1 ki");
});

const avenger = hero({ class: "paladin", subclass: "Oath of Vengeance", level: 7, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });

await test("Relentless Avenger: after the paladin's opportunity attack hits, they move up to half their speed as part of that reaction, drawing no opportunity attacks; without that hit there is no move.", async () => {
  const [enemy] = await stage(avenger);
  const early = await react(avenger, "Relentless Avenger", { x: 5, y: 2 });
  assert.equal(early.ok, false, "no opportunity attack has hit");
  world.clearDice();
  world.dice(18, 5);
  await world.invoke("move_token", { token: enemy.id, x: 5, y: 10 });
  world.clearDice();
  const out = await react(avenger, "Relentless Avenger", { x: 5, y: 8 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(tokenAt(avenger.id), { x: 5, y: 8 });
  const further = await react(avenger, "Relentless Avenger", { x: 5, y: 2 });
  assert.equal(further.ok, false, "one move for one hit");
});

const scout = hero({ class: "rogue", subclass: "Scout", level: 3, abilities: { dex: 16 }, equipment: [{ name: "Shortsword", qty: 1 }] });

await test("Skirmisher: when an enemy stands within 5 feet of the Scout, a reaction moves them up to half their speed without drawing opportunity attacks.", async () => {
  const [enemy] = await stage(scout);
  kit.place(enemy.id, 9, 9);
  const alone = await react(scout, "Skirmisher", { x: 5, y: 3 });
  assert.equal(alone.ok, false, "no enemy within 5 feet");
  // "When an enemy ends its turn within 5 feet of you": the enemy's turn ends
  // beside the Scout, as the engine ends it when the pointer leaves it
  // (src/lib/dm/last-hit.ts closeHitsAtTurnEnd keeps the trigger).
  kit.place(enemy.id, 5, 6);
  const nothing = await react(scout, "Skirmisher", { x: 5, y: 2 });
  assert.equal(nothing.ok, false, "an enemy standing there whose turn has not ended is not the trigger");
  const { closeHitsAtTurnEnd } = await import("../src/lib/dm/last-hit.ts");
  const encounter = world.encounter();
  closeHitsAtTurnEnd(world.campaignId, encounter, encounter.order.find((entry) => entry.enemyId === enemy.id));
  const tooFar = await react(scout, "Skirmisher", { x: 5, y: 1 });
  assert.equal(tooFar.ok, false, "more than half their speed");
  const before = kit.lastRolls(60).length;
  const out = await react(scout, "Skirmisher", { x: 5, y: 2 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(tokenAt(scout.id), { x: 5, y: 2 });
  assert.ok(world.encounter().reactionsUsed.includes(scout.id), "the reaction is spent");
  assert.equal(kit.lastRolls(60).length, before, "no opportunity attack rolled");
});

const slayer = hero({ class: "ranger", subclass: "Monster Slayer", level: 7, abilities: { wis: 14 }, equipment: [{ name: "Longbow", qty: 1 }] });

await test("Supernatural Defense: the Monster Slayer adds 1d6 to saves against the creature their Slayer's Prey marks.", async () => {
  const [enemy] = await stage(slayer, { stats: { spells: ["Hold Person"] } });
  const marked = await spend(slayer, "Slayer's Prey", { targetEnemyId: enemy.id });
  assert.equal(marked.ok, true, marked.error);
  world.clearDice();
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  const out = await world.invoke("cast_at_player", {
    characterId: slayer.id, spell: "Hold Person", saveAbility: "wis", dc: 15, condition: "paralyzed", casterEnemyId: enemy.id,
  });
  assert.equal(out.ok, true, out.error);
  const save = newRolls(before).find((roll) => roll.kind === "saving_throw" && roll.characterId === slayer.id);
  assert.equal(diceOf(save, 6), 1, "the save carries Supernatural Defense's d6");
});

const fathomless = hero({
  class: "warlock", subclass: "The Fathomless", level: 10, abilities: { cha: 16 },
  spellcasting: { ability: "cha", slots: slotsOf(FULL_CASTER_SLOTS[9]), prepared: ["Evard's Black Tentacles"], known: ["Evard's Black Tentacles"], cantrips: [] },
});

await test("Grasping Tentacles: casting Evard's Black Tentacles gives the warlock temporary hit points equal to their level, and damage cannot break their concentration on it.", async () => {
  const [enemy] = await stage(fathomless);
  fresh(fathomless.id);
  world.dice(1, 1, 1);
  const cast = await world.invoke("aoe_damage", { spell: "Evard's Black Tentacles", casterCharacterId: fathomless.id, enemyIds: [enemy.id], saveAbility: "dex", dc: 15 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(world.sheet(fathomless.id).tempHp, 10, "the warlock level in temporary hit points");
  assert.match(world.sheet(fathomless.id).concentratingOn ?? "", /tentacles/i);
  world.dice(1, 1);
  await world.invoke("apply_damage", { characterId: fathomless.id, amount: 40, type: "slashing" });
  world.clearDice();
  assert.match(world.sheet(fathomless.id).concentratingOn ?? "", /tentacles/i, "damage broke the concentration");
});

const wildfire = hero({
  class: "druid", subclass: "Circle of Wildfire", level: 6, abilities: { wis: 16 },
  spellcasting: { ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[5]), prepared: ["Cure Wounds"], known: [], cantrips: ["Produce Flame"] },
});

await test("Enhanced Bond: while the wildfire spirit is out, the druid's fire spells deal 1d8 more and their healing spells heal 1d8 more; Summon Wildfire Spirit spends a Wild Shape use.", async () => {
  const [enemy] = await stage(wildfire);
  kit.place(enemy.id, 5, 8);
  const summoned = await spend(wildfire, "Summon Wildfire Spirit");
  assert.equal(summoned.ok, true, summoned.error);
  kit.freshTurn();
  const flame = await kit.swing(wildfire.id, enemy.id, [18, ...Array(6).fill(3)], { spell: "Produce Flame" });
  assert.equal(flame.ok, true, flame.error);
  assert.equal(diceOf(flame.damage, 8), 3, "Produce Flame's 2d8 at 5th level and the bond's 1d8");
  const hurt = hero({ class: "fighter", level: 5 });
  world.patch(hurt.id, { currentHp: 10 });
  await kit.endFight();
  world.patch(hurt.id, { currentHp: 10 });
  fresh(wildfire.id, { conditions: ["wildfire spirit"], conditionMeta: { "wildfire spirit": { rounds: 600 } } });
  world.clearDice();
  world.dice(4, 4);
  const healed = await world.invoke("heal", { characterId: hurt.id, casterId: wildfire.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  assert.equal(healed.ok, true, healed.error);
  assert.equal(world.sheet(hurt.id).currentHp, 10 + 4 + 3 + 4, "1d8 + WIS and the bond's 1d8");
});

const artillerist = hero({
  class: "artificer", subclass: "Artillerist", level: 5, abilities: { int: 16 },
  equipment: [{ name: "Wand", qty: 1 }],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});

await test("Arcane Firearm: an artificer spell cast through the wand, staff or rod the artificer carries deals 1d8 more on one damage roll.", async () => {
  const [enemy] = await stage(artillerist);
  // At range: a ranged spell attack beside a hostile creature is at disadvantage.
  kit.place(enemy.id, 5, 8);
  const bolt = await kit.swing(artillerist.id, enemy.id, [18, 3, 3, 3], { spell: "Fire Bolt" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(diceOf(bolt.damage, 10), 2, "Fire Bolt's 2d10 at 5th level");
  assert.equal(diceOf(bolt.damage, 8), 1, "the firearm's 1d8");
  world.patch(artillerist.id, { equipment: [] });
  kit.freshTurn();
  const bare = await kit.swing(artillerist.id, enemy.id, [18, 3, 3, 3], { spell: "Fire Bolt" });
  assert.equal(diceOf(bare.damage, 8), 0, "no firearm, no 1d8");
});

const reaper = hero({
  class: "cleric", subclass: "Death Domain", level: 17, abilities: { wis: 16 },
  spellcasting: { ability: "wis", slots: slotsOf(FULL_CASTER_SLOTS[16]), prepared: ["Blindness/Deafness"], known: [], cantrips: [] },
});

await test("Improved Reaper: a necromancy spell of 1st to 5th level that targets one creature strikes a second creature within 5 feet of the first with the same slot, at no cost in hit points.", async () => {
  const [first, second] = await stage(reaper, { enemies: 2 });
  kit.place(second.id, 6, 6);
  const slotsBefore = world.sheet(reaper.id).spellcasting.slots["2"].used;
  const hpBefore = world.sheet(reaper.id).currentHp;
  world.clearDice();
  world.dice(1, 1, 3, 3);
  const out = await world.invoke("cast_at_enemy", {
    characterId: reaper.id, spell: "Blindness/Deafness", targetEnemyId: first.id, secondTargetEnemyId: second.id, saveAbility: "con", dc: 15, condition: "blinded",
  });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(kit.enemy(first.id).conditions.includes("blinded"));
  assert.ok(kit.enemy(second.id).conditions.includes("blinded"), "the second creature is struck too");
  assert.equal(world.sheet(reaper.id).spellcasting.slots["2"].used, slotsBefore + 1, "one slot for both");
  assert.equal(world.sheet(reaper.id).currentHp, hpBefore, "Improved Reaper costs no hit points (issue 474)");
});

const creation = hero({ class: "bard", subclass: "College of Creation", level: 3, abilities: { cha: 16 } });

await test("Mote of Potential: a Creation bard's Bardic Inspiration die rolls twice and keeps the higher on an ability check, and on a saving throw gives its holder temporary hit points equal to the die plus the bard's CHA.", async () => {
  const friend = hero({ class: "fighter", level: 3 });
  await kit.endFight();
  const given = await spend(creation, "Bardic Inspiration", { targetCharacterId: friend.id });
  assert.equal(given.ok, true, given.error);
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  await world.invoke("request_roll", { characterId: friend.id, kind: "skill_check", skill: "athletics", dc: 10, reason: "climb" });
  const check = newRolls(before).find((roll) => roll.characterId === friend.id);
  assert.equal(diceOf(check, 6), 2, "the d6 rolled twice, the higher kept");
  const again = await spend(creation, "Bardic Inspiration", { targetCharacterId: friend.id });
  assert.equal(again.ok, true, again.error);
  fresh(friend.id, { conditions: world.sheet(friend.id).conditions, conditionMeta: world.sheet(friend.id).conditionMeta });
  world.clearDice();
  world.dice(10, 4);
  await world.invoke("request_roll", { characterId: friend.id, kind: "saving_throw", ability: "con", dc: 10, reason: "poison" });
  world.clearDice();
  assert.equal(world.sheet(friend.id).tempHp, 4 + 3, "the die and the bard's CHA in temporary hit points");
});

const swarmer = hero({ class: "ranger", subclass: "Swarmkeeper", level: 11, abilities: { str: 14, wis: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });

await test("Gathered Swarm moves the creature the ranger hit 15 feet on a failed STR save instead of its damage, once a turn; with Mighty Swarm the moved creature is knocked prone.", async () => {
  const [enemy] = await stage(swarmer);
  const hit = await kit.swing(swarmer.id, enemy.id, [18, 4, 4]);
  assert.equal(hit.ok, true, hit.error);
  kit.freshTurn();
  // "a hit lets your swarm deal 1d6 piercing damage, move the target 15
  // feet, or move you 5 feet": the push follows the hit, in place of the
  // damage (its die comes back off), and once a turn. It was refused after
  // every hit and reached only through a turn wiped by hand.
  const struck = await kit.swing(swarmer.id, enemy.id, [18, 4]);
  assert.equal(struck.ok, true, struck.error);
  world.clearDice();
  world.dice(1);
  const fresh1 = await spend(swarmer, "Gathered Swarm", { variant: "push", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(fresh1.ok, true, fresh1.error);
  const again = await spend(swarmer, "Gathered Swarm", { variant: "push", targetEnemyId: enemy.id });
  assert.equal(again.ok, false, "once a turn");
  const at = tokenAt(enemy.id);
  assert.ok(Math.max(Math.abs(at.x - 5), Math.abs(at.y - 5)) >= 3, `moved away: ${JSON.stringify(at)}`);
  assert.ok(kit.enemy(enemy.id).conditions.includes("prone"), "Mighty Swarm knocks it prone");
});

const battleSmith = hero({ class: "artificer", subclass: "Battle Smith", level: 9, abilities: { int: 16 }, equipment: [{ name: "Longsword +1", qty: 1 }] });

await test("Arcane Jolt: once a turn, after a magic weapon hit, the Battle Smith deals 2d6 force to the creature (4d6 from 15th level, Improved Defender) or heals a creature 2d6, spending a use.", async () => {
  const [enemy] = await stage(battleSmith);
  const uses = world.sheet(battleSmith.id).resources.art_arcane_jolt;
  assert.ok(uses, "the Battle Smith holds Arcane Jolt uses");
  world.clearDice();
  const early = await spend(battleSmith, "Arcane Jolt", { variant: "burn", targetEnemyId: enemy.id });
  assert.equal(early.ok, false, "no hit yet");
  assert.match(early.error, /rides a weapon hit/);
  assert.equal(world.sheet(battleSmith.id).resources.art_arcane_jolt.used, uses.used, "the refusal spends nothing");
  world.dice(18, 4);
  const struck = await world.invoke("pc_attack", { characterId: battleSmith.id, targetEnemyId: enemy.id, weapon: "Longsword +1" });
  world.clearDice();
  assert.equal(struck.ok, true, struck.error);
  const hp = kit.enemy(enemy.id).currentHp;
  world.dice(4, 4);
  const jolt = await spend(battleSmith, "Arcane Jolt", { variant: "burn", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(jolt.ok, true, jolt.error);
  assert.equal(kit.enemy(enemy.id).currentHp, hp - 8, "2d6 force");
  assert.equal(world.sheet(battleSmith.id).resources.art_arcane_jolt.used, uses.used + 1);
  const again = await spend(battleSmith, "Arcane Jolt", { variant: "burn", targetEnemyId: enemy.id });
  assert.equal(again.ok, false, "once a turn");
});

await test("Arcane Jolt: a miss opens nothing, a burn goes to the creature hit, and a heal needs only the hit.", async () => {
  const plain = hero({ class: "artificer", subclass: "Battle Smith", level: 9, abilities: { int: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
  let [enemy] = await stage(plain);
  world.clearDice();
  world.dice(2, 4);
  const missed = await world.invoke("pc_attack", { characterId: plain.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(missed.ok, true, missed.error);
  const none = await spend(plain, "Arcane Jolt", { variant: "heal", targetCharacterId: plain.id });
  assert.equal(none.ok, false, "a miss rides nothing");
  assert.match(none.error, /rides a weapon hit/);
  // An infused weapon reads as a plain one, so a plain name still opens it.
  world.dice(18, 4);
  await world.invoke("pc_attack", { characterId: plain.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  world.dice(4, 4);
  const opened = await spend(plain, "Arcane Jolt", { variant: "burn", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(opened.ok, true, opened.error);

  const foes = await stage(battleSmith, { enemies: 2 });
  [enemy] = foes;
  const other = foes[1];
  world.clearDice();
  world.dice(18, 4);
  await world.invoke("pc_attack", { characterId: battleSmith.id, targetEnemyId: enemy.id, weapon: "Longsword +1" });
  world.clearDice();
  const wrong = await spend(battleSmith, "Arcane Jolt", { variant: "burn", targetEnemyId: other.id });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /burns the creature the hit landed on/);
  world.dice(4, 4);
  const healed = await spend(battleSmith, "Arcane Jolt", { variant: "heal", targetCharacterId: battleSmith.id });
  world.clearDice();
  assert.equal(healed.ok, true, healed.error);
});

await test("Arcane Jolt's mark does not bring back a fight its hit ended.", async () => {
  const [enemy] = await stage(battleSmith, { hp: 1 });
  world.clearDice();
  world.dice(18, 4);
  const out = await world.invoke("pc_attack", { characterId: battleSmith.id, targetEnemyId: enemy.id, weapon: "Longsword +1" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.encounterOver, true, JSON.stringify(out.result).slice(0, 300));
  assert.equal(world.encounter()?.status === "active", false, "the fight stays over");
});

await test("Arcane Jolt's mark keeps what the blow wrote: a concentrating legendary creature's failed save can still be turned.", async () => {
  const encounters = await import("../src/lib/db/encounters.ts");
  const [enemy] = await stage(battleSmith);
  encounters.setEnemyConcentration(enemy.id, "Hold Person");
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, pools: { ...encounter.legendary?.pools, [enemy.id]: { actions: 0, resistances: 3 } } } });
  world.clearDice();
  world.dice(18, 4, 1);
  const out = await world.invoke("pc_attack", { characterId: battleSmith.id, targetEnemyId: enemy.id, weapon: "Longsword +1" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.encounter().legendary.failedSave, "the failed save is on record");
  assert.ok(world.encounter().turnBudget.oncePerTurn.includes(`weapon-hit:${enemy.id}`), "and so is the mark");
});

await test("At a physical-dice table a hit opens Arcane Jolt too, and a miss does not.", async () => {
  const { handlePcAttack, resolvePendingPcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
  const { createDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
  const { insertRoll } = await import("../src/lib/db/rolls.ts");
  const { rollExpression } = await import("../src/lib/dice.ts");
  for (const [face, opens] of [[2, false], [18, true]]) {
    const [enemy] = await stage(battleSmith);
    world.clearDice();
    const turn = createDmTurn(world.campaignId, [], "human_dm");
    const sheets = world.sheets();
    const seen = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const parked = handlePcAttack(
      world.campaign(), turn,
      JSON.stringify({ characterId: battleSmith.id, targetEnemyId: enemy.id, weapon: "Longsword +1" }),
      sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), new Set([world.sheet(battleSmith.id).userId]), null,
    );
    assert.equal(parked[PC_ATTACK_PARKED], true, JSON.stringify(parked));
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => !seen.has(entry.id));
    world.dice(face);
    const roll = insertRoll({ campaignId: world.campaignId, characterId: battleSmith.id, requestedBy: "dm", kind: "attack", detail: pending.detail, result: rollExpression(pending.expression) });
    world.clearDice();
    resolvePendingPcAttack(pending, roll);
    const marks = world.encounter().turnBudget.oncePerTurn;
    assert.equal(marks.includes(`weapon-hit:${enemy.id}`), opens, `a ${face}: ${JSON.stringify(marks)}`);
  }
});

await test("The prompt and the tool schemas name the final round's subclass hooks: the weapons a feature makes, rapidStrike, Improved Reaper's second target, the reaction moves and Tipsy Sway.", () => {
  const text = systemText();
  assert.match(text, /a weapon a subclass feature makes is named as the weapon \(a raging Path of the Beast barbarian's bite, claws or tail, a Soulknife's psychic blade with feature "Two-Weapon Fighting" for the second blade, a Sun Soul monk's radiant sun bolt\)/);
  assert.match(text, /rapidStrike is a Samurai's Rapid Strike on an attack that has advantage/);
  assert.match(text, /Improved Reaper is a second entry in targets/);
  assert.match(text, /is use_reaction with the square's x and y, never move_token/);
  const attack = offered("pc_attack").parameters.properties.attacks.items.properties;
  assert.ok(attack.rapidStrike, "pc_attack takes no rapidStrike");
  assert.match(attack.weapon.description, /psychic blade/);
  assert.match(offered("cast_at_enemy").parameters.properties.targets.description, /Improved Reaper/, "cast_at_enemy's targets name no second target");
  const reaction = offered("use_reaction");
  assert.ok(reaction.parameters.properties.x && reaction.parameters.properties.y, "use_reaction takes no square");
  for (const name of ["Tipsy Sway", "Skirmisher", "Relentless Avenger"]) {
    assert.ok(JSON.stringify(reaction).includes(name), `use_reaction never names ${name}`);
  }
  const resource = JSON.stringify(offered("use_resource"));
  for (const name of ["Summon Wildfire Spirit", "Gathered Swarm", "Arcane Jolt"]) {
    assert.ok(resource.includes(name), `use_resource never names ${name}`);
  }
});

finish();
