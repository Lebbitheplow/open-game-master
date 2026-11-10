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
