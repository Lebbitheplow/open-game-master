// The clause ledger's probes for the sorcerer (SRD 5.1) and the Draconic
// Bloodline. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const options = await import("../src/lib/srd/options.ts");
const P = {};

P["sorcerer.draconic-resilience.ac"] = async () => {
  const t = await rig.table();
  const who = t.hero({ class: "sorcerer", subclass: "Draconic Bloodline", level: 1, equipment: [], abilities: { dex: 14 } });
  assert.equal(t.ac(who), 13 + 2, "no armor: 13 + Dexterity");
};

P["sorcerer.metamagic.heightened"] = async () => {
  const t = await rig.table();
  const who = t.hero({
    class: "sorcerer", level: 5, abilities: { cha: 18 },
    spellcasting: { ability: "cha", slots: slots(4, 3, 2), prepared: [], known: ["Hold Person"], cantrips: [] },
  });
  t.patch(who, { features: [...t.sheet(who).features, { name: options.optionFeatureName("metamagic", "Heightened Spell"), source: "class" }] });
  const [foe] = await t.fight([who]);
  const spent = await t.use(who, "sorcery_points", { variant: "Heightened Spell" });
  assert.equal(spent.ok, true, spent.error);
  const out = await t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Hold Person", saveAbility: "wis", level: 2 }, [18, 2]);
  assert.equal(out.ok, true, out.error);
  const d20s = out.rolled.filter((die) => die.sides === 20).length;
  assert.equal(d20s, 2, `after Heightened Spell (3 points spent) the creature's first save is rolled with ${d20s} d20`);
};

const sorcerer = (t, picks, extra = {}) => {
  const who = t.hero({
    class: "sorcerer", level: 5, abilities: { cha: 18 }, equipment: [{ name: "Component pouch", qty: 1 }],
    spellcasting: { ability: "cha", slots: slots(4, 3, 2), prepared: [], known: ["Hold Person"], cantrips: [] }, ...extra,
  });
  t.patch(who, { features: [...t.sheet(who).features, ...picks.map((pick) => ({ name: options.optionFeatureName("metamagic", pick), source: "class" }))] });
  return who;
};
const pointsUsed = (t, who) => t.sheet(who).resources.sorcery_points.used;

P["sorcerer.metamagic.one-option"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Heightened Spell", "Subtle Spell", "Empowered Spell"]);
  await t.fight([who]);
  const first = await t.use(who, "sorcery_points", { variant: "Heightened Spell" });
  assert.equal(first.ok, true, first.error);
  assert.equal(pointsUsed(t, who), 3);
  const second = await t.use(who, "sorcery_points", { variant: "Subtle Spell" });
  assert.match(String(second.error), /one Metamagic option/, "a second option was paid on one spell");
  assert.equal(pointsUsed(t, who), 3, "the refused option spent points");
  // "even if you have already used a different Metamagic option"
  const empowered = await t.use(who, "sorcery_points", { variant: "Empowered Spell" });
  assert.equal(empowered.ok, true, `Empowered Spell beside another option: ${empowered.error}`);
  assert.equal(pointsUsed(t, who), 4);
};

P["sorcerer.metamagic.subtle"] = async () => {
  const t = await rig.table();
  const who = sorcerer(t, ["Subtle Spell"]);
  const [foe] = await t.fight([who]);
  t.patch(who, { conditions: ["silenced"] });
  const cast = () => t.invoke("cast_at_enemy", { characterId: who.id, targetEnemyId: foe.id, spell: "Hold Person", saveAbility: "wis", level: 2 }, [18]);
  const mute = await cast();
  assert.match(String(mute.error), /verbal/, "the staging: a silenced sorcerer cannot speak Hold Person");
  const spent = await t.use(who, "sorcery_points", { variant: "Subtle Spell" });
  assert.equal(spent.ok, true, spent.error);
  const subtle = await cast();
  assert.equal(subtle.ok, true, `Hold Person cast with no words: ${subtle.error}`);
  // The point bought one spell.
  t.freshTurn();
  const again = await cast();
  assert.match(String(again.error), /verbal/, "Subtle Spell lasted past the spell it was paid for");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-sorcerer.mjs", P);
