// The mystery, post-apocalyptic and steampunk classes' features, second suite
// (WAVE2 D5): the shared mechanisms built for the handoff of the first pass.
// Each case fails without its mechanism; the clause ledgers
// (scripts/clauses/genre-*.json) point here for the clauses they hold.
//
//   auras        src/lib/dm/genre-b-auras.ts (saves through forced-save.ts
//                rollExtrasFor, AC through ac-effects.ts acWithEffects) and
//                the aura_resist row's types (authored-saves.ts)
//   drops        src/lib/dm/genre-b-drops.ts (Stand at the Dawn) and
//                Hardened's cut, both in src/lib/dm/pc-damage.ts
//   cures        src/lib/dm/genre-b-cure.ts (the "cure" spend kind)
//   slotless     src/lib/dm/genre-b-free-cast.ts marks, read by the cast guard
//   kills        src/lib/dm/genre-b-kills.ts, from authored-hooks.ts authoredOnKill
//   passives     rows of src/lib/srd/authored-effects-genre-b.ts on the
//                engine's own readers: darkvision, a turn's heal, acid that
//                ignores resistance, a concentration damage cannot break or
//                saved with advantage, checks about a circumstance
//
// Dice forced; every check reads a sheet, a roll's total or a refusal.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice, diceLog } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const { acWithEffects } = await import(new URL("lib/dm/ac-effects.ts", SRC).href);
const { authoredDarkvisionFeet, authoredConcentrationGuard } = await import(new URL("lib/srd/authored-effects-more.ts", SRC).href);
const { authoredTurnStart } = await import(new URL("lib/dm/authored-turns.ts", SRC).href);
const { authoredIgnoresResistance } = await import(new URL("lib/dm/authored-saves.ts", SRC).href);

const { test, finish } = suite("test-genre-b-features-2");
const rig = await clausesRig();
const { world, kit, ally } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};

// The ally's WIS save against fear on an 11: its total, and how many d20s it threw.
async function allyFearSave(faces = [11, 3]) {
  clearDice();
  diceLog();
  dice(...faces);
  const out = rig.must(await world.invoke("request_roll", { characterId: ally.id, kind: "saving_throw", ability: "wis", against: "frightened", dc: 10, reason: "test" }), "request_roll");
  const d20s = diceLog().filter((die) => die.sides === 20).length;
  clearDice();
  return { total: out.total, d20s };
}

// The holder beside the ally (the rig's fight puts them adjacent), then 50 feet off.
async function nearThenFar(hero, read) {
  await rig.fight(hero);
  const near = await read();
  kit.place(hero.id, 15, 12);
  const far = await read();
  return { near, far };
}

// ---- auras ----

for (const [classId, name, level] of [["alienist", "Steadying Presence", 5], ["road_warrior", "Fear No Rust", 6]]) {
  await run(`${name}: an ally within 10 ft adds +1d4 to a save against fear, and one 50 ft off does not`, async () => {
    const hero = rig.holder(feature(classId, name, level));
    const { near, far } = await nearThenFar(hero, () => allyFearSave());
    // WIS 16 (+3), the fighter untrained in WIS saves: 11 + 3, and the d4's 3.
    assert.equal(near.total, 17, `beside the holder the save totalled ${near.total}`);
    assert.equal(far.total, 14, `50 ft off the save totalled ${far.total}`);
  });
}

await run("Steadying Presence: the die rides only a save against fear", async () => {
  const hero = rig.holder(feature("alienist", "Steadying Presence", 5));
  await rig.fight(hero);
  clearDice();
  dice(11, 3);
  const out = rig.must(await world.invoke("request_roll", { characterId: ally.id, kind: "saving_throw", ability: "dex", against: "poisoned", dc: 10, reason: "test" }), "request_roll");
  clearDice();
  assert.equal(out.total, 14, `a save against poison totalled ${out.total}`);
});

await run("Fear No Rust: an unconscious road warrior steadies nobody", async () => {
  const hero = rig.holder(feature("road_warrior", "Fear No Rust", 6));
  await rig.fight(hero);
  world.patch(hero.id, { currentHp: 0 });
  const { total } = await allyFearSave();
  assert.equal(total, 14, `with the road warrior down the save totalled ${total}`);
});

await run("Group Therapy: Steadying Presence reaches 30 ft", async () => {
  const hero = rig.holder(feature("alienist", "Group Therapy", 15));
  await rig.fight(hero);
  kit.place(hero.id, 5, 8);
  const { total } = await allyFearSave();
  assert.equal(total, 17, `25 ft off the save totalled ${total}`);
  kit.place(hero.id, 5, 12);
  assert.equal((await allyFearSave()).total, 14, "45 ft off the die still rode");
});

await run("Walk Through the Valley: allies within 10 ft resist necrotic and save against fear with advantage", async () => {
  const hero = rig.holder(feature("waste_preacher", "Walk Through the Valley", 15));
  const { near, far } = await nearThenFar(hero, async () => ({ save: (await allyFearSave([11, 11])).d20s, lost: await rig.damageLost(ally, "necrotic") }));
  assert.deepEqual(near, { save: 2, lost: 10 }, `beside the preacher: ${JSON.stringify(near)}`);
  assert.deepEqual(far, { save: 1, lost: 20 }, `50 ft off: ${JSON.stringify(far)}`);
});

// The ally's AC as an attack on them reads it (ac-effects.ts acWithEffects).
const allyAc = () => acWithEffects(world.campaignId, world.sheet(ally.id));

await run("Guardian's Instinct: allies within 10 ft gain +1 AC while the enforcer is conscious", async () => {
  const hero = rig.holder(feature("enforcer", "Guardian's Instinct", 15));
  await rig.fight(hero);
  const beside = allyAc();
  world.patch(hero.id, { currentHp: 0 });
  const down = allyAc();
  world.patch(hero.id, { currentHp: 100 });
  kit.place(hero.id, 15, 12);
  const far = allyAc();
  assert.deepEqual([beside - far, down], [1, far], `beside ${beside}, the enforcer down ${down}, 50 ft off ${far}`);
});

await run("Shield Coupling: an adjacent ally gains +1 AC only while the steam knight holds a shield", async () => {
  const hero = rig.holder(feature("steam_knight", "Shield Coupling", 3), { gear: "shield" });
  await rig.fight(hero);
  const adjacent = allyAc();
  kit.place(hero.id, 5, 5);
  const off = allyAc();
  kit.place(hero.id, 5, 2);
  world.patch(hero.id, { equipment: world.sheet(hero.id).equipment.filter((item) => item.name !== "Shield") });
  const bare = allyAc();
  assert.deepEqual([adjacent - off, bare], [1, off], `adjacent ${adjacent}, 10 ft off ${off}, no shield ${bare}`);
});

// ---- passives ----

await run("Predator Senses: darkvision 60 ft", () => {
  const row = feature("aberrant", "Predator Senses", 3);
  const hero = rig.holder(row);
  const sheet = world.sheet(hero.id);
  assert.equal(authoredDarkvisionFeet(sheet, 0), 60);
  assert.equal(authoredDarkvisionFeet({ ...sheet, features: sheet.features.filter((entry) => entry.name !== row.name) }, 0), 0);
});

await run("The Engine Eternal: 5 hit points at the start of the turn below half, none above it or at 0", async () => {
  const hero = rig.holder(feature("steam_knight", "The Engine Eternal", 20));
  await rig.fight(hero);
  const start = (hp, conditions = []) => {
    world.patch(hero.id, { currentHp: hp, conditions });
    authoredTurnStart(world.campaign(), world.encounter(), [hero.id]);
    return world.sheet(hero.id).currentHp;
  };
  assert.equal(start(40), 45, "below half");
  assert.equal(start(60), 60, "above half");
  assert.equal(start(0, ["unconscious"]), 0, "at 0, unconscious");
});

await run("Alkahest: the alchemist's acid ignores resistance, and no other type does", async () => {
  const hero = rig.holder(feature("alchemist", "Alkahest", 18));
  await rig.fight(hero);
  assert.equal(authoredIgnoresResistance(world.campaignId, "acid"), "Alkahest");
  assert.equal(authoredIgnoresResistance(world.campaignId, "fire"), null);
});

await run("The Word Made Iron: damage never breaks the preacher's concentration on any spell", async () => {
  const row = feature("waste_preacher", "The Word Made Iron", 18);
  const hero = rig.holder(row);
  const sheet = world.sheet(hero.id);
  assert.equal(authoredConcentrationGuard(sheet, "Bless")?.feature, "The Word Made Iron");
  assert.equal(authoredConcentrationGuard({ ...sheet, features: sheet.features.filter((entry) => entry.name !== row.name) }, "Bless"), null);
});

await run("Redundant Systems: the machinist saves to keep concentration with advantage", async () => {
  const row = feature("machinist", "Redundant Systems", 15);
  const hero = rig.holder(row);
  const save = async () => {
    world.patch(hero.id, { currentHp: 100, concentratingOn: "Bless" });
    clearDice();
    diceLog();
    dice(15, 15);
    rig.must(await world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "fire", reason: "test" }), "apply_damage");
    const d20s = diceLog().filter((die) => die.sides === 20).length;
    clearDice();
    return d20s;
  };
  const { on, off } = await rig.both(hero, row, save);
  assert.deepEqual([on, off], [2, 1], `the concentration save threw ${on} d20 with the feature, ${off} without`);
});

for (const [classId, name, level, args, plain] of [
  ["road_warrior", "Wheelman", 2, { kind: "ability_check", ability: "dex", about: "vehicles" }, { kind: "ability_check", ability: "dex" }],
  ["gadgeteer", "Quick Study", 3, { kind: "ability_check", ability: "int", about: "devices" }, { kind: "ability_check", ability: "int" }],
  ["packmaster", "Scent the Wind", 6, { kind: "skill_check", skill: "survival", about: "tracking" }, { kind: "skill_check", skill: "survival" }],
  ["grifter", "A New Face", 1, { kind: "skill_check", skill: "deception", about: "disguise" }, { kind: "skill_check", skill: "deception" }],
  ["alienist", "Symbol Reading", 2, { kind: "ability_check", ability: "int", about: "hidden_message" }, { kind: "ability_check", ability: "int" }],
  ["packmaster", "Lord of the Green", 17, { kind: "ability_check", ability: "wis", creature: "beast" }, { kind: "ability_check", ability: "wis", creature: "humanoid" }],
]) {
  await run(`${name}: advantage on a check about what its text names, and only then`, async () => {
    const row = feature(classId, name, level);
    const hero = rig.holder(row);
    const { on, off } = await rig.both(hero, row, () => rig.d20sOf(hero, args));
    const other = await rig.d20sOf(hero, plain);
    assert.deepEqual([on, off, other], [2, 1, 1], `${JSON.stringify(args)}: ${on} d20 with ${name}, ${off} without; ${JSON.stringify(plain)}: ${other}`);
  });
}

// ---- surprise (src/lib/dm/genre-b-surprise.ts, read by encounter-open.ts decideAmbush) ----

// An ambush by one creature whose Stealth (a 20) beats every passive
// Perception: whether the holder is named among the surprised.
async function ambushedBy(monster) {
  await kit.endFight();
  clearDice();
  dice(1, 20, 15, 15);
  const opened = rig.must(await world.invoke("start_encounter", { enemies: [{ monster, count: 1 }], ambush: "enemies" }), "start_encounter");
  clearDice();
  await kit.endFight();
  return /\bHolder\b[^.]*\bnotices? nothing\b/.test(String(opened.ambush ?? ""));
}

await run("Scent the Wind: a beast or a mutant (a monstrosity) cannot surprise the packmaster; a goblin can", async () => {
  rig.holder(feature("packmaster", "Scent the Wind", 6));
  assert.equal(await ambushedBy("wolf"), false, "a wolf surprised the packmaster");
  assert.equal(await ambushedBy("goblin"), true, "the goblin's ambush caught nobody: the staging broke");
});

// ---- drops and cuts (src/lib/dm/pc-damage.ts) ----

await run("Stand at the Dawn: an ally within 30 ft who drops to 0 drops to WIS mod x 5 instead, once; one 50 ft off falls", async () => {
  const hero = rig.holder(feature("waste_preacher", "Stand at the Dawn", 10));
  await rig.fight(hero);
  const drop = async () => {
    world.patch(ally.id, { currentHp: 100, conditions: [], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    rig.must(await world.invoke("apply_damage", { characterId: ally.id, amount: 110, type: "slashing", reason: "test" }), "apply_damage");
    return world.sheet(ally.id).currentHp;
  };
  assert.equal(await drop(), 15, "beside the preacher (WIS +3)");
  assert.equal(world.sheet(hero.id).resources.post_apocalyptic_stand_at_the_dawn.used, 1, "the preacher's use was not spent");
  assert.equal(await drop(), 0, "a second drop was held with the use spent");
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, post_apocalyptic_stand_at_the_dawn: { max: 1, used: 0 } } });
  kit.place(hero.id, 15, 12);
  assert.equal(await drop(), 0, "50 ft off the ally was held");
  const bare = await world.invoke("use_resource", { characterId: hero.id, resource: "post_apocalyptic_stand_at_the_dawn", reason: "test" });
  assert.equal(bare.ok, false, "a bare spend was accepted");
});

for (const [level, cut] of [[1, 3], [10, 6]]) {
  await run(`Hardened: at level ${level} every blow this round loses ${cut} (the CON modifier${level >= 10 ? ", twice" : ""})`, async () => {
    const hero = rig.holder(feature("road_warrior", level >= 10 ? "Hardened (2 uses)" : "Hardened", level));
    await rig.fight(hero);
    assert.equal(await rig.damageLost(hero, "fire"), 20, "before the spend");
    rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Hardened", reason: "test" }), "use_resource Hardened");
    assert.equal(await rig.damageLost(hero, "fire"), 20 - cut, "a fire blow after it");
    assert.equal(await rig.damageLost(hero, "slashing"), 20 - cut, "a second blow the same round");
  });
}

// ---- cures (src/lib/dm/genre-b-cure.ts) ----

const frighten = async (id, condition = "frightened") => rig.must(await world.invoke("set_condition", { characterId: id, condition, reason: "test" }), "set_condition");

for (const [classId, name, level, id] of [["alienist", "Break the Delusion", 9, "mystery_break_the_delusion"], ["waste_preacher", "Deliverance", 9, "post_apocalyptic_deliverance"]]) {
  await run(`${name}: ends fear on an ally within 30 ft; one 50 ft off, or one carrying nothing, is refused with nothing spent`, async () => {
    const hero = rig.holder(feature(classId, name, level));
    await rig.fight(hero);
    const spend = () => world.invoke("use_resource", { characterId: hero.id, resource: name, targetCharacterId: ally.id, reason: "test" });
    const bare = await spend();
    assert.equal(bare.ok, false, "a spend on an ally carrying nothing went through");
    await frighten(ally.id);
    kit.place(hero.id, 15, 12);
    const far = await spend();
    assert.equal(far.ok, false, "a spend reached an ally 50 ft off");
    assert.equal(world.sheet(hero.id).resources[id].used, 0, "a refusal spent the use");
    kit.place(hero.id, 5, 2);
    const out = await spend();
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(ally.id).conditions.includes("frightened"), false, `the ally still carries ${world.sheet(ally.id).conditions}`);
  });
}

await run("Revelation: every ally within 60 ft regains 5d8, sheds fear and charm, and loses a level of exhaustion", async () => {
  const hero = rig.holder(feature("waste_preacher", "Revelation", 20));
  await rig.fight(hero);
  world.patch(hero.id, { currentHp: 40 });
  world.patch(ally.id, { currentHp: 40, exhaustion: 2 });
  await frighten(ally.id);
  await frighten(ally.id, "charmed");
  clearDice();
  dice(3, 3, 3, 3, 3, 3, 3, 3, 3, 3);
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Revelation", reason: "test" });
  clearDice();
  assert.equal(out.ok, true, out.error);
  const after = world.sheet(ally.id);
  assert.ok(after.currentHp > 40 && world.sheet(hero.id).currentHp > 40, `the ally holds ${after.currentHp}, the preacher ${world.sheet(hero.id).currentHp}`);
  assert.deepEqual([after.conditions.filter((entry) => ["frightened", "charmed"].includes(entry)), after.exhaustion], [[], 1], JSON.stringify(out.result).slice(0, 300));
  // An ally 65 ft off is outside the sermon.
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, post_apocalyptic_revelation: { max: 1, used: 0 } } });
  world.patch(ally.id, { currentHp: 40 });
  await frighten(ally.id);
  kit.place(ally.id, 5, 15);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Revelation", reason: "test" }), "use_resource Revelation");
  assert.deepEqual([world.sheet(ally.id).currentHp, world.sheet(ally.id).conditions.includes("frightened")], [40, true], "an ally 65 ft off was reached");
});

// ---- slotless casts (src/lib/dm/genre-b-free-cast.ts, read by cast-guard.ts) ----

const caster = (hero) =>
  world.patch(hero.id, { equipment: [...world.sheet(hero.id).equipment, { name: "Component Pouch", qty: 1 }], spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } }, prepared: ["Mage Armor", "Mirror Image", "Haste"], known: [], cantrips: [] } });
const used = (hero) => Object.fromEntries(Object.entries(world.sheet(hero.id).spellcasting.slots).map(([level, slot]) => [level, slot.used]));
const cast = async (hero, spell) => rig.must(await world.invoke("cast_buff", { characterId: hero.id, spell }), `cast_buff ${spell}`);

await run("Overpressure Valve: one 1st-level spell with no slot, the mark spent by it; a 2nd-level spell still takes its slot", async () => {
  const hero = rig.holder(feature("machinist", "Overpressure Valve", 5));
  caster(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Overpressure Valve", reason: "test" }), "use_resource");
  await cast(hero, "Mirror Image");
  assert.deepEqual(used(hero), { 1: 0, 2: 1, 3: 0 }, "a 2nd-level spell was paid by the 1st-level mark");
  await cast(hero, "Mage Armor");
  assert.deepEqual(used(hero), { 1: 0, 2: 1, 3: 0 }, "the 1st-level spell took a slot");
  await cast(hero, "Mage Armor");
  assert.deepEqual(used(hero), { 1: 1, 2: 1, 3: 0 }, "the mark paid twice");
});

await run("Living Dynamo: for a minute every spell of 3rd level or lower costs no slot", async () => {
  const hero = rig.holder(feature("aether_channeler", "Living Dynamo", 20));
  caster(hero);
  await rig.fight(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Living Dynamo", reason: "test" }), "use_resource");
  await cast(hero, "Haste");
  rig.myTurn(hero);
  await cast(hero, "Mirror Image");
  assert.deepEqual(used(hero), { 1: 0, 2: 0, 3: 0 }, "a slot was spent inside the minute");
});

await run("Master Schematic: the chosen 3rd-level spell with no slot, never a lower one", async () => {
  const hero = rig.holder(feature("machinist", "Master Schematic", 14));
  caster(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Master Schematic", reason: "test" }), "use_resource");
  await cast(hero, "Mage Armor");
  await cast(hero, "Haste");
  assert.deepEqual(used(hero), { 1: 1, 2: 0, 3: 0 }, "the 1st-level spell rode the 3rd-level choice, or the 3rd took a slot");
});

// ---- kills (src/lib/dm/genre-b-kills.ts) ----

// The holder drops the near foe with one blow, then the other foe's WIS save rolls a 1.
async function dropNear(hero, farAt) {
  const { near, far } = await rig.fight(hero);
  kit.setEnemy(near.id, { currentHp: 1 });
  kit.place(far.id, ...farAt);
  const out = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 1, 1]);
  if (!out.ok) throw new Error(`pc_attack: ${out.error}`);
  return kit.enemy(far.id).conditions.includes("frightened");
}

await run("Message Sent: the fallen creature's allies save or are frightened of the enforcer, however far", async () => {
  const hero = rig.holder(feature("enforcer", "Message Sent", 14));
  assert.equal(await dropNear(hero, [18, 2]), true, "the other foe, 65 ft off, was not frightened");
});

await run("Skull Takers: enemies within 15 ft of the road warrior save or are frightened; one 65 ft off is not", async () => {
  const hero = rig.holder(feature("road_warrior", "Skull Takers", 7));
  assert.equal(await dropNear(hero, [8, 2]), true, "a foe 15 ft off was not frightened");
  rig.reset();
  const again = rig.holder(feature("road_warrior", "Skull Takers", 7));
  assert.equal(await dropNear(again, [18, 2]), false, "a foe 65 ft off was frightened");
});

rig.world.close();
finish();
