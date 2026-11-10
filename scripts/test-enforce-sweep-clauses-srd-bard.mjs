// The clause ledger's probes for the bard (SRD 5.1) and the College of Lore.
// The clause text and the verdict live in scripts/clauses/srd-classes.json;
// this file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const bard = (t, level, extra = {}) => t.hero({ class: "bard", level, ...extra, abilities: { cha: 16, ...(extra.abilities ?? {}) } });
const ally = (t) => t.hero({ class: "fighter", level: 5 });
const P = {};

// The fight: the bard has the floor at (5,5), the ally beside at (4,5).
async function inspire(t, who, target, args = {}) {
  return t.use(who, "Bardic Inspiration", { targetCharacterId: target.id, ...args });
}

P["bard.bardic-inspiration.bonus-action"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  const out = await inspire(t, who, friend);
  assert.equal(out.ok, true, out.error);
  assert.equal(t.budget().bonusUsed, true, "the bonus action");
  assert.equal(t.budget().actionUsed ?? false, false);
};

P["bard.bardic-inspiration.other-than-you"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  await t.fight([who]);
  const out = await inspire(t, who, who);
  assert.equal(out.ok, false, "the bard gave the die to themselves");
  assert.equal(t.used(who, "bardic_inspiration"), 0, "the refused self-inspiration spent a use");
};

P["bard.bardic-inspiration.within-60-feet"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  t.kit.place(friend.id, 19, 14);
  const out = await inspire(t, who, friend);
  assert.equal(out.ok, false, "an ally 70 feet away was inspired");
};

P["bard.bardic-inspiration.uses"] = async () => {
  const t = await rig.table();
  const ids = (who) => Object.keys(t.sheet(who).resources ?? {}).find((id) => /inspiration/i.test(id));
  for (const [cha, uses] of [[16, 3], [8, 1], [20, 5]]) {
    const who = bard(t, 1, { abilities: { cha } });
    const id = ids(who);
    assert.ok(id, `no Bardic Inspiration counter: ${Object.keys(t.sheet(who).resources ?? {}).join(", ")}`);
    assert.equal(t.max(who, id), uses, `Charisma ${cha}`);
  }
};

P["bard.bardic-inspiration.one-die"] = async () => {
  const t = await rig.table();
  const who = bard(t, 1);
  const friend = ally(t);
  await t.fight([who, friend]);
  assert.equal((await inspire(t, who, friend)).ok, true);
  t.freshTurn();
  const second = await inspire(t, who, friend);
  assert.equal(second.ok, false, "a creature that holds a Bardic Inspiration die was given a second");
};

P["bard.bonus-proficiencies-lore.three-skills"] = async () => {
  const training = await import("../src/lib/srd/subclass-training.ts");
  const grants = training.subclassGrants([{ id: "bard", level: 3, subclass: "College of Lore" }]);
  const grant = grants.find((entry) => /bonus proficiencies/i.test(entry.name));
  assert.ok(grant, `no training grant for Bonus Proficiencies: [${grants.map((entry) => entry.name).join(", ")}]`);
  assert.equal(grant.spec.skills, 3, JSON.stringify(grant.spec).slice(0, 200));
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-bard.mjs", P);
