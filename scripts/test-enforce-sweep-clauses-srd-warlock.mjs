// The clause ledger's probes for the warlock's features (SRD 5.1) and the
// Fiend. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each clause that
// names it is staged. (The spells known, the invocations and the arcana are
// in test-enforce-sweep-clauses-srd-spells.mjs and -picks.mjs.)
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const fiend = (t, level, extra = {}) => t.hero({ class: "warlock", subclass: "The Fiend", level, ...extra, abilities: { cha: 16, ...(extra.abilities ?? {}) } });
const P = {};

P["warlock.dark-ones-own-luck.rest"] = async () => {
  const t = await rig.table();
  const who = fiend(t, 6);
  assert.deepEqual(t.sheet(who).resources.dark_ones_own_luck, { max: 1, used: 0 }, "one use");
  t.patch(who, { resources: { ...t.sheet(who).resources, dark_ones_own_luck: { max: 1, used: 1 } } });
  const spent = await t.use(who, "Dark One's Own Luck");
  assert.equal(spent.ok, false, "a second use before a rest");
  assert.equal((await t.rest("short")).ok, true);
  assert.equal(t.used(who, "dark_ones_own_luck"), 0, "a short rest gives the use back");
};

P["warlock.fiendish-resilience.magical-weapons"] = async () => {
  const t = await rig.table();
  const who = fiend(t, 10);
  const chosen = await t.use(who, "Fiendish Resilience", { variant: "slashing" });
  assert.equal(chosen.ok, true, chosen.error);
  const hit = async (args) => {
    const before = t.sheet(who).currentHp;
    const out = await t.damage(who, 10, "slashing", args);
    assert.equal(out.ok, true, out.error);
    return before - t.sheet(who).currentHp;
  };
  assert.equal(await hit({}), 5, "the chosen type is resisted");
  assert.equal(await hit({ magical: true }), 10, "a magical weapon's damage was halved");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-warlock.mjs", P);
