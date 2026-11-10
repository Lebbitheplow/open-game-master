// Every clause of every clause ledger (scripts/clauses/*.json) that names a
// probe names one that exists: the suite file is there, and the id, test title
// or row it names is written in that suite or a module it imports
// (scripts/lib/clause-probes.mjs probeProblems says how each shape is read). A
// ledger's own suite runs only the clauses that point at it, so a clause
// pointing at a file nobody wrote was run by nothing: 116 arcane clauses named
// warlock and bard suites that did not exist, 89 of them marked held.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { ledgerClauses, ledgerFiles, parseProbe, probeMissing, probeProblems } from "./lib/clause-probes.mjs";

const { test, finish } = suite("test-clause-probes");

await test("the check sees a missing suite file, a missing id and a missing row word, and passes the probes that exist", () => {
  assert.match(probeMissing({ file: "scripts/test-enforce-sweep-clauses-nobody.mjs", id: "x" }), /does not exist/);
  assert.match(probeMissing({ file: "scripts/test-enforce-sweep-clauses-arcane-wizard.mjs", id: "no-such-probe-anywhere" }), /has no probe/);
  assert.match(probeMissing({ file: "scripts/test-enforce-sweep-clauses-divine-druid.mjs", id: "druid::Starry Form#no-such-check" }, ["druid::Starry Form"]), /has no probe/);
  assert.equal(probeMissing({ file: "scripts/test-enforce-sweep-clauses-arcane-wizard.mjs", id: "ward-raise" }), null);
  assert.equal(probeMissing({ file: "scripts/test-enforce-sweep-clauses-divine-druid.mjs", id: "druid::Starry Form#2d8-at-10" }, ["druid::Starry Form"]), null);
  assert.deepEqual(
    parseProbe("scripts/test-a.mjs gap one-row [limits finding L1]; scripts/test-b.mjs: a title").map(({ file, kind, id }) => [file, kind, id]),
    [["scripts/test-a.mjs", "gap", "one-row"], ["scripts/test-b.mjs", ":", "a title"]],
  );
});

for (const file of ledgerFiles()) {
  await test(`scripts/clauses/${file}: every probe a clause names exists`, () => {
    assert.ok(ledgerClauses(file).length > 0, `no clauses read from ${file}`);
    const problems = probeProblems(file);
    assert.deepEqual(problems.map(({ key, c, is, why }) => `${key} [${is}] "${c.slice(0, 50)}": ${why}`), []);
  });
}

finish();
