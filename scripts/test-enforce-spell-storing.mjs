// A Ring of Spell Storing, as the engines hold it.
//
// SRD 5.1, Ring of Spell Storing: "any creature can cast a spell of 1st through
// 5th level into the ring by touching the ring as the spell is cast. The spell
// has no effect, other than to be stored in the ring." The ring holds five
// levels, and "the level of the slot used to cast the spell determines how much
// space it uses". While wearing it "you can cast any spell stored in it", with
// the original caster's slot level, save DC and attack bonus, and the spell is
// then "no longer stored in it, freeing up space".
//
// ODM's own rules, pinned where the SRD is silent or they differ: a spell that
// does not fit is refused with nothing spent, where the SRD expends it; a
// reaction spell cast into the ring takes the caster's action, having no
// trigger to answer; a caster with no sheet here (storedBy) gives a stored spell
// a spell scroll's numbers and no ability modifier.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearDice, dice, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fightDummies, wizard } from "./lib/enforce-spells.mjs";
import { handOnDue } from "./lib/enforce-zones.mjs";
import { nextTurn } from "./lib/enforce-spell-tail.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { board, place, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-spell-storing");
const { magicItemLine } = await import("../src/lib/dm/item-summary.ts");
const { unpaidCastPrompt, storedCastHint } = await import("../src/lib/dm/slotless-cast-logic.ts");

const RING = "Ring of Spell Storing";
const ring = (extra = {}) => ({ name: RING, qty: 1, equipped: true, attuned: true, ...extra });
const worlds = [];
const { completedCastingOf } = await import("../src/lib/dm/long-casting-logic.ts");

// A wizard and a fighter at one table, the wizard first in any fight.
async function table({ fight = false, fighterRing = ring(), mageRing = null } = {}) {
  const world = await openWorld();
  worlds.push(world);
  const mage = world.addHero(wizard(9, { name: "Mage", equipment: mageRing ? [mageRing] : [] }));
  const fighter = world.addHero({ class: "fighter", level: 5, name: "Brute", equipment: fighterRing ? [fighterRing] : [] });
  const enemies = fight ? await fightDummies(world, 1, { heroFaces: { [fighter.id]: 20, [mage.id]: 2 } }) : [];
  return { world, mage, fighter, enemy: enemies[0] };
}
const held = (world, hero) => world.sheet(hero.id).equipment.find((item) => item.name === RING)?.storedSpells ?? [];
const used = (world, hero, level) => world.sheet(hero.id).spellcasting.slots[String(level)].used;

await test("A wizard's spell cast into a fighter's ring spends the wizard's slot, has no effect, and keeps the wizard's numbers", async () => {
  const { world, mage, fighter } = await table();
  const out = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Hold Person", level: 3, storeIn: RING, storeInCharacterId: fighter.id });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(used(world, mage, 3), 1);
  // Hold Person holds concentration when it is cast; stored, it does not yet.
  assert.ok(!world.sheet(mage.id).concentratingOn, "storing a spell holds no concentration");
  const [entry] = held(world, fighter);
  assert.equal(entry.spell, "Hold Person");
  assert.equal(entry.level, 3, "the slot used is the space it takes");
  const dc = 8 + 4 + 3;
  assert.equal(entry.saveDc, dc);
  assert.equal(entry.attackBonus, dc - 8);
});

await test("A fighter with no spells casts it from the ring: no slot, the wizard's DC, and the space comes back", async () => {
  const { world, fighter, enemy } = await table({ fight: true });
  world.patch(fighter.id, { equipment: [ring({ storedSpells: [{ spell: "Hold Person", level: 2, saveDc: 19, attackBonus: 11, by: "Mage" }] })] });
  const before = world.sheet(fighter.id).spellcasting;
  const out = await world.invoke("use_item", { characterId: fighter.id, item: RING, spell: "Hold Person" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.result?.spellCast ?? out.spellCast, "Hold Person");
  assert.equal(held(world, fighter).length, 1, "it leaves the ring when it is cast, not before");
  const cast = await world.invoke("cast_at_enemy", { characterId: fighter.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  assert.equal(cast.ok, true, JSON.stringify(cast));
  assert.match(JSON.stringify(cast), /"(saveDc|dc)":19/, "the original caster's DC");
  assert.deepEqual(world.sheet(fighter.id).spellcasting, before, "the fighter's sheet spends no slot");
  assert.deepEqual(held(world, fighter), [], "cast, it is no longer stored");
  // The credit is one cast: a second is refused as any fighter's would be.
  const again = await world.invoke("cast_at_enemy", { characterId: fighter.id, targetEnemyId: enemy.id, spell: "Hold Person", saveAbility: "wis", level: 2 });
  assert.equal(again.ok, false);
});

await test("Every spell tool takes a stored spell from a fighter with no spells: an attack, an area, a heal, a buff, and a utility spell", async () => {
  const stored = (spell, level) => ({ spell, level, saveDc: 19, attackBonus: 11 });
  const cases = [
    ["pc_attack", "Scorching Ray", 2, (hero, enemy) => ({ characterId: hero.id, attacks: [{ targetEnemyId: enemy.id, spell: "Scorching Ray" }] })],
    ["aoe_damage", "Burning Hands", 1, (hero, enemy) => ({ damage: "3d6", saveAbility: "dex", enemyIds: [enemy.id], casterCharacterId: hero.id, spell: "Burning Hands", level: 1 })],
    ["heal", "Cure Wounds", 1, (hero) => ({ characterId: hero.id, casterId: hero.id, spell: "Cure Wounds" })],
    ["cast_buff", "Blur", 2, (hero) => ({ characterId: hero.id, spell: "Blur" })],
    ["cast_buff", "Polymorph", 4, (hero, enemy) => ({ characterId: hero.id, spell: "Polymorph", targetEnemyId: enemy.id, variant: "wolf" })],
    ["use_spell_slot", "Knock", 2, (hero) => ({ characterId: hero.id, spell: "Knock" })],
  ];
  for (const [tool, spell, level, args] of cases) {
    const { world, fighter, enemy } = await table({ fight: true, fighterRing: ring({ storedSpells: [stored(spell, level)] }) });
    world.patch(fighter.id, { currentHp: 20 });
    const out = await world.invoke("use_item", { characterId: fighter.id, item: RING, spell });
    assert.equal(out.ok, true, `${spell}: ${JSON.stringify(out)}`);
    const cast = await world.invoke(tool, args(world.sheet(fighter.id), enemy));
    assert.notEqual(cast.ok, false, `${tool} ${spell}: ${JSON.stringify(cast)}`);
  }
});

await test("A fighter's wand casts through the same door: the charge pays and no Spellcasting feature is asked", async () => {
  const { world, fighter, enemy } = await table({ fight: true, fighterRing: { name: "Wand of Magic Missiles", qty: 1, charges: 3 } });
  const out = await world.invoke("use_item", { characterId: fighter.id, item: "Wand of Magic Missiles", spell: "Magic Missile" });
  assert.equal(out.ok, true, JSON.stringify(out));
  const cast = await world.invoke("cast_at_enemy", { characterId: fighter.id, targetEnemyId: enemy.id, spell: "Magic Missile" });
  assert.notEqual(cast.ok, false, JSON.stringify(cast));
});

await test("A wizard casting a stored spell spends no slot of their own, even one they could have spent", async () => {
  const stored = [{ spell: "Magic Missile", level: 1, saveDc: 15, attackBonus: 7 }];
  const { world, mage } = await table({ fighterRing: null, mageRing: ring({ storedSpells: stored }) });
  const out = await world.invoke("use_item", { characterId: mage.id, item: RING, spell: "Magic Missile" });
  assert.equal(out.ok, true, JSON.stringify(out));
  const cast = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Magic Missile" });
  assert.equal(cast.ok, true, JSON.stringify(cast));
  assert.equal(used(world, mage, 1), 0);
  // With the ring empty, the same spell is a real cast again.
  await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Magic Missile" });
  assert.equal(used(world, mage, 1), 1);
});

await test("The ring holds five levels by the slot used: what does not fit is refused and nothing is spent", async () => {
  const { world, mage, fighter } = await table({ fighterRing: ring({ storedSpells: [{ spell: "Fireball", level: 3 }] }) });
  const out = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Fireball", level: 3, storeIn: RING, storeInCharacterId: fighter.id });
  assert.equal(out.ok, false);
  assert.match(out.error, /2 of 5 levels free/);
  assert.equal(used(world, mage, 3), 0);
  const fits = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Magic Missile", level: 2, storeIn: RING, storeInCharacterId: fighter.id });
  assert.equal(fits.ok, true, JSON.stringify(fits));
  assert.equal(held(world, fighter).length, 2);
});

await test("Only 1st through 5th level spells cast with a real casting go in: a cantrip, a spell above 5th and a non-caster are refused", async () => {
  const { world, mage, fighter } = await table();
  const cantrip = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Fire Bolt", storeIn: RING, storeInCharacterId: fighter.id });
  assert.match(cantrip.error, /cantrip/);
  const high = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Magic Missile", level: 5, storeIn: RING, storeInCharacterId: fighter.id });
  assert.equal(high.ok, true, "a 5th level slot fits");
  world.patch(fighter.id, { equipment: [ring()] });
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, known: [], prepared: ["Heal"] } });
  const six = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Heal", storeIn: RING, storeInCharacterId: fighter.id });
  assert.equal(six.ok, false, "a 6th level spell does not go in");
  const noSpells = await world.invoke("use_spell_slot", { characterId: fighter.id, spell: "Magic Missile", storeIn: RING });
  assert.equal(noSpells.ok, false);
  assert.deepEqual(held(world, fighter), []);
});

await test("A ring found holding spells, or filled by an NPC, spends nothing of the party's and takes a scroll's numbers", async () => {
  const { world, fighter } = await table();
  const out = await world.invoke("use_spell_slot", { characterId: fighter.id, spell: "Fireball", storeIn: RING, storedBy: "the ring's last owner" });
  assert.equal(out.ok, true, JSON.stringify(out));
  const [entry] = held(world, fighter);
  assert.deepEqual([entry.level, entry.saveDc, entry.attackBonus, entry.by], [3, 15, 7, "the ring's last owner"]);
  const low = await world.invoke("use_spell_slot", { characterId: fighter.id, spell: "Fireball", level: 2, storeIn: RING, storedBy: "a mage" });
  assert.equal(low.ok, false, "below the spell's own level");
});

await test("Releasing asks what any use of the ring asks: attuned, worn, awake, and which spell", async () => {
  const two = [{ spell: "Magic Missile", level: 1 }, { spell: "Fireball", level: 3 }];
  const { world, fighter } = await table();
  const use = (args = {}) => world.invoke("use_item", { characterId: fighter.id, item: RING, ...args });
  world.patch(fighter.id, { equipment: [ring({ attuned: false, storedSpells: two })] });
  assert.match((await use({ spell: "Fireball" })).error, /attuned/);
  world.patch(fighter.id, { equipment: [ring({ equipped: false, storedSpells: two }), { name: "Chain Mail", qty: 1, equipped: true }] });
  assert.match((await use({ spell: "Fireball" })).error, /worn/);
  world.patch(fighter.id, { equipment: [ring({ storedSpells: two })] });
  assert.match((await use()).error, /name the one cast/);
  assert.match((await use({ spell: "Haste" })).error, /not Haste/);
  world.patch(fighter.id, { equipment: [ring()] });
  assert.match((await use()).error, /holds no spells/);
  world.patch(fighter.id, { equipment: [ring({ storedSpells: two })], currentHp: 0 });
  assert.match((await use({ spell: "Fireball" })).error, /unconscious/);
  assert.equal(held(world, fighter).length, 2, "nothing left the ring");
});

await test("In a fight a release takes the turn: the action, a bonus action for a bonus action spell, and nothing off their turn", async () => {
  const { world, mage, fighter } = await table({ fight: true });
  world.patch(fighter.id, { equipment: [ring({ storedSpells: [{ spell: "Misty Step", level: 2 }, { spell: "Magic Missile", level: 1 }] })] });
  world.patch(mage.id, { equipment: [ring({ storedSpells: [{ spell: "Magic Missile", level: 1 }] })] });
  const offTurn = await world.invoke("use_item", { characterId: mage.id, item: RING });
  assert.equal(offTurn.ok, false, "the fighter's turn, not the wizard's");
  const bonus = await world.invoke("use_item", { characterId: fighter.id, item: RING, spell: "Misty Step" });
  assert.equal(bonus.ok, true, JSON.stringify(bonus));
  const action = await world.invoke("use_item", { characterId: fighter.id, item: RING, spell: "Magic Missile" });
  assert.equal(action.ok, true, "the action is still there after a bonus action");
});

await test("A stored spell goes where the ring goes", async () => {
  const stored = [{ spell: "Fireball", level: 3, saveDc: 15, attackBonus: 7 }];
  const { world, mage, fighter } = await table({ fighterRing: ring({ storedSpells: stored }) });
  const out = await world.invoke("handle_item", { characterId: fighter.id, item: RING, action: "hand", toCharacterId: mage.id });
  assert.notEqual(out.ok, false, JSON.stringify(out));
  assert.deepEqual(held(world, mage).map((entry) => entry.spell), ["Fireball"]);
});

await test("A reaction spell goes in with the caster's action, and comes out with the wearer's reaction when its trigger happens", async () => {
  const { world, mage, fighter } = await table({ fight: true });
  // The wizard acts second: its turn comes after the fighter's, so the fighter
  // ends its turn and the wizard stores on its own.
  await world.nextTurn?.();
  world.patch(fighter.id, { acOverride: false, equipment: [ring({ storedSpells: [{ spell: "Shield", level: 1, saveDc: 15, attackBonus: 7 }] })] });
  const ac = world.sheet(fighter.id).ac;
  const unprompted = await world.invoke("use_reaction", { characterId: fighter.id, feature: "Shield" });
  assert.equal(unprompted.ok, false, "with no credit from the ring, a fighter has no Shield");
  const drawn = await world.invoke("use_item", { characterId: fighter.id, item: RING, spell: "Shield" });
  assert.equal(drawn.ok, true, JSON.stringify(drawn));
  assert.match(drawn.note ?? drawn.result?.note ?? "", /use_reaction/);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "drawing a reaction spell takes no action");
  assert.equal(held(world, fighter).length, 1, "with no trigger yet it stays in the ring");
  await world.hitBy(fighter.id);
  const cast = await world.invoke("use_reaction", { characterId: fighter.id, feature: "Shield" });
  assert.equal(cast.ok, true, JSON.stringify(cast));
  assert.equal(world.sheet(fighter.id).ac, ac + 5);
  assert.deepEqual(held(world, fighter), [], "cast, it leaves the ring");
  assert.ok(world.encounter().reactionsUsed.includes(fighter.id), "it spent the reaction");
  assert.ok(mage, "the wizard sat at the table");
});

await test("Storing a reaction spell in a fight takes the action and leaves the reaction", async () => {
  const world = await openWorld();
  worlds.push(world);
  const mage = world.addHero(wizard(9, { name: "Mage", equipment: [ring()] }));
  await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
  const out = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Shield", storeIn: RING });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(used(world, mage, 1), 1);
  assert.equal(world.encounter().turnBudget?.actionUsed, true, "it took the action");
  assert.ok(!world.encounter().reactionsUsed.includes(mage.id), "the reaction is left");
  assert.equal(held(world, mage)[0].spell, "Shield");
});

await test("A spell cast at nothing that refuses keeps its place: a release the spell's tool refused has not left the ring", async () => {
  const { world, fighter } = await table({ fighterRing: ring({ storedSpells: [{ spell: "Knock", level: 2 }] }) });
  const drawn = await world.invoke("use_item", { characterId: fighter.id, item: RING });
  assert.equal(drawn.ok, true, JSON.stringify(drawn));
  const twice = await world.invoke("use_item", { characterId: fighter.id, item: RING });
  assert.equal(twice.ok, true, "a second draw pays for nothing new");
  assert.equal(held(world, fighter).length, 1);
  const cast = await world.invoke("use_spell_slot", { characterId: fighter.id, spell: "Knock" });
  assert.equal(cast.ok, true, JSON.stringify(cast));
  assert.deepEqual(held(world, fighter), []);
});

// Alarm takes a minute and asks no costly material. A minute is ten rounds; the
// hero is alone in the order, so each of these is one round (SRD 5.1, Longer
// Casting Times; test-enforce-srd-spells).
const alarmMage = (extra = {}) => wizard(9, { name: "Mage", ...extra, spellcasting: { prepared: ["Alarm", "Shield"] } });
const nextRound = (world) => {
  nextTurn(world);
  handOnDue(world);
};
const payload = (out) => out.result ?? out;

await test("A spell of a minute goes into the ring out of a fight at once, and the clock moves", async () => {
  const world = await openWorld();
  worlds.push(world);
  const mage = world.addHero(alarmMage({ equipment: [ring()] }));
  const before = world.campaign().gameMinutes ?? null;
  const out = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Alarm", storeIn: RING });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(held(world, mage)[0].spell, "Alarm");
  assert.equal(used(world, mage, 1), 1);
  assert.match(String(payload(out).castingTime), /1 minute/, "the clock moved");
  assert.ok(before === null || world.campaign().gameMinutes !== before);
});

await test("In a fight a spell of a minute going in is held across the caster's turns: no slot until it is done, then it is stored, not cast", async () => {
  const world = await openWorld();
  worlds.push(world);
  const mage = world.addHero(alarmMage({ equipment: [ring()] }));
  await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
  const begun = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Alarm", storeIn: RING });
  assert.equal(begun.ok, true, JSON.stringify(begun));
  assert.match(String(payload(begun).casting), /10 rounds/);
  assert.equal(used(world, mage, 1), 0, "no slot as the casting begins");
  assert.deepEqual(held(world, mage), []);
  for (let round = 1; round < 10; round += 1) {
    nextRound(world);
    assert.equal(used(world, mage, 1), 0, `the slot was spent ${round} rounds in`);
    assert.deepEqual(held(world, mage), []);
  }
  nextRound(world);
  assert.equal(used(world, mage, 1), 1, "the slot is spent as it completes");
  assert.equal(held(world, mage)[0]?.spell, "Alarm");
  assert.equal(world.sheet(mage.id).concentratingOn ?? null, null, "nothing left to concentrate on");
  assert.equal(completedCastingOf(world.sheet(mage.id), "Alarm"), null, "no mark left behind");
});

await test("A casting into the ring that is broken stores nothing and spends no slot", async () => {
  const world = await openWorld();
  worlds.push(world);
  const mage = world.addHero(alarmMage({ equipment: [ring()] }));
  await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
  await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Alarm", storeIn: RING });
  world.patch(mage.id, { concentratingOn: null });
  for (let round = 1; round <= 10; round += 1) {
    nextRound(world);
  }
  assert.equal(used(world, mage, 1), 0);
  assert.deepEqual(held(world, mage), []);
});

await test("In a fight a spell of a minute coming out is held across the wearer's turns, spends no slot, and leaves the ring when it takes effect", async () => {
  const world = await openWorld();
  worlds.push(world);
  const fighter = world.addHero({ class: "fighter", level: 5, name: "Brute", equipment: [ring({ storedSpells: [{ spell: "Alarm", level: 1, saveDc: 15, attackBonus: 7 }] })] });
  await fightDummies(world, 1, { heroFaces: { [fighter.id]: 20 } });
  const begun = await world.invoke("use_item", { characterId: fighter.id, item: RING, spell: "Alarm" });
  assert.equal(begun.ok, true, JSON.stringify(begun));
  assert.match(String(payload(begun).casting), /10 rounds/);
  assert.doesNotMatch(String(payload(begun).casting), /level \d+ slot/, "no slot is promised to be spent");
  for (let round = 1; round < 10; round += 1) {
    nextRound(world);
    assert.equal(held(world, fighter).length, 1, `it left the ring ${round} rounds in`);
  }
  nextRound(world);
  assert.deepEqual(held(world, fighter), [], "it took effect, so it left the ring");
  assert.equal(completedCastingOf(world.sheet(fighter.id), "Alarm"), null, "no mark left behind");
});

await test("A stored healing spell adds its original caster's modifier, not the wearer's", async () => {
  const { world, fighter } = await table({ fighterRing: ring({ storedSpells: [{ spell: "Cure Wounds", level: 1, saveDc: 19, attackBonus: 11, abilityMod: 5 }] }) });
  world.patch(fighter.id, { currentHp: 1 });
  await world.invoke("use_item", { characterId: fighter.id, item: RING, spell: "Cure Wounds" });
  dice(3);
  const out = await world.invoke("heal", { characterId: fighter.id, casterId: fighter.id, spell: "Cure Wounds" });
  clearDice();
  assert.notEqual(out.ok, false, JSON.stringify(out));
  // A 3 on the d8 and the modifier of 5, never the 8 a fighter's proficiency
  // would make of a save DC of 19.
  assert.equal(world.sheet(fighter.id).currentHp - 1, 8, JSON.stringify(out));
});

// ---- what a stored spell does after its first cast ----

// Past the minute a used credit lends its numbers, and the five a waiting one
// lasts, so only what the sheet keeps can answer.
const realNow = Date.now;
async function laterOn(run) {
  Date.now = () => realNow() + 10 * 60 * 1000;
  try {
    return await run();
  } finally {
    Date.now = realNow;
  }
}
const stored = (spell, level) => ring({ storedSpells: [{ spell, level, saveDc: 19, attackBonus: 11, abilityMod: 5, by: "Mage" }] });
const lightning = (hero, enemy) => ({ characterId: hero.id, targetEnemyId: enemy.id, spell: "Call Lightning", saveAbility: "dex" });

async function alone(hero) {
  const world = await openWorld();
  worlds.push(world);
  const sheet = world.addHero(hero);
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [sheet.id]: 20 } });
  return { world, sheet, enemy };
}

await test("A fighter's stored Call Lightning keeps calling bolts: no Spellcasting feature asked, the stored DC, and the level it was stored at", async () => {
  const { world, sheet, enemy } = await alone({ class: "fighter", level: 5, name: "Brute", equipment: [stored("Call Lightning", 5)] });
  await world.invoke("use_item", { characterId: sheet.id, item: RING, spell: "Call Lightning" });
  const first = payload(await world.invoke("cast_at_enemy", lightning(sheet, enemy)));
  assert.equal(first.dc, 19, JSON.stringify(first));
  nextRound(world);
  const next = await laterOn(() => world.invoke("cast_at_enemy", lightning(sheet, enemy)));
  assert.notEqual(next.ok, false, JSON.stringify(next));
  assert.equal(payload(next).dc, 19, JSON.stringify(next));
  assert.match(String(payload(next).repeat), /no slot is spent/);
  assert.match(String(payload(next).scaling), /level 5/, JSON.stringify(next));
});

await test("When the spell ends its numbers end: a fighter whose concentration broke calls no more bolts", async () => {
  const { world, sheet, enemy } = await alone({ class: "fighter", level: 5, name: "Brute", equipment: [stored("Call Lightning", 3)] });
  await world.invoke("use_item", { characterId: sheet.id, item: RING, spell: "Call Lightning" });
  await world.invoke("cast_at_enemy", lightning(sheet, enemy));
  world.patch(sheet.id, { concentratingOn: null });
  nextRound(world);
  const next = await laterOn(() => world.invoke("cast_at_enemy", lightning(sheet, enemy)));
  assert.equal(next.ok, false, JSON.stringify(next));
});

await test("A wizard's next bolt from the ring keeps the stored DC, and a later casting from their own slot is theirs again", async () => {
  const { world, sheet, enemy } = await alone(wizard(5, { name: "Mage", equipment: [stored("Call Lightning", 3)], spellcasting: { prepared: ["Call Lightning"] } }));
  await world.invoke("use_item", { characterId: sheet.id, item: RING, spell: "Call Lightning" });
  await world.invoke("cast_at_enemy", lightning(sheet, enemy));
  nextRound(world);
  const next = await laterOn(() => world.invoke("cast_at_enemy", lightning(sheet, enemy)));
  assert.equal(payload(next).dc, 19, JSON.stringify(next));
  assert.equal(used(world, sheet, 3), 0);
  world.patch(sheet.id, { concentratingOn: null });
  nextRound(world);
  const own = await laterOn(() => world.invoke("cast_at_enemy", lightning(sheet, enemy)));
  assert.notEqual(own.ok, false, JSON.stringify(own));
  assert.equal(used(world, sheet, 3), 1, "a new casting spends their slot");
  assert.equal(payload(own).dc, 14, JSON.stringify(own));
  nextRound(world);
  const after = await laterOn(() => world.invoke("cast_at_enemy", lightning(sheet, enemy)));
  assert.equal(payload(after).dc, 14, "the ring's numbers did not come back");
});

await test("A fighter's stored Moonbeam comes again on later turns with the stored DC", async () => {
  const { world, sheet, enemy } = await alone({ class: "fighter", level: 5, name: "Brute", equipment: [stored("Moonbeam", 2)] });
  const beam = { characterId: sheet.id, targetEnemyId: enemy.id, spell: "Moonbeam", saveAbility: "con" };
  await world.invoke("use_item", { characterId: sheet.id, item: RING, spell: "Moonbeam" });
  const first = await world.invoke("cast_at_enemy", beam);
  assert.equal(payload(first).dc, 19, JSON.stringify(first));
  nextRound(world);
  const next = await laterOn(() => world.invoke("cast_at_enemy", beam));
  assert.notEqual(next.ok, false, JSON.stringify(next));
  assert.equal(payload(next).dc, 19, JSON.stringify(next));
});

await test("A fighter's stored Spiritual Weapon strikes with the stored attack bonus and modifier, at the level it was stored at", async () => {
  const { world, sheet, enemy } = await alone({ class: "fighter", level: 5, name: "Brute", equipment: [stored("Spiritual Weapon", 4)] });
  const kit = await combatKit(world);
  await world.invoke("use_item", { characterId: sheet.id, item: RING, spell: "Spiritual Weapon" });
  const cast = await world.invoke("cast_buff", { characterId: sheet.id, spell: "Spiritual Weapon" });
  assert.notEqual(cast.ok, false, JSON.stringify(cast));
  nextRound(world);
  // Level 4 is 2d8: a 3 and a 3, and the stored modifier of 5.
  const swing = await laterOn(() => kit.swing(sheet.id, enemy.id, [15, 3, 3], { weapon: "Spiritual Weapon" }));
  assert.equal(swing.ok, true, JSON.stringify(swing));
  assert.equal(swing.result.weapon, "Spiritual Weapon", JSON.stringify(swing));
  assert.equal(swing.result.damage, 11, JSON.stringify(swing));
  assert.equal(swing.result.rolled, 26, "15 on the die and the stored +11");
});

await test("A stored area spell is laid on the board like any other cast, and one out of reach stays in the ring", async () => {
  const { world, sheets: [hero] } = await board(
    [{ class: "fighter", level: 5, name: "Brute", equipment: [stored("Web", 2)] }],
    { 0: { x: 2, y: 8 }, e0: { x: 10, y: 4 } },
  );
  worlds.push(world);
  const before = zonesOf(world).length;
  await world.invoke("use_item", { characterId: hero.id, item: RING, spell: "Web" });
  const far = await world.invoke("use_spell_slot", { characterId: hero.id, spell: "Web", atX: 16, atY: 8 });
  assert.equal(far.ok, false, JSON.stringify(far));
  assert.equal(held(world, hero).length, 1, "a refused square loses nothing");
  const cast = await world.invoke("use_spell_slot", { characterId: hero.id, spell: "Web", atX: 6, atY: 8 });
  assert.equal(cast.ok, true, JSON.stringify(cast));
  assert.equal(zonesOf(world).length, before + 1, "the web is on the board");
  assert.deepEqual(held(world, hero), []);
});

await test("A caster must touch someone else's ring: on a mapped fight it must be beside them, and nothing is spent until it is", async () => {
  const { world, sheets: [mage, fighter] } = await board(
    [wizard(9, { name: "Mage" }), { class: "fighter", level: 5, name: "Brute", equipment: [ring()] }],
    { 0: { x: 2, y: 8 }, 1: { x: 9, y: 8 }, e0: { x: 18, y: 4 } },
  );
  worlds.push(world);
  const asked = { characterId: mage.id, spell: "Magic Missile", storeIn: RING, storeInCharacterId: fighter.id };
  const far = await world.invoke("use_spell_slot", asked);
  assert.equal(far.ok, false, JSON.stringify(far));
  assert.match(far.error, /must touch/);
  assert.equal(used(world, mage, 1), 0);
  assert.deepEqual(held(world, fighter), []);
  place(world, mage.id, 8, 8);
  const near = await world.invoke("use_spell_slot", asked);
  assert.equal(near.ok, true, JSON.stringify(near));
  assert.equal(held(world, fighter)[0].spell, "Magic Missile");
});

await test("Two rings on one row split as one takes a spell: each keeps its own, and the other is in the pack unattuned", async () => {
  const { world, mage, fighter } = await table({ fighterRing: ring({ qty: 2 }) });
  const first = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Fireball", level: 3, storeIn: RING, storeInCharacterId: fighter.id });
  assert.equal(first.ok, true, JSON.stringify(first));
  const [one, other] = world.sheet(fighter.id).equipment.filter((item) => item.name.startsWith(RING));
  assert.deepEqual([one.name, one.qty, one.equipped, one.attuned], [RING, 1, true, true]);
  assert.deepEqual(one.storedSpells.map((entry) => entry.spell), ["Fireball"]);
  assert.deepEqual([other.name, other.qty, other.equipped ?? false, other.attuned ?? false, other.storedSpells ?? null], [`${RING} (2)`, 1, false, false, null]);
  // Five levels each: this one has two left, and the other all five.
  const second = await world.invoke("use_spell_slot", { characterId: mage.id, spell: "Fireball", level: 3, storeIn: `${RING} (2)`, storeInCharacterId: fighter.id });
  assert.equal(second.ok, true, JSON.stringify(second));
  const after = world.sheet(fighter.id).equipment.filter((item) => item.name.startsWith(RING));
  assert.deepEqual(after.map((item) => (item.storedSpells ?? []).map((entry) => entry.spell)), [["Fireball"], ["Fireball"]]);
  assert.match(magicItemLine(after[1], after), /holds Fireball/, "the split ring is still a Ring of Spell Storing");
  // The unworn one casts nothing until it is put on and attuned.
  const unworn = await world.invoke("use_item", { characterId: fighter.id, item: `${RING} (2)`, spell: "Fireball" });
  assert.equal(unworn.ok, false, JSON.stringify(unworn));
});

await test("GAME STATE says what the ring holds and what is free, and a mystery ring gives nothing away", () => {
  const stored = [{ spell: "Fireball", level: 3, saveDc: 15, attackBonus: 7 }];
  assert.match(magicItemLine(ring({ storedSpells: stored })), /^Ring of Spell Storing: holds Fireball \(level 3, save DC 15, attack \+7\); 2 of 5 levels free; attuned, worn$/);
  assert.match(magicItemLine(ring()), /holds no spells; 5 of 5 levels free/);
  assert.equal(magicItemLine({ name: "an ornate silver ring", qty: 1, identified: false, storedSpells: stored })?.includes("Fireball") ?? false, false);
});

await test("A spell the ring holds and the narration cast unpaid is sent to the ring first, never straight to a slot", () => {
  const prompt = unpaidCastPrompt({ caster: "Brute", casterId: "c1", spell: "Fireball", quote: "fire blooms" }, storedCastHint(ring(), "Fireball", "aoe_damage"));
  assert.match(prompt, /use_item with item "Ring of Spell Storing" and spell "Fireball"/);
  const turn = readFileSync(new URL("../src/lib/dm/turn.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(turn, /if \(storerHolding\(sheet\.equipment, cast\.spell\)\) \{\n\s+return null;/, "the server does not cast it from a slot by itself");
});

for (const world of worlds) {
  world.close?.();
}
finish();
