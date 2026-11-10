// Rows, known gaps and skips for the builder sweep's generators.
//
// A generator walks a table (classes, subclasses, species, backgrounds,
// option kinds, homebrew reference fields) and asks one question of each
// row. What fails today is named in KNOWN by row id and runs through the
// harness's gap(), so the suite is green today and fails the day the row
// starts passing; a row with no entry runs through test() and must pass. A
// row the generator cannot ask is named in SKIP with the reason, and counted.
//
//   const rows = sweepRows("test-enforce-sweep-builder-x", { KNOWN, SKIP });
//   await rows.row("class:wizard@20", async () => { ... });
//   rows.finish();
//
// SWEEP_DISCOVER=1 runs every row plainly and prints what failed, one line a
// row, for writing KNOWN from; it never passes for a real run.
import { suite } from "./enforce-harness.mjs";

export function expand(groups) {
  const known = {};
  for (const group of groups) {
    for (const id of group.rows) {
      if (known[id]) {
        throw new Error(`row "${id}" is in two known groups: ${known[id].group} and ${group.id}`);
      }
      known[id] = { group: group.id, rule: group.rule, where: group.where, severity: group.severity, note: group.note };
    }
  }
  return known;
}

export function sweepRows(name, { KNOWN = {}, SKIP = {} } = {}) {
  const { test, gap, finish } = suite(name);
  const discover = process.env.SWEEP_DISCOVER === "1";
  const walked = new Set();
  const skipped = [];
  const found = [];

  async function row(id, fn) {
    if (walked.has(id)) {
      await test(id, () => {
        throw new Error(`row id "${id}" walked twice`);
      });
      return;
    }
    walked.add(id);
    if (SKIP[id]) {
      skipped.push(id);
      return;
    }
    if (discover) {
      try {
        await fn();
      } catch (error) {
        const kind = error?.code === "ERR_ASSERTION" ? "ASSERT" : "THROW";
        found.push(id);
        console.log(`DISCOVER ${kind} ${id} :: ${String(error?.message ?? error).split("\n")[0].slice(0, 600)}${KNOWN[id] ? "" : " [NEW]"}`);
        if (kind === "THROW") console.log(String(error?.stack ?? "").split("\n").slice(1, 4).join("\n"));
      }
      return;
    }
    if (KNOWN[id]) {
      const { rule, where, severity, note } = KNOWN[id];
      await gap(id, { rule, where, severity, note }, fn);
    } else {
      await test(id, fn);
    }
  }

  function done() {
    console.log(`${name}: ${walked.size} rows walked, ${skipped.length} skipped${skipped.length ? ` (${skipped.join(", ")})` : ""}`);
    if (discover) {
      const stale = Object.keys(KNOWN).filter((id) => walked.has(id) && !found.includes(id));
      console.log(`DISCOVER ${found.length} rows failed; known rows now passing: ${stale.join(", ") || "none"}`);
      return;
    }
    // A known gap or a skip for a row the table no longer has is a stale
    // entry: the list must stay the true list.
    const missing = [...Object.keys(KNOWN), ...Object.keys(SKIP)].filter((id) => !walked.has(id));
    if (missing.length) {
      throw new Error(`${name}: KNOWN or SKIP names rows the generator did not walk: ${missing.join(", ")}`);
    }
    finish();
  }

  return { row, finish: done, test, gap };
}
