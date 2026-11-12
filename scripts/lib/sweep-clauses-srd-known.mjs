// runProbes (sweep-clauses-srd.mjs) with a suite's own KNOWN map: a probe
// whose clause the ledger calls held, and which a run shows is a gap, runs as
// a gap() here until the ledger entry is turned to gap (the ledgers are in a
// commit this suite's author may not edit). Each KNOWN entry says so in the
// suite's output, so the ledger line to change is named on every run.
//
// A KNOWN entry for a probe the ledger already calls a gap, or names no
// clause, fails the suite: the map holds only what the ledger has wrong.
import path from "node:path";
import { suite } from "./enforce-harness.mjs";
import { probesNamedIn } from "./sweep-clauses-srd.mjs";

export async function runProbesKnown(suiteFile, probes, known = {}) {
  const name = path.basename(suiteFile, ".mjs");
  const { test, gap, finish } = suite(name);
  const named = probesNamedIn(suiteFile);
  for (const [id, rows] of named) {
    const fn = probes[id];
    if (!fn) {
      await test(`${id} (named by the ledger, missing from the suite)`, () => {
        throw new Error(`the ledger sends ${rows[0].key} to probe ${id}, which ${suiteFile} does not define`);
      });
      continue;
    }
    const kinds = new Set(rows.map((row) => row.clause.is));
    if (kinds.size > 1) {
      await test(`${id} (one probe, two verdicts)`, () => {
        throw new Error(`probe ${id} is named by clauses that are ${[...kinds].join(" and ")}: split it`);
      });
      continue;
    }
    const first = rows[0];
    const over = known[id];
    if (over && first.clause.is === "gap") {
      await test(`${id} (KNOWN, and the ledger already calls it a gap)`, () => {
        throw new Error(`drop ${id} from the suite's KNOWN map: the ledger's clause is a gap now`);
      });
      continue;
    }
    if (first.clause.is === "gap" || over) {
      const meta = over ?? first.clause;
      if (over) console.log(`${name}: ${id} runs as a gap; the ledger calls "${first.clause.c}" (${first.key}) held, and it is not: turn it to gap`);
      await gap(
        id,
        {
          rule: `"${rows.map((row) => row.clause.c).join('" / "')}" (${first.key}, ${first.entry.source})`,
          where: meta.where ?? "unknown",
          severity: meta.severity ?? "medium",
          ...(meta.note ? { note: meta.note } : {}),
        },
        fn,
      );
    } else {
      await test(id, fn);
    }
  }
  for (const id of Object.keys(probes)) {
    if (!named.has(id)) {
      await test(`${id} (a probe no clause names)`, () => {
        throw new Error(`probe ${id} is in ${suiteFile} and no ledger clause names it`);
      });
    }
  }
  for (const id of Object.keys(known)) {
    if (!named.has(id)) {
      await test(`${id} (KNOWN, and no ledger clause names it)`, () => {
        throw new Error(`the suite's KNOWN map holds ${id}, which no ledger clause sends to ${suiteFile}`);
      });
    }
  }
  finish();
}
