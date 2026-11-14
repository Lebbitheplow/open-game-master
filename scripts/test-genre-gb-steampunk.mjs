// The steampunk classes' features wired in the genre-b completeness pass
// (cc1113, ids GB01 and on): each case fails without its mechanism, and the
// clause ledger (scripts/clauses/genre-steampunk.json) points here for the
// clauses it holds.
//
// Dice forced; every check reads what landed on a creature, a sheet, the
// board or the turn's budget.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { meetEnemyPart } = await load("lib/dm/enemy-defenses.ts");

const { test, finish } = suite("test-genre-gb-steampunk");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const foe = (enemy) => kit.enemy(enemy.id);
const { dice, clearDice } = await import("./lib/enforce-world.mjs");
// The dice an enemy's swing reads: a d20 low enough to miss, then damage.
const clearDiceFaces = (face) => {
  clearDice();
  dice(face, 3, 3, 3);
};

// ---- GB01: Universal Solvent, Heart of the Storm ----

await run("Universal Solvent: an alchemist's acid spell halves on a creature immune to acid, a weapon's acid does not get through, and without the feature none does", async () => {
  const row = feature("alchemist", "Universal Solvent", 14);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.setEnemy(near.id, { stats: { immune: "acid, poison", resist: "" } });
  const meet = (type, spell) => meetEnemyPart(world.campaignId, foe(near), 20, type, { spell }).amount;
  const { on, off } = await rig.both(hero, row, () => meet("acid", true));
  assert.equal(on, 10, `20 acid from a spell dealt ${on} to an acid-immune creature with Universal Solvent`);
  assert.equal(off, 0, `without it the same acid dealt ${off}`);
  assert.equal(meet("acid", false), 0, "an acid blow that is no formula got through the immunity");
  assert.equal(meet("poison", true), 0, "the poison immunity was softened too");
});

await run("Heart of the Storm: a channeler's lightning spell deals full damage through resistance and half through immunity, and the channeler gains no resistance of the Storm Sorcery feature", async () => {
  const row = feature("aether_channeler", "Heart of the Storm", 14);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const meet = (type) => meetEnemyPart(world.campaignId, foe(near), 20, type, { spell: true }).amount;
  kit.setEnemy(near.id, { stats: { resist: "lightning, fire", immune: "" } });
  const resisted = await rig.both(hero, row, () => meet("lightning"));
  assert.deepEqual([resisted.on, resisted.off], [20, 10], `a lightning-resistant creature took ${resisted.on} with Heart of the Storm and ${resisted.off} without it`);
  assert.equal(meet("fire"), 10, "the fire resistance was ignored too");
  kit.setEnemy(near.id, { stats: { resist: "", immune: "lightning" } });
  const immune = await rig.both(hero, row, () => meet("lightning"));
  assert.deepEqual([immune.on, immune.off], [10, 0], `a lightning-immune creature took ${immune.on} with Heart of the Storm and ${immune.off} without it`);
  // A creature both resistant and immune: the immunity becomes the resistance the art then does not ignore.
  kit.setEnemy(near.id, { stats: { resist: "lightning", immune: "lightning" } });
  assert.equal(meet("lightning"), 10, "a resistant and immune creature took full damage");
  // End to end: Shocking Grasp on the immune creature, through pc_attack.
  world.patch(hero.id, { spellcasting: { ...(world.sheet(hero.id).spellcasting ?? {}), ability: "int", cantrips: ["Shocking Grasp"] } });
  kit.setEnemy(near.id, { stats: { resist: "", immune: "lightning" } });
  rig.myTurn(hero);
  const out = await kit.swing(hero.id, near.id, [15, 8, 8, 8, 8, 8, 8], { spell: "Shocking Grasp" });
  assert.ok(out.ok, `Shocking Grasp: ${out.error}`);
  // Its 3d8 on 8s is 24, halved by the immunity read as resistance (Dynamo Spark's rider meets the same).
  assert.equal(out.result.damageApplied, 12, `Shocking Grasp's 24 dealt ${out.result.damageApplied} to the lightning-immune creature (${out.result.damageNote})`);
  // The feature gives the channeler no resistance (Grounded Stance's lightning is its own).
  const lightning = await rig.both(hero, row, () => rig.damageLost(hero, "lightning"));
  assert.equal(lightning.on, lightning.off, `lightning took ${lightning.on} with Heart of the Storm and ${lightning.off} without it`);
  assert.equal(await rig.damageLost(hero, "thunder"), 20, "the channeler resisted thunder");
});

// ---- GB02: the walk (Rigging Runner, Master of the High Wire, Juggernaut Frame, Hold the Line) ----

const at = (id) => [kit.token(id).x, kit.token(id).y];
// The holder walks three squares east over ground of one kind; what the walk
// cost, in squares of movement.
async function walkOver(hero, ch) {
  // Three whole columns of it, so no way round is shorter.
  const { getActiveBattleMap: board } = await load("lib/battlemap/view.ts");
  const { height } = board(world.campaignId);
  kit.openField(Array.from({ length: height }, (_, y) => [6, 7, 8].map((x) => [x, y, ch])).flat());
  rig.myTurn(hero);
  kit.place(hero.id, 5, 2);
  // The player's own walk (the move route's door), on their turn.
  const { walkCharacter } = await load("lib/dm/token-rules.ts");
  const { getActiveBattleMap } = await load("lib/battlemap/view.ts");
  const out = walkCharacter(world.campaign(), world.encounter(), getActiveBattleMap(world.campaignId), world.sheet(hero.id), kit.token(hero.id), { x: 8, y: 2 }, {});
  if (out?.error) throw new Error(`walk: ${out.error}`);
  assert.deepEqual(at(hero.id), [8, 2], "the walk did not arrive");
  return kit.token(hero.id).movedThisRound;
}

await run("Rigging Runner: an aeronaut climbs at a foot a foot, where without it a climb costs double", async () => {
  const row = feature("aeronaut", "Rigging Runner", 2);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.place(near.id, 12, 8);
  const { on, off } = await rig.both(hero, row, () => walkOver(hero, "^"));
  assert.deepEqual([on, off], [3, 6], `three climb squares cost ${on} with Rigging Runner and ${off} without it`);
});

await run("Master of the High Wire: difficult ground costs an aeronaut nothing extra", async () => {
  const row = feature("aeronaut", "Master of the High Wire", 18);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.place(near.id, 12, 8);
  const { on, off } = await rig.both(hero, row, () => walkOver(hero, ","));
  assert.deepEqual([on, off], [3, 6], `three difficult squares cost ${on} with the feature and ${off} without it`);
});

await run("Juggernaut Frame: an armored steam knight crosses difficult ground at no extra cost and an unarmored one does not; a slowed knight keeps their speed", async () => {
  const row = feature("steam_knight", "Juggernaut Frame", 14);
  const hero = rig.holder(row, { gear: "armor" });
  const { near } = await rig.fight(hero);
  kit.place(near.id, 12, 8);
  const { on, off } = await rig.both(hero, row, () => walkOver(hero, ","));
  assert.deepEqual([on, off], [3, 6], `three difficult squares cost ${on} with the frame and ${off} without it`);
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  assert.equal(await walkOver(hero, ","), 6, "an unarmored knight crossed difficult ground at no extra cost");
  const { pcMoveBudget, getActiveBattleMap } = await load("lib/battlemap/view.ts");
  const speed = () => pcMoveBudget(world.campaignId, world.encounter(), getActiveBattleMap(world.campaignId), world.sheet(hero.id), kit.token(hero.id)).speed;
  const whole = speed();
  world.patch(hero.id, { conditions: ["slowed"], exhaustion: 2 });
  const slowed = await rig.both(hero, row, async () => speed());
  assert.equal(slowed.on, whole, `a slowed, exhausted knight moves ${slowed.on} of ${whole} feet with the frame`);
  assert.ok(slowed.off < whole, "without the frame the knight was not slowed");
});

await run("Hold the Line: a creature fighting the knight pays double for the squares within their reach, two squares deep with a reach weapon", async () => {
  const row = feature("steam_knight", "Hold the Line", 3);
  const hero = rig.holder(row, { gear: "armor" });
  const { near } = await rig.fight(hero);
  kit.place(rig.ally.id, 1, 9);
  const walk = async (to) => {
    kit.handOnEnemies();
    kit.freshRound();
    kit.openField();
    kit.place(near.id, 10, 2);
    const out = await world.invoke("move_token", { token: near.id, x: to, y: 2 });
    if (!out.ok) throw new Error(`move_token: ${out.error}`);
    return kit.token(near.id).movedThisRound;
  };
  const { on, off } = await rig.both(hero, row, () => walk(6));
  assert.deepEqual([on, off], [5, 4], `four squares to the knight's side cost the creature ${on} with Hold the Line and ${off} without it`);
  assert.equal(await walk(7), 3, "with a longsword the square two away was held");
  world.patch(hero.id, { equipment: [{ name: "Glaive", qty: 1, equipped: true }, { name: "Chain Shirt", qty: 1, equipped: true }] });
  assert.equal(await walk(7), 4, "with a glaive the square two away was not held");
});

// ---- GB03: cover (Powder Discipline, Precision Engineering, Bulwark Advance) ----

// A low wall in the square before the creature at (10, 2): half cover from the west.
const behindWall = (near) => {
  kit.openField([[9, 1, "|"], [9, 2, "|"], [9, 3, "|"]]);
  kit.place(near.id, 10, 2);
};

await run("Powder Discipline: a firearm shot meets no half cover, and without the feature the shot does", async () => {
  const row = feature("aeronaut", "Powder Discipline", 7);
  const hero = rig.holder(row, { gear: "firearm" });
  const { near } = await rig.fight(hero);
  behindWall(near);
  const shoot = async (weapon) => {
    rig.myTurn(hero);
    const out = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3], { weapon });
    if (!out.ok) throw new Error(`pc_attack: ${out.error}`);
    return out.result.vsAc;
  };
  const { on, off } = await rig.both(hero, row, () => shoot("Pistol"));
  assert.deepEqual([on, off], [13, 15], `the pistol shot met AC ${on} with Powder Discipline and ${off} without it`);
});

await run("Precision Engineering: a machinist's spell attack meets no half cover, and a schematic's DEX save counts three-quarters cover as half", async () => {
  const row = feature("machinist", "Precision Engineering", 10);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  world.patch(hero.id, { spellcasting: { ...(world.sheet(hero.id).spellcasting ?? {}), ability: "int", cantrips: ["Fire Bolt"] } });
  behindWall(near);
  const cast = async () => {
    rig.myTurn(hero);
    const out = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3], { spell: "Fire Bolt" });
    if (!out.ok) throw new Error(`Fire Bolt: ${out.error}`);
    return out.result.vsAc;
  };
  const { on, off } = await rig.both(hero, row, cast);
  assert.deepEqual([on, off], [13, 15], `Fire Bolt met AC ${on} with Precision Engineering and ${off} without it`);
  const { schematicSaveCover } = await load("lib/dm/genre-b-steampunk-cover.ts");
  const sheet = world.sheet(hero.id);
  assert.deepEqual([schematicSaveCover(sheet, 5), schematicSaveCover(sheet, 2), schematicSaveCover(sheet, 0)], [2, 0, 0], "the save's cover after the feature");
  const bare = { ...sheet, features: sheet.features.filter((entry) => entry.name !== row.name) };
  assert.deepEqual([schematicSaveCover(bare, 5), schematicSaveCover(bare, 2)], [5, 2], "without the feature the save's cover changed");
});

await run("Bulwark Advance: a creature's ranged attack at an ally behind the knight meets three-quarters cover, and an ally out of the line has none", async () => {
  const row = feature("steam_knight", "Bulwark Advance", 11);
  const hero = rig.holder(row, { gear: "armor" });
  const { near } = await rig.fight(hero);
  kit.openField();
  kit.place(rig.ally.id, 4, 2);
  kit.place(near.id, 10, 2);
  kit.setEnemy(near.id, { stats: { attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  const shot = async () => {
    kit.handOnEnemies();
    kit.freshRound();
    clearDiceFaces(2);
    const out = await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: rig.ally.id });
    if (!out.ok) throw new Error(`enemy_attack: ${out.error}`);
    return out.result.vsAc;
  };
  const base = world.sheet(rig.ally.id).ac;
  const { on, off } = await rig.both(hero, row, shot);
  // The knight's body alone is half cover; the feature makes it three-quarters.
  assert.deepEqual([on - base, off - base], [5, 2], `the shot met AC ${on} with Bulwark Advance and ${off} without it (base ${base})`);
  kit.place(rig.ally.id, 5, 5);
  assert.equal(await shot(), base, "an ally out of the line had cover");
});

// ---- GB06: Boiler Plate's footing, Spring Heels, Powder Discipline's reload ----

await run("Boiler Plate: an armored, conscious steam knight is not pushed; unarmored, at 0 hit points or without the feature, they are", async () => {
  const row = feature("steam_knight", "Boiler Plate", 1);
  const hero = rig.holder(row, { gear: "armor" });
  const { near } = await rig.fight(hero);
  const { pushTokenAway } = await load("lib/dm/map-tools.ts");
  const shove = () => {
    kit.openField();
    kit.place(hero.id, 5, 2);
    kit.place(near.id, 4, 2);
    const out = pushTokenAway(world.campaign(), world.encounter().id, near.id, hero.id);
    return { moved: out.moved, at: [kit.token(hero.id).x, kit.token(hero.id).y], reason: out.reason };
  };
  const { on, off } = await rig.both(hero, row, async () => shove());
  assert.equal(on.moved, false, `the armored knight was pushed to ${on.at}`);
  assert.match(on.reason, /Boiler Plate/);
  assert.deepEqual(off.at, [6, 2], `without Boiler Plate the knight stands at ${off.at}`);
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  assert.equal(shove().moved, true, "an unarmored knight was not pushed");
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Chain Shirt", qty: 1, equipped: true }], currentHp: 0 });
  assert.equal(shove().moved, true, "an unconscious knight was not pushed");
});

await run("Spring Heels: a gadgeteer's long and high jumps triple", async () => {
  const row = feature("gadgeteer", "Spring Heels", 7);
  const hero = rig.holder(row);
  const { jumpReach } = await load("lib/dm/jump-reach.ts");
  const { on, off } = await rig.both(hero, row, async () => jumpReach(world.sheet(hero.id), true));
  assert.equal(on.longFeet, off.longFeet * 3, `a running long jump covers ${on.longFeet} feet with Spring Heels and ${off.longFeet} without`);
  assert.equal(on.highFeet, off.highFeet * 3, `a running high jump reaches ${on.highFeet} feet with Spring Heels and ${off.highFeet} without`);
});

await run("Powder Discipline: a Sky Corsair fires a loading firearm with every attack of the Attack action, where without it the second shot is refused", async () => {
  const row = feature("aeronaut", "Powder Discipline", 7);
  const hero = rig.holder(row, { gear: "firearm" });
  const { near } = await rig.fight(hero);
  kit.place(near.id, 9, 2);
  const twoShots = async () => {
    rig.myTurn(hero);
    const first = await kit.swing(hero.id, near.id, [15, 3, 3, 3], { weapon: "Pistol" });
    if (!first.ok) throw new Error(`the first shot: ${first.error}`);
    const second = await kit.swing(hero.id, near.id, [15, 3, 3, 3], { weapon: "Pistol" });
    return second.ok ? "fired" : String(second.error);
  };
  const { on, off } = await rig.both(hero, row, twoShots);
  assert.equal(on, "fired", `the second shot with Powder Discipline: ${on}`);
  assert.match(off, /load/i, `without it the second shot: ${off}`);
});

// ---- GB14: Greater Daring ----

await run("Greater Daring: an aeronaut's ranged shot from the air carries Daring Maneuver's 2d6 with no run, a shot from the ground does not, and the die is once a turn", async () => {
  const row = feature("aeronaut", "Greater Daring", 11);
  const hero = rig.holder(row, { gear: "firearm" });
  const { near } = await rig.fight(hero);
  kit.place(near.id, 10, 2);
  const { setTokenMovement } = await load("lib/db/battle-maps.ts");
  const shoot = async () => {
    const out = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3, 3, 3], { weapon: "Pistol" });
    if (!out.ok) throw new Error(`pc_attack: ${out.error}`);
    return out.damage?.expression ?? "";
  };
  rig.myTurn(hero);
  const grounded = await shoot();
  setTokenMovement(kit.token(hero.id).id, "fly");
  rig.myTurn(hero);
  const aloft = await shoot();
  assert.ok(aloft.includes("2d6") && !grounded.includes("2d6"), `the shot from the air rolled ${aloft} and from the ground ${grounded}`);
  const again = await shoot();
  assert.ok(!again.includes("2d6"), `a second shot from the air in the same turn rolled ${again}, the die again`);
});

// ---- GB15: Corrosive Focus's acid, Stone of the Magnum Opus, The Great Work, Magnum Opus ----

const encountersDb = await load("lib/db/encounters.ts");
function formulae(hero, ability = "int") {
  world.patch(hero.id, {
    equipment: [...world.sheet(hero.id).equipment, { name: "Component Pouch", qty: 1 }],
    spellcasting: { ability, slots: { 6: { max: 1, used: 0 } }, prepared: ["Disintegrate"], known: [], cantrips: ["Acid Splash"] },
  });
}
async function castAt(hero, enemy, spell, faces, saveAbility = "dex") {
  clearDice();
  dice(...faces);
  const out = rig.must(await world.invoke("cast_at_enemy", { characterId: hero.id, targetEnemyId: enemy.id, spell, saveAbility }), `cast_at_enemy ${spell}`);
  clearDice();
  return out;
}
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
const play = async (hero, name) => rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: name, reason: "test" }), name);
function actionBack() {
  const encounter = world.encounter();
  encountersDb.saveEncounter({ ...encounter, turnBudget: { ...encounter.turnBudget, actionUsed: false, castThisAction: false, castLeveledBonus: false, castLeveled: false } });
}

await run("Corrosive Focus: the free card turns the alchemist's formula to acid for the turn, so a fire-immune creature takes it, and a weapon's fire stays fire", async () => {
  const row = feature("alchemist", "Corrosive Focus", 2);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.setEnemy(near.id, { stats: { immune: "fire", resist: "" } });
  const meet = (spell) => meetEnemyPart(world.campaignId, foe(near), 20, "fire", { spell }).amount;
  assert.equal(meet(true), 0, "a fire formula got through the immunity before the card");
  await rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Corrosive Focus", reason: "test" }), "Corrosive Focus");
  assert.equal(meet(true), 20, "the formula did not meet the creature as acid");
  assert.equal(meet(false), 0, "a weapon's fire met it as acid too");
  const off = await rig.without(hero, row, () => meet(true));
  assert.equal(off, 0, "without the feature the mark still turned the type");
});

await run("Stone of the Magnum Opus: the stone's reroll card throws the formula's dice twice and keeps the better, from the stone's uses", async () => {
  const row = feature("alchemist", "Stone of the Magnum Opus", 15);
  const hero = rig.holder(row);
  formulae(hero);
  world.patch(hero.id, { features: world.sheet(hero.id).features.filter((entry) => entry.name !== "Corrosive Focus") });
  const { near } = await rig.fight(hero);
  await play(hero, "Catalyst Stone (reroll)");
  assert.equal(world.sheet(hero.id).resources.steampunk_catalyst_stone.used, 1, "the reroll did not spend a stone use");
  // Acid Splash at 15th: 3d6. The save a 1, then 1s, then 6s.
  const out = await castAt(hero, near, "Acid Splash", [1, 1, 1, 1, 6, 6, 6]);
  assert.equal(lost(near), 18, `the rerolled splash took ${lost(near)} (${JSON.stringify(out).slice(0, 300)})`);
  assert.ok(!world.sheet(hero.id).conditions.includes("catalyst reroll"), "the roll did not spend the reroll");
});

await run("The Great Work: the formula its slotless mark pays for deals its dice at their maximum, and the next spell is rolled", async () => {
  const row = feature("alchemist", "The Great Work", 20);
  const hero = rig.holder(row);
  formulae(hero);
  world.patch(hero.id, { features: world.sheet(hero.id).features.filter((entry) => entry.name !== "Corrosive Focus") });
  const { near } = await rig.fight(hero);
  await play(hero, "The Great Work");
  await castAt(hero, near, "Disintegrate", [1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  // 10d6 + 40 at their maximum.
  assert.equal(lost(near), 100, `the great work's Disintegrate took ${lost(near)}`);
  kit.setEnemy(near.id, { currentHp: 300 });
  actionBack();
  await castAt(hero, near, "Acid Splash", [1, 3, 3, 3, 3]);
  assert.equal(lost(near), 12, `the next spell, Acid Splash at 20th on 3s, took ${lost(near)}`);
});

await run("Magnum Opus: a construct fails its save against the spell the slotless mark pays for, and a creature of another kind saves", async () => {
  const row = feature("machinist", "Magnum Opus", 20);
  const hero = rig.holder(row);
  formulae(hero);
  const { near } = await rig.fight(hero);
  kit.setEnemy(near.id, { stats: { type: "construct" } });
  await play(hero, "Magnum Opus");
  await castAt(hero, near, "Disintegrate", [20, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  // 10d6 + 40 on 3s is 70 (a machinist's own rider may add to it).
  assert.ok(lost(near) >= 70, `the construct, saving on a 20, took ${lost(near)}`);
  kit.setEnemy(near.id, { currentHp: 300, stats: { type: "humanoid" } });
  actionBack();
  world.patch(hero.id, { spellcasting: { ...world.sheet(hero.id).spellcasting, slots: { 6: { max: 1, used: 0 } } } });
  await castAt(hero, near, "Disintegrate", [20, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  assert.ok(lost(near) < 10, `a humanoid saving on a 20 took ${lost(near)}`);
});

const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
// ---- GB16: Difference Engine Mind ----

await run("Difference Engine Mind: the spent use counts the next Intelligence check's d20 as a 20, a Wisdom check keeps its own, and the check spends it", async () => {
  const row = feature("machinist", "Difference Engine Mind", 17);
  const hero = rig.holder(row);
  await play(hero, "Difference Engine Mind");
  assert.equal(used(hero, "steampunk_difference_engine_mind"), 1, "the use was not spent");
  const total = async (args) => {
    clearDice();
    dice(4);
    const out = rig.must(await world.invoke("request_roll", { characterId: hero.id, dc: 30, reason: "probe", ...args }), "request_roll");
    clearDice();
    return out.total;
  };
  const wisdom = await total({ kind: "ability_check", ability: "wis" });
  const arcana = await total({ kind: "skill_check", skill: "arcana" });
  const after = await total({ kind: "skill_check", skill: "arcana" });
  assert.equal(arcana - after, 16, `the calculated Arcana check totalled ${arcana} and the next one ${after}; a 4 counted as a 20 is 16 more`);
  assert.ok(wisdom < arcana - 10, `the Wisdom check took the answer too (${wisdom})`);
});

rig.world.close();
finish();
