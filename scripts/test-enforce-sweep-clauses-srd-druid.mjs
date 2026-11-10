// The clause ledger's probes for the druid (SRD 5.1) and the Circle of the
// Land. The clause text and the verdict live in scripts/clauses/srd-classes.json;
// this file holds how each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const druid = (t, level, extra = {}) => t.hero({ class: "druid", level, ...extra, abilities: { wis: 16, ...(extra.abilities ?? {}) } });
const P = {};

P["druid.wild-shape.uses"] = async () => {
  const t = await rig.table();
  const who = druid(t, 2);
  const id = Object.keys(t.sheet(who).resources ?? {}).find((key) => /wild.?shape/i.test(key));
  assert.ok(id, `no Wild Shape counter: ${Object.keys(t.sheet(who).resources ?? {}).join(", ")}`);
  assert.equal(t.max(who, id), 2, "twice");
  t.patch(who, { resources: { ...t.sheet(who).resources, [id]: { ...t.sheet(who).resources[id], used: 2 } } });
  const out = await t.rest("short");
  assert.equal(out.ok, true, out.error);
  assert.equal(t.used(who, id), 0, "a short rest gives the uses back");
};

P["druid.natures-ward.poison"] = async () => {
  const t = await rig.table();
  const who = druid(t, 10, { subclass: "Circle of the Land" });
  const before = t.sheet(who).currentHp;
  const hurt = await t.damage(who, 10, "poison");
  assert.equal(hurt.ok, true, hurt.error);
  assert.equal(t.sheet(who).currentHp, before, `poison damage reached a 10th-level Land druid: ${before - t.sheet(who).currentHp}`);
  const poisoned = await t.condition(who, "poisoned");
  assert.ok(!t.has(who, "poisoned"), `the poisoned condition landed: ${poisoned.ok ? "accepted" : poisoned.error}`);
};

P["druid.natures-ward.fey-charm"] = async () => {
  const t = await rig.table();
  const who = druid(t, 10, { subclass: "Circle of the Land" });
  const control = druid(t, 10);
  const [foe] = await t.fight([who, control], { foe: { type: "fey" } });
  await t.condition(control, "charmed", { sourceEnemyId: foe.id });
  assert.ok(t.has(control, "charmed"), "the staging: a druid of no circle is not charmed either");
  const out = await t.condition(who, "charmed", { sourceEnemyId: foe.id });
  assert.ok(!t.has(who, "charmed"), `a fey's charm landed on a 10th-level Land druid: ${out.ok ? "accepted" : out.error}`);
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-druid.mjs", P);
