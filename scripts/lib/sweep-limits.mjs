// The runner the scripts/test-enforce-sweep-limits-*.mjs suites share.
//
// Those suites walk a LIST, not a table: the "Known limits", "Noticed and left
// alone" and "Not in this PR" sections of the pull requests merged in the week
// of 2026-11-01, and the `siblings` each classified defect named. Every named
// leftover is one row here, and a row is run, never read:
//
//   - still true in this tree: the row has an entry in KNOWN and runs through
//     gap(), so the suite is green today and fails the day the limit closes;
//   - since fixed: the row runs through test() and holds the fix;
//   - a written ruling: the row has an entry in RULING (where it is written)
//     and runs through test(), pinning what was ruled so a change is noticed;
//   - not reachable from a suite (a browser, a live model): an entry in SKIP
//     with the reason, counted and printed, never silent.
//
// A row that fails with no KNOWN entry fails the suite. A KNOWN, RULING or
// SKIP entry that names no row fails it too, so the three maps cannot rot.
import { suite } from "./enforce-harness.mjs";

export function limitsSuite(name, { KNOWN = {}, RULING = {}, SKIP = {} } = {}) {
  const { test, gap, finish } = suite(name);
  const seen = new Set();
  const tally = { rows: 0, fixed: 0, open: 0, ruling: 0, skipped: 0 };
  const stale = [];

  // meta = { pr, limit, rule }
  //   pr     the pull request whose body named the leftover
  //   limit  the leftover, as that body worded it
  //   rule   the sentence of the rule or feature text it is about
  async function row(id, meta, fn) {
    if (seen.has(id)) {
      await test(`${id}: a row id used twice`, () => {
        throw new Error(`row "${id}" is used twice in ${name}`);
      });
      return;
    }
    seen.add(id);
    tally.rows += 1;
    if (SKIP[id]) {
      tally.skipped += 1;
      console.log(`  SKIP ${id} (#${meta.pr}): ${SKIP[id]}`);
      return;
    }
    if (KNOWN[id]) {
      tally.open += 1;
      await gap(id, { rule: meta.rule, where: KNOWN[id].where, severity: KNOWN[id].severity, note: KNOWN[id].note }, fn);
      return;
    }
    const label = `${id} (#${meta.pr}): ${meta.limit}`;
    if (RULING[id]) {
      tally.ruling += 1;
      await test(`${label} [ruling: ${RULING[id]}]`, fn);
      return;
    }
    await test(label, async () => {
      await fn();
      tally.fixed += 1;
    });
  }

  function done() {
    for (const [map, title] of [[KNOWN, "KNOWN"], [RULING, "RULING"], [SKIP, "SKIP"]]) {
      for (const id of Object.keys(map)) {
        if (!seen.has(id)) {
          stale.push(`${title}["${id}"] names no row`);
        }
      }
    }
    console.log(
      `${name}: ${tally.rows} named leftovers walked: ${tally.fixed} since fixed, ${tally.open} still open, ${tally.ruling} rulings, ${tally.skipped} skipped`,
    );
    if (stale.length) {
      throw new Error(`${name}: ${stale.join("; ")}`);
    }
    finish();
  }

  return { row, test, gap, finish: done, tally };
}
