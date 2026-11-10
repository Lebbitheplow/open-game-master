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

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-sorcerer.mjs", P);
