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

// Circle Spells' seven tables: a Land druid who chose the terrain has each
// row's spells at its level and not before (src/lib/srd/features.ts
// subclassSpellsFor, the list the sheet adds always prepared). The rows are
// read from the rulebook's own text, the clauses the ledger holds.
P["druid.circle-spells.tables"] = async () => {
  const { subclassSpellsFor } = await import("../src/lib/srd/features.ts");
  const fs = await import("node:fs");
  const ledger = JSON.parse(fs.readFileSync(new URL("./clauses/srd-classes.json", import.meta.url), "utf8"))["druid::Circle Spells"];
  const wrong = [];
  let terrain = null;
  let rows = 0;
  for (const { c } of ledger.clauses) {
    const title = /^\*\*Table- (\w+) Circle Spells\*\*$/.exec(c);
    if (title) {
      terrain = title[1];
      continue;
    }
    const row = /^\| (\d+)\w\w\s+\| ([^|]+?)\s*\|\|?$/.exec(c);
    if (!row || !terrain) continue;
    rows += 1;
    const level = Number(row[1]);
    const features = [{ name: `Circle Spells (${terrain})` }];
    const at = subclassSpellsFor("druid", "Circle of the Land", level, undefined, features).map((name) => name.toLowerCase());
    const before = subclassSpellsFor("druid", "Circle of the Land", level - 1, undefined, features).map((name) => name.toLowerCase());
    for (const spell of row[2].split(",").map((name) => name.trim().toLowerCase())) {
      if (!at.includes(spell)) wrong.push(`${terrain} ${level}: no ${spell}`);
      if (before.includes(spell)) wrong.push(`${terrain} ${level - 1}: ${spell} early`);
    }
  }
  assert.equal(rows, 28, "the staging: the rulebook's seven tables of four rows");
  assert.deepEqual(wrong, [], "Circle Spells against the rulebook's tables");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-druid.mjs", P);
