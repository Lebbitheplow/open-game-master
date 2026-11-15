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

world.close();
finish();
