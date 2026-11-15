// Ability checks and saving throws, from the 2026-11-15 rules audit (the
// checks lens, findings K01..). Each test names its finding and the SRD 5.1
// rule it holds the engine to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

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

// K06. SRD 5.1, Gnome Cunning: "advantage on all Intelligence, Wisdom, and
// Charisma saving throws against magic"; Hold Person: "At the end of each of
// its turns, the target can make another Wisdom saving throw." The repeat
// save is a save against the same spell. An enemy's repeat save was told the
// hold was a spell (Magic Resistance kept its advantage); a character's was
// not, so Gnome Cunning, Magic Resistance and the cloaks and robes that ward
// against spells helped with the first save and never with the ones after.
await test("K06: a character's save to end a spell's hold at the end of their turn is a save against magic", async () => {
  await kit.endFight();
  const gnome = world.addHero({
    class: "wizard", level: 3, race: "gnome", abilities: { wis: 10 },
    features: [{ name: "Gnome Cunning", source: "race" }], proficiencies: { ...TRAINED },
  });
  const [enemy] = (await kit.fight(1), world.enemies());
  kit.setEnemy(enemy.id, { stats: { spells: ["Hold Person"], type: "humanoid", abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10 } } });
  enemyHoldsTheFloor();
  const held = await forced([2, 3], () => world.invoke("cast_at_player", { characterId: gnome.id, casterEnemyId: enemy.id, spell: "Hold Person", level: 2, saveAbility: "wis", dc: 13, condition: "paralyzed" }));
  assert.equal(held.ok, true, held.error);
  assert.equal(d20Faces(kit.lastRolls(1)[0]).length, 2, "the staging: Gnome Cunning on the first save");
  assert.ok(world.sheet(gnome.id).conditions.includes("paralyzed"), "the staging: the hold took");
  const { endTurnSaves } = await import("../src/lib/dm/condition-tick.ts");
  await forced([2, 3], () => endTurnSaves(world.campaign(), world.encounter(), [gnome.id]));
  const again = kit.lastRolls(1)[0];
  assert.equal(again.kind, "saving_throw");
  assert.equal(d20Faces(again).length, 2, `Gnome Cunning on the save to end Hold Person: ${again.detail}`);
  await kit.endFight();
});

// K07. SRD 5.1, Paladin, Aura of Protection: "Whenever you or a friendly
// creature within 10 feet of you must make a saving throw, the creature
// gains a bonus to the saving throw equal to your Charisma modifier (with a
// minimum bonus of +1). You must be conscious to grant this bonus." A
// paladin's own steed stands in the aura's heart, and a mount's Dexterity
// save against an area that caught its rider took only its own Dexterity.
await test("K07: a mount's save against an area takes its paladin rider's Aura of Protection", async () => {
  await kit.endFight();
  const { setMount } = await import("../src/lib/db/mounts.ts");
  const rider = world.addHero({ class: "paladin", level: 6, maxHp: 60, abilities: { cha: 16, dex: 10 }, features: klass("paladin", "Aura of Protection"), proficiencies: { ...TRAINED } });
  world.patch(rider.id, { currentHp: 60 });
  await kit.fight(1);
  kit.place(rider.id, 3, 3);
  setMount(world.campaignId, rider.id, { ref: "warhorse", name: "Warhorse", speed: 60, controlled: true, size: "large", ac: 11, hp: 19, maxHp: 19 });
  const blast = await forced([3, 3, 3, 3, 10, 10], () => world.invoke("aoe_damage", { characterIds: [rider.id], saveAbility: "dex", dc: 15, damage: "4d6", damageType: "fire", halfOnSave: true, reason: "a fire trap" }));
  assert.equal(blast.ok, true, blast.error);
  const horse = kit.lastRolls(20).find((roll) => /^Warhorse: DEX save/.test(roll.detail ?? ""));
  assert.ok(horse, `the staging: the warhorse saved: ${JSON.stringify(blast.result).slice(0, 300)}`);
  assert.equal(horse.total, 10 + 1 + 3, `the warhorse's save: 10 on the die, DEX +1, the aura +3: ${horse.total}`);
  setMount(world.campaignId, rider.id, null);
  await kit.endFight();
});

// K08. SRD 5.1, Vision and Light (as K05): the light decides a check that
// relies on sight, and the engine reads it only when the call names the
// sense (`by`). The model is asked for a field a trait reads before the dice
// roll; it was never asked for this one, so in dim light or in the dark a
// Perception check that named no sense rolled as in daylight.
await test("K08: a Perception check in the dark that names no sense is asked for it before anything is rolled", async () => {
  await kit.endFight();
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
  const ai = (name, args, actor) => {
    world.say("player", "I look around.", actor);
    const turn = createDmTurn(world.campaignId, []);
    const sheets = world.sheets();
    return dispatchAdjudication(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() });
  };
  const human = world.addHero({ class: "fighter", level: 1, race: "human", abilities: { wis: 10 }, proficiencies: { ...TRAINED } });
  await kit.fight(1);
  kit.place(human.id, 2, 2);
  darkBoard();
  const look = { kind: "skill_check", characterId: human.id, skill: "perception", difficulty: "moderate", reason: "anything moving?" };
  const asked = await ai("request_roll", look, human);
  assert.equal(asked.retry, true, `rolled in the dark without asking: ${JSON.stringify(asked).slice(0, 200)}`);
  assert.match(asked.error, /by: sight, hearing, or 'none'/, asked.error);
  const grouped = await ai("group_check", { skill: "perception", characterIds: [human.id], difficulty: "moderate", reason: "a sweep of the room" }, human);
  assert.equal(grouped.retry, true, "the group check asks too");
  const bySight = await ai("request_roll", { ...look, by: "sight" }, human);
  assert.equal(bySight.ok, true, bySight.error);
  assert.equal(bySight.autoFailed, true, "by sight in the dark the check fails");
  const byEar = await forced([12], () => ai("request_roll", { ...look, by: "hearing" }, human));
  assert.equal(byEar.ok, true, byEar.error);
  assert.notEqual(byEar.autoFailed, true, "by ear the light decides nothing");
  // In bright light nothing is asked.
  getDatabase().prepare(`UPDATE battle_maps SET ambient = 'bright' WHERE id = ?`).run(kit.map().id);
  clearLitTilesCache();
  const lit = await forced([12], () => ai("request_roll", look, human));
  assert.equal(lit.ok, true, `asked in bright light: ${lit.error}`);
  await kit.endFight();
});

// K09. SRD 5.1, Contests: "If the contest results in a tie, the situation
// remains the same as it was before the contest." A creature hidden stays
// hidden when the watcher's Perception only ties its Stealth, on every door:
// the Hide action and the ambush already read it so, while check_notice and
// a contested request_roll gave the tie to the watcher, so the same 15
// against a passive 15 was hidden on one door and spotted on the other. A
// fixed DC (a trap, a clue) is met, as before.
await test("K09: a Stealth total that ties the watcher's Perception stays hidden, on check_notice and a contested roll alike", async () => {
  await kit.endFight();
  // Passive Perception 15: WIS +3, proficiency +2.
  const lookout = world.addHero({ class: "ranger", level: 1, abilities: { wis: 16, dex: 10 }, proficiencies: { ...TRAINED, skills: ["perception", "stealth"] } });
  const [enemy] = (await kit.fight(1), world.enemies());
  kit.setEnemy(enemy.id, { stats: { skills: { stealth: 6, perception: 4 } } });
  // The goblin rolls 9: Stealth 15, a tie with the passive 15.
  const tied = await forced([9], () => world.invoke("check_notice", { characterIds: [lookout.id], againstEnemyId: enemy.id, reason: "a goblin in the brush" }));
  assert.equal(tied.ok, true, tied.error);
  assert.deepEqual(tied.result.noticedBy, [], `a tie keeps the goblin hidden: ${JSON.stringify(tied.result)}`);
  assert.equal(tied.result.dc, 16);
  assert.match(String(tied.result.contest), /tie/, tied.result.contest);
  // A Search by request_roll: the goblin's 15 against the lookout's 10 + 5.
  const search = await forced([9, 10], () => world.invoke("request_roll", { characterId: lookout.id, kind: "skill_check", skill: "perception", againstEnemyId: enemy.id, reason: "is the goblin still there?" }));
  assert.equal(search.ok, true, search.error);
  assert.equal(search.result.dc, 16, "an active search must beat the hider's Stealth");
  assert.equal(search.result.success, false, "15 against a hider's 15 finds nothing");
  // The other way round: the lookout sneaks past the goblin, whose
  // Perception rolls 11 + 4 = 15; their Stealth 15 ties it and stays unseen.
  const sneak = await forced([11, 13], () => world.invoke("request_roll", { characterId: lookout.id, kind: "skill_check", skill: "stealth", againstEnemyId: enemy.id, reason: "past the goblin" }));
  assert.equal(sneak.ok, true, sneak.error);
  assert.equal(sneak.result.dc, 15, "a sneak that ties the watcher's Perception stays hidden");
  assert.equal(sneak.result.success, true);
  // A fixed DC is met: passive 15 against DC 15 notices it.
  const trap = await world.invoke("check_notice", { characterIds: [lookout.id], dc: 15, reason: "a tripwire" });
  assert.equal(trap.result.noticedBy.length, 1, "a passive score that meets a trap's DC notices it");
  await kit.endFight();
});

// K10. SRD 5.1, Gloves of Thievery: "you gain a +5 bonus to Dexterity
// (Sleight of Hand) checks and Dexterity checks made to pick locks." Only
// the Sleight of Hand half was applied: a thieves' tools check to pick a
// lock rolled without the gloves. A check names a lock with about 'locks'
// (a trap's disarm is about 'traps', and takes nothing), the AI GM is asked
// for it before a gloved character's Dexterity check is rolled, and the
// shared check door (contest-roll.ts rollCharacterCheck) carries the tool.
await test("K10: Gloves of Thievery add +5 to a Dexterity check to pick a lock, never to disarming a trap", async () => {
  await kit.endFight();
  const picker = world.addHero({
    class: "fighter", level: 1, abilities: { dex: 14 },
    proficiencies: { ...TRAINED, tools: ["thieves' tools"] },
    equipment: [{ name: "Gloves of Thievery", qty: 1, equipped: true }],
  });
  const tools = { kind: "ability_check", ability: "dex", tool: "thieves' tools" };
  // DEX +2 and proficiency +2 with the tools.
  assert.equal(resolved(picker.id, { ...tools, about: "traps" }).expression, "1d20+4", "a trap's disarm takes no lock bonus");
  assert.equal(resolved(picker.id, tools).expression, "1d20+4", "a check that names no lock takes none");
  assert.equal(resolved(picker.id, { ...tools, about: "locks" }).expression, "1d20+9", "picking a lock takes the gloves' +5");
  assert.equal(resolved(picker.id, { kind: "ability_check", ability: "str", about: "locks" }).expression, "1d20", "a Strength check on a lock is not a Dexterity check");
  assert.equal(resolved(picker.id, { kind: "skill_check", skill: "sleight_of_hand", about: "locks" }).expression, "1d20+7", "Sleight of Hand to pick a lock takes the +5 once");
  // The AI GM is asked what a gloved character's Dexterity check is for.
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
  world.say("player", "I work the lock.", picker);
  const sheets = world.sheets();
  const asked = await dispatchAdjudication("request_roll", JSON.stringify({ ...tools, characterId: picker.id, difficulty: "moderate", reason: "the cell door" }), {
    campaign: world.campaign(), turn: createDmTurn(world.campaignId, []), sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set(),
  });
  assert.equal(asked.retry, true, `rolled without asking: ${JSON.stringify(asked).slice(0, 200)}`);
  assert.match(asked.error, /about: locks, or 'none'/, asked.error);
  // The shared check door: the tool's proficiency and the gloves on a lock.
  const { rollCharacterCheck } = await import("../src/lib/dm/contest-roll.ts");
  const pick = await forced([10], () => rollCharacterCheck(world.campaign(), world.sheet(picker.id), { ability: "dex", tool: "thieves' tools", about: "locks", dc: 15 }, "manacles"));
  assert.equal(pick.total, 10 + 9, `rollCharacterCheck picks the lock with the tools and the gloves: ${JSON.stringify(pick)}`);
});

world.close();
finish();
