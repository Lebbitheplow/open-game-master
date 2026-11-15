// Ability checks and saving throws, from the 2026-11-15 rules audit (the
// checks lens, findings K01..). Each test names its finding and the SRD 5.1
// rule it holds the engine to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1115-checks");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const { getDatabase } = await import("../src/lib/db/core.ts");
const maps = await import("../src/lib/db/battle-maps.ts");
const { clearLitTilesCache } = await import("../src/lib/battlemap/lit-cache.ts");
const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");
const { rollExtrasFor } = await import("../src/lib/dm/forced-save.ts");

// A roll as the engine builds it for this character, nothing rolled.
function resolved(heroId, args) {
  const sheet = world.sheet(heroId);
  return resolveRollExpression({ characterId: heroId, ...args }, sheet, rollExtrasFor(world.campaign(), sheet, args.kind));
}

const klass = (classId, ...names) => names.map((name) => ({ name, source: "class", classId }));

// A call with its dice forced, the queue emptied after.
async function forced(faces, call) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await call();
  world.clearDice();
  return out;
}

// The enemy holds the floor, as it does when it casts on its own turn.
function enemyHoldsTheFloor() {
  const fight = world.encounter();
  kit.saveEncounter({ ...fight, turnIndex: Math.max(0, fight.order.findIndex((entry) => entry.kind !== "pc")), turnBudget: null });
}

// K01. SRD 5.1, Fighter, Indomitable: "you can reroll a saving throw that you
// fail. If you do so, you must use the new roll." Monk, Diamond Soul: the
// same for 1 ki. A new roll that succeeds is a made save, so the damage the
// failure alone dealt goes: half of it for a save-for-half spell. The reroll
// lifted the conditions the save ends and left the full damage standing.
// The monk's spell asks a Constitution save: a monk 14 has Evasion on
// Dexterity saves, which halves the failure already.
for (const [label, hero, spend, spell] of [
  ["Indomitable", { class: "fighter", level: 9, features: klass("fighter", "Indomitable (1 use)") }, { resource: "Indomitable" }, { spell: "Burning Hands", saveAbility: "dex", damage: "3d6", damageType: "fire" }],
  ["Diamond Soul", { class: "monk", level: 14, features: klass("monk", "Ki", "Diamond Soul") }, { resource: "Ki", variant: "diamond soul" }, { spell: "Shatter", saveAbility: "con", damage: "3d8", damageType: "thunder" }],
]) {
  await test(`K01: a ${label} reroll that succeeds gives back the damage a made save spares`, async () => {
    const who = world.addHero({ ...hero, maxHp: 60, abilities: { dex: 10 }, proficiencies: { ...TRAINED } });
    world.patch(who.id, { currentHp: 60 });
    await kit.endFight();
    const [enemy] = (await kit.fight(1), world.enemies());
    kit.setEnemy(enemy.id, { stats: { spells: [spell.spell], abilities: { str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10 } } });
    enemyHoldsTheFloor();
    // A 2 fails the save; three 4s deal 12.
    const cast = await forced([2, 4, 4, 4], () =>
      world.invoke("cast_at_player", { characterId: who.id, casterEnemyId: enemy.id, level: spell.spell === "Shatter" ? 2 : 1, dc: 13, ...spell }),
    );
    assert.equal(cast.ok, true, cast.error);
    assert.equal(world.sheet(who.id).currentHp, 48, "the staging: the failed save took all 12");
    const reroll = await forced([19], () => world.invoke("use_resource", { characterId: who.id, ...spend }));
    assert.equal(reroll.ok, true, reroll.error);
    assert.match(JSON.stringify(reroll.result), /reroll succeeds/i);
    assert.equal(world.sheet(who.id).currentHp, 54, `a made save takes half, 6: HP ${world.sheet(who.id).currentHp}`);
    await kit.endFight();
  });
}

// Night under a roof: no ambient light, no lamps, no torches.
function darkBoard() {
  const board = kit.map();
  maps.setBattleMapOutdoors(board.id, false);
  getDatabase().prepare(`UPDATE battle_maps SET ambient = 'dark', lights_json = '[]', zones_json = '[]' WHERE id = ?`).run(board.id);
  for (const token of maps.listTokens(board.id)) {
    maps.setTokenLight(token.id, 0);
  }
  clearLitTilesCache();
}

// K02. SRD 5.1, Vision and Light: darkvision sees "in darkness as if it were
// dim light", and dim light only lightly obscures; Hiding: "You can't hide
// from a creature that can see you clearly" (Skulker is the feat that lets a
// creature hide while only lightly obscured). The Hide gate took any dark
// board as cover from every watcher: a goblin with darkvision 60 feet, four
// squares off, lost sight of a rogue in the dark, and a rogue standing in an
// ally's torchlight hid because the torch was not their own.
await test("K02: a watcher with darkvision sees a hider in the dark, and a torch's light gives the hider away", async () => {
  const thief = world.addHero({ class: "rogue", level: 5, abilities: { dex: 16 }, proficiencies: { ...TRAINED, skills: ["stealth"] } });
  const lamp = world.addHero({ class: "fighter", level: 5, proficiencies: { ...TRAINED } });
  const hideNow = () => forced([15], () => world.invoke("take_action", { characterId: thief.id, action: "hide" }));
  const stage = async (senses) => {
    await kit.endFight();
    const [enemy] = (await kit.fight(1), world.enemies());
    kit.setEnemy(enemy.id, { stats: { senses } });
    darkBoard();
    kit.giveTurn(thief.id);
    kit.place(thief.id, 5, 5);
    kit.place(enemy.id, 5, 9);
    kit.place(lamp.id, 1, 1);
    return enemy;
  };
  await stage({ passivePerception: 10, darkvision: 60 });
  const seen = await hideNow();
  assert.equal(seen.ok, false, "a goblin with darkvision 20 feet away sees the rogue in the dark");
  assert.match(String(seen.error), /cannot hide/);
  await stage({ passivePerception: 10 });
  const unseen = await hideNow();
  assert.equal(unseen.ok, true, `with no darkvision the dark hides the rogue: ${unseen.error}`);
  // An ally's torch beside the rogue lights their square for every watcher.
  await stage({ passivePerception: 10 });
  kit.place(lamp.id, 5, 4);
  maps.setTokenLight(kit.token(lamp.id).id, 4);
  clearLitTilesCache();
  const lit = await hideNow();
  assert.equal(lit.ok, false, "the rogue stands in the fighter's torchlight");
  await kit.endFight();
});

// K03. SRD 5.1, Initiative: "each participant makes a Dexterity check", so
// what rides a Dexterity check, or every ability check, rides initiative:
// Enhance Ability's Cat's Grace ("advantage on Dexterity checks"), Foresight
// and Bestow Curse on Dexterity, and the Stone of Good Luck ("+1 bonus to
// ability checks and saving throws"). Each counted on a Dexterity check and
// was lost on the initiative roll.
await test("K03: initiative is a Dexterity check: Cat's Grace, a Dexterity curse and the Stone of Good Luck ride it", async () => {
  await kit.endFight();
  const quick = world.addHero({ class: "fighter", level: 1, abilities: { dex: 14 }, proficiencies: { ...TRAINED } });
  world.patch(quick.id, { conditions: ["enhance ability (cat's grace)"] });
  assert.equal(resolved(quick.id, { kind: "ability_check", ability: "dex" }).expression, "2d20kh1+2", "the staging: Cat's Grace on a Dexterity check");
  assert.equal(resolved(quick.id, { kind: "initiative" }).expression, "2d20kh1+2", "Cat's Grace gives initiative advantage");
  world.patch(quick.id, { conditions: ["cursed (dex)"] });
  assert.equal(resolved(quick.id, { kind: "initiative" }).expression, "2d20kl1+2", "a Dexterity curse puts initiative at disadvantage");
  world.patch(quick.id, { conditions: ["cursed (str)"] });
  assert.equal(resolved(quick.id, { kind: "initiative" }).expression, "1d20+2", "a Strength curse leaves initiative alone");
  world.patch(quick.id, { conditions: [], equipment: [{ name: "Stone of Good Luck (Luckstone)", qty: 1, attuned: true, equipped: true }] });
  const encounter = await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [quick.id]: 10 } });
  const entry = encounter.order.find((row) => row.characterId === quick.id);
  assert.equal(entry?.initiative, 10 + 2 + 1, `the Stone of Good Luck's +1 rides initiative: ${entry?.initiative}`);
  await kit.endFight();
  world.patch(quick.id, { equipment: [] });
});

// K04. SRD 5.1, Champion, Remarkable Athlete: "add half your proficiency
// bonus (round up) to any Strength, Dexterity, or Constitution check you make
// that doesn't already use your proficiency bonus"; Bard, Jack of All
// Trades: half "rounded down" to any ability check. A bard who is also a
// Champion keeps the better half on each check: the round-up on the physical
// ones. The broader scope swallowed the narrower, so a Strength check took
// the bard's rounded-down half, and the feature's own guidance told the GM
// that Remarkable Athlete rounds down.
await test("K04: Remarkable Athlete's half proficiency rounds up beside Jack of All Trades, and says so", async () => {
  const both = world.addHero({
    class: "fighter", subclass: "champion", level: 13, abilities: { str: 10, dex: 10, int: 10 },
    classes: [{ id: "fighter", level: 11, subclass: "champion" }, { id: "bard", level: 2, subclass: "" }],
    features: [...klass("fighter", "Remarkable Athlete"), ...klass("bard", "Jack of All Trades")],
    proficiencies: { ...TRAINED },
  });
  // Proficiency +5 at 13th level: the round-up gives 3, the round-down 2.
  assert.equal(resolved(both.id, { kind: "skill_check", skill: "arcana" }).expression, "1d20+2", "the staging: an Intelligence check takes Jack of All Trades' 2");
  assert.equal(resolved(both.id, { kind: "skill_check", skill: "athletics" }).expression, "1d20+3", "an untrained Athletics check takes Remarkable Athlete's 3");
  assert.equal(resolved(both.id, { kind: "ability_check", ability: "str" }).expression, "1d20+3", "a raw Strength check takes 3");
  assert.equal(resolved(both.id, { kind: "initiative" }).expression, "1d20+3", "initiative, a Dexterity check, takes 3");
  const { guidanceFor } = await import("../src/lib/srd/feature-effects.ts");
  const guidance = String(guidanceFor({ class: "fighter", features: [], feature: "Remarkable Athlete" }));
  assert.match(guidance, /Remarkable Athlete: half their proficiency bonus \(rounded up\)/, guidance);
});

// K05. SRD 5.1, Vision and Light: in darkness a creature "effectively
// suffers from the blinded condition when trying to see something in that
// area"; dim light gives disadvantage on Wisdom (Perception) checks that
// rely on sight; darkvision sees dim light as bright and darkness as dim.
// Off the board a check by sight read the place's light; on a battle map it
// read none at all, so a human's Perception by sight in an unlit cave, or in
// a dim hall, rolled as in daylight, and check_notice let them spot things
// in the dark.
await test("K05: on a battle map a check by sight reads the light on the character's square", async () => {
  await kit.endFight();
  const human = world.addHero({ class: "fighter", level: 1, race: "human", abilities: { wis: 10 }, proficiencies: { ...TRAINED } });
  const dwarf = world.addHero({ class: "fighter", level: 1, race: "hill_dwarf", abilities: { wis: 10 }, proficiencies: { ...TRAINED } });
  await kit.fight(1);
  kit.place(human.id, 2, 2);
  kit.place(dwarf.id, 6, 2);
  const look = { kind: "skill_check", skill: "perception", by: "sight" };
  darkBoard();
  const blind = resolved(human.id, look);
  assert.equal(blind.autoFail, true, `a human in an unlit cave sees nothing: ${JSON.stringify(blind)}`);
  assert.equal(resolved(dwarf.id, look).expression, "2d20kl1", "darkvision sees the dark as dim light: disadvantage");
  assert.equal(resolved(human.id, { ...look, by: "hearing" }).expression, "1d20", "a check by ear ignores the light");
  const notice = await world.invoke("check_notice", { characterIds: [human.id, dwarf.id], dc: 5, reason: "a trapdoor" });
  assert.equal(notice.ok, true, notice.error);
  assert.deepEqual(notice.result.noticedBy, [world.sheet(dwarf.id).name], "the human notices nothing in the dark, the dwarf does");
  // A torch in the human's hand lights their square.
  maps.setTokenLight(kit.token(human.id).id, 4);
  clearLitTilesCache();
  assert.equal(resolved(human.id, look).expression, "1d20", "by torchlight the human sees");
  // A dim hall: disadvantage without darkvision, nothing with it.
  getDatabase().prepare(`UPDATE battle_maps SET ambient = 'dim' WHERE id = ?`).run(kit.map().id);
  maps.setTokenLight(kit.token(human.id).id, 0);
  clearLitTilesCache();
  assert.equal(resolved(human.id, look).expression, "2d20kl1", "dim light: disadvantage on Perception by sight");
  assert.equal(resolved(dwarf.id, look).expression, "1d20", "darkvision sees dim light as bright");
  await kit.endFight();
});

world.close();
finish();
