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

world.close();
finish();
