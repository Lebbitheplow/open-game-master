// The "spends" sweep's own bookkeeping: every row of the tables is walked by
// exactly one of its suites, and every line of what is known, ruled or
// skipped (scripts/lib/sweep-spends-known.mjs) names a row that exists.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openSpendsRig } from "./lib/sweep-spends.mjs";
import { FAMILIES, KNOWN, RULINGS, SKIP, WHERE, tableRows } from "./lib/sweep-spends-run.mjs";

const { test, finish } = suite("test-enforce-sweep-spends-tables");
const rig = await openSpendsRig();
const rows = await tableRows(rig);
const ids = new Set(rows.map((row) => row.id));

await test("Every counter, authored spend and authored reaction is a row, each under an id of its own.", () => {
  assert.equal(ids.size, rows.length, "two rows share an id");
  assert.equal(rows.filter((row) => row.kind === "counter").length, rig.resources.RESOURCE_DEFS.length);
  const authored = rig.authored.authoredRows();
  const spends = authored.reduce((sum, row) => sum + (row.entry.spends?.length ?? 0), 0);
  const reactions = authored.reduce((sum, row) => sum + (row.entry.reactions?.length ?? 0), 0);
  // The genre classes' spends and reactions are rows too, on top of the subclass table's.
  assert.ok(rows.filter((row) => row.kind === "spend").length >= spends, "an authored spend has no row");
  assert.ok(rows.filter((row) => row.kind === "reaction").length >= reactions, "an authored reaction has no row");
});

await test("Each row is walked by exactly one suite.", () => {
  for (const row of rows) {
    const walkers = Object.entries(FAMILIES).filter(([, pick]) => pick(row)).map(([name]) => name);
    assert.equal(walkers.length, 1, `${row.id} is walked by ${walkers.join(", ") || "no suite"}`);
  }
});

await test("Every known, ruled and skipped line names a row of the tables, and a code the sweep gives.", () => {
  for (const [label, map] of [["KNOWN", KNOWN], ["RULINGS", RULINGS], ["SKIP", SKIP]]) {
    const stale = Object.keys(map).filter((id) => !ids.has(id));
    assert.deepEqual(stale, [], `${label} names rows the tables no longer hold`);
  }
  for (const [id, codes] of [...Object.entries(KNOWN), ...Object.entries(RULINGS)]) {
    for (const code of Object.keys(codes)) assert.ok(WHERE[code], `${id}: no code called ${code}`);
    assert.ok(!SKIP[id], `${id} is skipped and also listed as walked`);
  }
  for (const [id, codes] of Object.entries(KNOWN)) {
    for (const [code, entry] of Object.entries(codes)) {
      assert.ok(["high", "medium", "low"].includes(entry.severity), `${id} ${code}: no severity`);
      assert.ok(!RULINGS[id]?.[code], `${id} ${code} is both a gap and a ruling`);
    }
  }
  for (const [id, reason] of Object.entries(SKIP)) assert.ok(reason.length > 30, `${id}: a skip needs its reason written`);
});

const count = (map) => Object.values(map).reduce((sum, codes) => sum + Object.keys(codes).length, 0);
console.log(`test-enforce-sweep-spends-tables: ${rows.length} rows (${rows.filter((row) => row.kind === "counter").length} counters, ${rows.filter((row) => row.kind === "spend").length} authored spends, ${rows.filter((row) => row.kind === "reaction").length} authored reactions); ${Object.keys(SKIP).length} skipped with a written reason; ${count(KNOWN)} known gaps and ${count(RULINGS)} codes under a written ruling`);
rig.close();
finish();
