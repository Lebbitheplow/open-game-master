// The probes of the cyberpunk and dark fantasy clause ledgers the 2026-11-13
// creator audit's second genre pass adds (scripts/clauses/genre-cyberpunk.json,
// genre-dark-fantasy.json): one per mechanism it wired, same contract as the
// probes of sweep-clauses-genre-a-probes.mjs (an assertion is the rule not
// held, any other throw is the probe's setup breaking). Kinds are prefixed
// cc_ so they never shadow a probe of the older files.
import assert from "node:assert/strict";
import { must, eq } from "./sweep-clauses-genre-a.mjs";
import { CYBER } from "./sweep-clauses-genre-a-cyberpunk.mjs";
import { TRAINED } from "./enforce-combat.mjs";

const SRC = new URL("../../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const key = (name) => name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
const stripFeature = (t, id, name) => t.world.patch(id, { features: t.world.sheet(id).features.filter((entry) => key(entry.name) !== key(name)) });
const conditionsOf = (t, id) => t.world.sheet(id).conditions.map((entry) => entry.toLowerCase());
const foeConditions = (t, id) => t.kit.enemy(id).conditions.map((entry) => entry.toLowerCase());

export const CC = {
  // "opportunity attacks against you have disadvantage": the holder walks
  // out of the near foe's reach; the foe's opportunity attack is rolled at
  // disadvantage, and at none once the feature is gone.
  async cc_oa(t, run, feature) {
    const { resolveOpportunityAttacks } = await load("lib/dm/opportunity.ts");
    const { listRecentRolls } = await load("lib/db/rolls.ts");
    const scene = await t.stage(feature);
    const leave = () => {
      const encounter = t.world.encounter();
      t.encounters.saveEncounter({ ...encounter, reactionsUsed: [] });
      t.kit.place(scene.holder.id, 5, 5);
      t.world.clearDice();
      t.world.dice(18, 3, 18, 3, 6);
      resolveOpportunityAttacks(t.world.campaign(), scene.holder.id, { x: 5, y: 5 }, { x: 5, y: 3 }, false, [{ x: 5, y: 4 }, { x: 5, y: 3 }]);
      t.world.clearDice();
      const roll = listRecentRolls(t.world.campaignId, 6).filter((entry) => entry.kind === "attack").at(-1);
      if (!roll || roll.kind !== "attack") throw new Error(`no opportunity attack was rolled: ${JSON.stringify(roll).slice(0, 200)}`);
      return roll.advantage ?? "normal";
    };
    eq(leave(), "disadvantage", "the opportunity attack against the holder");
    stripFeature(t, scene.holder.id, feature.name);
    assert.notEqual(leave(), "disadvantage", "the opportunity attack against a holder without the feature was at disadvantage");
  },

  // A caster's own focus: "kit" (the plague doctor's kit and mask) is refused
  // with a holy symbol alone and cast with a herbalism kit; the other wants
  // are the cyberpunk probe's.
  async cc_focus(t, run, feature) {
    if (run.want === "none") {
      // Cast with nothing carried, and refused once the feature is gone.
      t.fresh();
      const casting = { ability: run.ability ?? "int", slots: { 1: { max: 4, used: 0 } }, known: ["Mage Armor"], prepared: ["Mage Armor"], cantrips: [] };
      const hero = t.hero(feature.classId, feature.level, { equipment: [], spellcasting: casting });
      // Nothing carried: the class's starting kit (a dirgesinger's lute) taken off.
      t.world.patch(hero.id, { equipment: [] });
      const cast = async () => t.world.invoke("cast_buff", { characterId: hero.id, spell: "Mage Armor" });
      const first = await cast();
      eq(first.ok, true, `Mage Armor cast with no pouch and no focus (${first.error ?? "cast"})`);
      t.world.patch(hero.id, { spellcasting: casting, concentratingOn: null });
      stripFeature(t, hero.id, feature.name);
      const second = await cast();
      eq(/focus|pouch/i.test(String(second.error ?? "")), true, `Mage Armor without the feature and with nothing carried (${second.error ?? "cast"})`);
      return;
    }
    if (run.want !== "kit") return CYBER.focus(t, run, feature);
    t.fresh();
    const casting = { ability: run.ability ?? "int", slots: { 1: { max: 4, used: 0 } }, known: ["Mage Armor"], prepared: ["Mage Armor"], cantrips: [] };
    const hero = t.hero(feature.classId, feature.level, { equipment: [], spellcasting: casting });
    const carry = (...names) => t.world.patch(hero.id, { equipment: names.map((name) => ({ name, qty: 1, equipped: false })) });
    const cast = async () => (await t.world.invoke("cast_buff", { characterId: hero.id, spell: "Mage Armor" })).ok;
    carry("Amulet");
    eq(await cast(), false, "Mage Armor cast with a holy symbol and no kit");
    carry("Herbalism Kit");
    eq(await cast(), true, "Mage Armor cast with the herbalism kit carried");
  },

  cc_check_about: (t, run, feature) => CYBER.check_about(t, run, feature),

  // "Allies within 20 ft deal +1d4 radiant with weapon attacks against your
  // branded quarry": the hunter brands the near foe; the ally beside them
  // swings at it and deals radiant beside its own damage, and none once the
  // hunter stands 70 feet off.
  async cc_silver_tide(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Hunter's Brand", targetEnemyId: scene.near.id }), "Hunter's Brand");
    const d4s = async () => {
      t.kit.freshTurn();
      t.kit.giveTurn(scene.ally.id);
      t.kit.place(scene.ally.id, 4, 6);
      t.world.clearDice();
      t.world.diceLog();
      const out = await t.kit.swing(scene.ally.id, scene.near.id, [15, 3, 3, 3, 3, 3, 3]);
      t.world.clearDice();
      must(out, "the ally's swing");
      if (out.result.hit === false) throw new Error("the ally's swing missed");
      return (out.result.damageByType ?? []).filter((part) => /radiant/.test(part)).length;
    };
    eq(await d4s(), 1, "radiant parts of the ally's hit on the branded foe, the hunter beside them");
    t.kit.place(scene.holder.id, 18, 18);
    eq(await d4s(), 0, "radiant parts of the ally's hit on the branded foe, the hunter 70 feet off");
  },

  // "critical hits also frighten (WIS save negates)": a critical hit on the
  // near foe, its save a 1, leaves it frightened of the knight; a plain hit
  // does not.
  async cc_crit_fright(t, run, feature) {
    const scene = await t.stage(feature);
    const swing = async (face) => {
      t.kit.freshTurn();
      t.kit.giveTurn(scene.holder.id);
      const out = must(await t.kit.swing(scene.holder.id, scene.near.id, [face, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1]), "the swing");
      return out;
    };
    await swing(15);
    eq(foeConditions(t, scene.near.id).includes("frightened"), false, "frightened after a plain hit");
    await swing(20);
    eq(foeConditions(t, scene.near.id).includes("frightened"), true, "frightened after a critical hit and a failed WIS save");
  },

  // "Your critical hits against branded creatures prevent regeneration and
  // revival for 24 hours": a critical hit on the branded near foe stops its
  // Regeneration for a day; one on the unbranded far foe does not.
  async cc_sanctioned(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "Hunter's Brand", targetEnemyId: scene.near.id }), "Hunter's Brand");
    const crit = async (foe) => {
      t.kit.freshTurn();
      t.kit.giveTurn(scene.holder.id);
      t.kit.place(foe.id, 5, 6);
      must(await t.kit.swing(scene.holder.id, foe.id, [20, 3, 3, 3, 3, 3, 3, 3, 3]), "the critical hit");
      const enemy = t.kit.enemy(foe.id);
      const meta = enemy.conditionMeta?.["regeneration stopped"] ?? null;
      return { stopped: enemy.conditions.includes("regeneration stopped"), day: (meta?.rounds ?? 0) >= 14400, marked: foeConditions(t, foe.id).includes("sanctioned execution") };
    };
    const branded = await crit(scene.near);
    eq(`${branded.stopped}/${branded.day}/${branded.marked}`, "true/true/true", "Regeneration stopped / for a day / the mark, after a critical hit on the branded foe");
    t.kit.place(scene.near.id, 9, 9);
    const plain = await crit(scene.far);
    eq(`${plain.stopped}/${plain.marked}`, "false/false", "Regeneration stopped / the mark, after a critical hit on an unbranded foe");
  },
};

export { conditionsOf, foeConditions, stripFeature, TRAINED };
