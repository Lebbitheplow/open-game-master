// The probes of the cyberpunk clause ledger the fifth genre-a round adds
// (scripts/clauses/genre-cyberpunk.json): one per mechanism of
// src/lib/dm/genre-a-cyberpunk-*.ts, same contract as the probes of
// sweep-clauses-genre-a-probes.mjs (an assertion is the rule not held, any
// other throw is the probe's setup breaking).
import { must, eq } from "./sweep-clauses-genre-a.mjs";

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
