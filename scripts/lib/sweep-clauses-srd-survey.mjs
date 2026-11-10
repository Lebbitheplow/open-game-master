// runProbes (sweep-clauses-srd.mjs), or with SWEEP_CLAUSES_SURVEY=1 every
// probe run once and its outcome printed, nothing failed: the way a new
// probe's first run is read before the ledger gives it a verdict.
import { runProbes, probesNamedIn } from "./sweep-clauses-srd.mjs";

export async function runOrSurvey(file, probes, options = {}) {
  if (!process.env.SWEEP_CLAUSES_SURVEY) return runProbes(file, probes, options);
  const named = probesNamedIn(file);
  for (const [id, fn] of Object.entries(probes)) {
    const rows = named.get(id) ?? [];
    const verdict = rows.length ? rows[0].clause.is : "UNNAMED";
    try {
      await fn();
      console.log(`  PASS ${id} [${verdict}]`);
    } catch (error) {
      const kind = error?.code === "ERR_ASSERTION" ? "FAIL" : "THREW";
      console.log(`  ${kind} ${id} [${verdict}]: ${String(kind === "THREW" ? error?.stack : error?.message).split("\n").slice(0, kind === "THREW" ? 3 : 1).join(" | ").slice(0, 500)}`);
    }
  }
  console.log(`${file}: survey of ${Object.keys(probes).length} probes`);
}
