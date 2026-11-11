// The probes of the cyberpunk clause ledger the fifth genre-a round adds
// (scripts/clauses/genre-cyberpunk.json): one per mechanism of
// src/lib/dm/genre-a-cyberpunk-*.ts, same contract as the probes of
// sweep-clauses-genre-a-probes.mjs (an assertion is the rule not held, any
// other throw is the probe's setup breaking).
import { must, eq } from "./sweep-clauses-genre-a.mjs";
import { TRAINED } from "./enforce-combat.mjs";

const key = (name) => name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
// A caster of the class's own ability, Fire Bolt known, two slot levels.
const CASTING = (ability) => ({ ability, slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, known: ["Magic Missile", "Healing Word"], prepared: ["Magic Missile", "Healing Word"], cantrips: ["Fire Bolt"] });
const stripFeature = (t, id, name) => t.world.patch(id, { features: t.world.sheet(id).features.filter((entry) => key(entry.name) !== key(name)) });

export const CYBER = {
  // "1/turn, shove a target 10 ft with a psionic hit": a Fire Bolt that hits
  // moves the foe two squares away; a second hit the same turn does not; a
  // holder without the feature shoves nobody.
  async spell_shove(t, run, feature) {
    const scene = await t.stage(feature, { lane: true, extra: { equipment: [], spellcasting: CASTING("cha") } });
    t.kit.place(scene.far.id, 9, 5);
    const at = () => t.kit.token(scene.far.id).x;
    const bolt = async () => must(await t.kit.swing(scene.holder.id, scene.far.id, [15, 3, 3, 3], { spell: "Fire Bolt" }), "the Fire Bolt");
    await bolt();
    eq(at() - 9, 2, "squares the foe moved after a psionic hit");
    t.kit.freshTurn();
    t.kit.giveTurn(scene.holder.id);
    stripFeature(t, scene.holder.id, feature.name);
    t.kit.place(scene.far.id, 9, 5);
    await bolt();
    eq(at(), 9, "squares the foe moved after a Fire Bolt from a holder without the feature");
  },
};

// "1/turn": a second Fire Bolt on the same turn (the action handed back, the
// turn's once-a-turn claims kept) carries no rider; the first did.
CYBER.program_once = async function programOnce(t, run, feature) {
  const ability = run.ability ?? "int";
  const scene = await t.stage(feature, { lane: true, extra: { equipment: [], spellcasting: CASTING(ability) } });
  const bolt = async () => {
    const before = t.foeHp(scene.far.id);
    must(await t.kit.swing(scene.holder.id, scene.far.id, [15, 3, 3, 3, 3, 3], { spell: "Fire Bolt" }), "the Fire Bolt");
    return before - t.foeHp(scene.far.id);
  };
  const first = await bolt();
  const encounter = t.world.encounter();
  t.encounters.saveEncounter({ ...encounter, turnBudget: { ...encounter.turnBudget, actionUsed: false, castThisAction: false, attacksMade: 0 } });
  const second = await bolt();
  eq(first - second, run.n, `damage the rider added to the first Fire Bolt of the turn over the second (${first} then ${second})`);
};

// "Each drone regains 2d6 HP at the start of your turn, once per rest each":
// both drones of a 9th-level rigger, hurt, are mended as the rigger's turn
// starts (2d6 on 3s), the rigger untouched; hurt again, they are not.
CYBER.drone_repair = async function droneRepair(t, run, feature) {
  const turns = await import(new URL("../../src/lib/dm/authored-turns.ts", import.meta.url).href);
  t.fresh();
  const hero = t.hero(feature.classId, run.level ?? feature.level, { currentHp: 40 });
  const made = must(await t.world.invoke("use_resource", { characterId: hero.id, resource: "Drone Companion" }), "Drone Companion").result;
  const drones = (made?.result?.summoned ?? made?.summoned ?? []).map((entry) => entry.characterId);
  if (drones.length < 2) throw new Error(`the staged rigger has ${drones.length} drones`);
  const hurt = () => drones.forEach((id) => t.world.patch(id, { currentHp: 1 }));
  const start = () => {
    t.world.clearDice();
    t.world.dice(3, 3, 3, 3);
    turns.authoredTurnStart(t.world.campaign(), t.world.encounter(), [hero.id]);
    t.world.clearDice();
  };
  hurt();
  start();
  eq(drones.map((id) => t.hp(id)).join(","), "7,7", "the drones' hit points after the rigger's turn starts");
  hurt();
  start();
  eq(drones.map((id) => t.hp(id)).join(","), "1,1", "the drones' hit points as a second turn starts, each mended once since the rest");
};

// "1/turn": a second foe dropped on the same turn adds no second attack.
CYBER.apex_once = async function apexOnce(t, run, feature) {
  // Three foes, so two can drop and the fight runs on.
  t.fresh();
  const hero = t.hero(feature.classId, feature.level);
  await t.kit.fight(3, { heroFaces: { [hero.id]: 19 } });
  const foes = t.world.enemies();
  t.kit.place(hero.id, 5, 5);
  foes.forEach((foe, index) => t.kit.place(foe.id, 4 + index, 6));
  t.kit.giveTurn(hero.id);
  for (const foe of foes.slice(0, 2)) {
    t.kit.setEnemy(foe.id, { currentHp: 1 });
    must(await t.kit.swing(hero.id, foe.id, [15, 4, 3, 3]), "the staged attack");
  }
  eq(t.world.encounter().turnBudget.attacksAllowed, 4, "attacks allowed after dropping two foes in one turn (three and one more, once)");
};

// "one drone turns invisible for 1 minute": the rigger's drone, not the rigger.
CYBER.drone_ghost = async function droneGhost(t, run, feature) {
  t.fresh();
  const hero = t.hero(feature.classId, feature.level);
  const made = must(await t.world.invoke("use_resource", { characterId: hero.id, resource: "Drone Companion" }), "Drone Companion").result;
  const drone = (made?.result?.summoned ?? made?.summoned ?? [])[0]?.characterId;
  if (!drone) throw new Error("the staged rigger has no drone");
  must(await t.world.invoke("use_resource", { characterId: hero.id, resource: "Ghost Protocol" }), "Ghost Protocol");
  const has = (id) => t.world.sheet(id).conditions.map((entry) => entry.toLowerCase()).includes("invisible");
  eq(`${has(drone)}/${has(hero.id)}`, "true/false", "invisible on the drone / on the rigger");
  eq(JSON.stringify(t.world.sheet(drone).conditionMeta?.invisible ?? {}).includes("10"), true, "ten rounds (a minute) on the drone's invisibility");
};

// "weapon damage to every foe within 5 ft": the slash hurts the foe beside
// the samurai and not the one 70 feet off, and spends one attack.
CYBER.whirl = async function whirl(t, run, feature) {
  const scene = await t.stage(feature);
  const near = t.foeHp(scene.near.id);
  const far = t.foeHp(scene.far.id);
  t.world.clearDice();
  t.world.dice(5);
  must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Whirl of Edges" }), "Whirl of Edges");
  t.world.clearDice();
  eq(`${near - t.foeHp(scene.near.id)}/${far - t.foeHp(scene.far.id)}`, "9/0", "damage to the foe within 5 feet (a longsword's 5 + STR 4) / to the far foe");
  eq(t.budget().attacksMade, 1, "attacks of the Attack action made");
};

// "a creature hit by your psionic saves (WIS) or is stunned": refused with
// no hit; after a Fire Bolt hits, a failed save stuns.
CYBER.synaptic = async function synaptic(t, run, feature) {
  const scene = await t.stage(feature, { lane: true, extra: { equipment: [], spellcasting: CASTING("cha") } });
  const spend = () => t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "cyberpunk_synaptic_overload", targetEnemyId: scene.far.id });
  eq((await spend()).ok, false, "Synaptic Overload on a creature no psionic hit");
  must(await t.kit.swing(scene.holder.id, scene.far.id, [15, 3, 3, 3], { spell: "Fire Bolt" }), "the Fire Bolt");
  t.world.clearDice();
  t.world.dice(2);
  must(await spend(), "Synaptic Overload after the hit");
  t.world.clearDice();
  eq(t.kit.enemy(scene.far.id).conditions.map((entry) => entry.toLowerCase()).includes("stunned"), true, "stunned after a failed WIS save");
};

// "your next damaging psionic deals maximum damage": after the spend, a
// Burning Hands through aoe_damage lands 3d6 at 18 and takes the mark off;
// the next lands as rolled.
CYBER.rend = async function rend(t, run, feature) {
  const scene = await t.stage(feature, { extra: { equipment: [], spellcasting: { ...CASTING("cha"), known: ["Burning Hands"], prepared: ["Burning Hands"] } } });
  must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Reality Rend" }), "Reality Rend");
  const burn = async () => {
    t.kit.giveTurn(scene.holder.id);
    t.kit.setEnemy(scene.near.id, { currentHp: 300 });
    t.world.clearDice();
    t.world.dice(1, 1, 1, 20, 20);
    must(await t.world.invoke("aoe_damage", { casterId: scene.holder.id, spell: "Burning Hands", level: 1, enemyIds: [scene.near.id] }), "Burning Hands");
    t.world.clearDice();
    return 300 - t.foeHp(scene.near.id);
  };
  const first = await burn();
  const second = await burn();
  eq(`${first}/${second}`, "18/1", "Burning Hands with the mark, then without (the dice show 1s; the foe saves at 20 for half)");
};

// "reroll a failed CHA-based check": refused with no failed check; after a
// Persuasion check fails (a 2), the spend rolls it again (a 20) and it holds.
CYBER.grease = async function grease(t, run, feature) {
  t.fresh();
  const hero = t.hero(feature.classId, feature.level, { proficiencies: { ...TRAINED, skills: ["persuasion"] } });
  const spend = () => t.world.invoke("use_resource", { characterId: hero.id, resource: "Grease the Wheels" });
  eq((await spend()).ok, false, "Grease the Wheels with no failed check");
  t.world.clearDice();
  t.world.dice(2);
  must(await t.world.invoke("request_roll", { characterId: hero.id, kind: "skill_check", skill: "persuasion", dc: 15, reason: "a probe" }), "the check");
  t.world.clearDice();
  t.world.dice(20);
  const out = must(await spend(), "Grease the Wheels after the failure");
  t.world.clearDice();
  eq(/succeeds/.test(JSON.stringify(out.result)), true, `the reroll on a 20: ${JSON.stringify(out.result).slice(0, 200)}`);
};
