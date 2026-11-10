// The clause ledger of the slice `srd`, read and run.
//
// scripts/clauses/srd-classes.json, feats.json and species.json hold one entry
// per feature: the text's hash and its clauses, each `held` (a probe ran it),
// `gap` (a probe shows the engine does something else, or nothing ran it:
// read_only), `left` (the GM's, with the written reason) or `flavor`.
//
//   checkLedgers(test)       the ledgers against the texts and the suites:
//                            every row of the three registries has an entry,
//                            every hash is the text's, every clause is a piece
//                            of it, every sentence is covered, every probe
//                            named exists where the clause says it does.
//   runProbes(file, probes)  one probe suite: each probe the ledgers name in
//                            `file` runs as test() when its clauses are held
//                            and as gap() when they are gaps. A probe the
//                            ledgers do not name, or a name with no probe,
//                            fails the suite.
//
// No src/ import here: the probe suites import enforce-world.mjs themselves.
import fs from "node:fs";
import path from "node:path";
import { suite } from "./enforce-harness.mjs";
import {
  classFeatureTexts, featTexts, speciesTexts, sentencesOf, statesMechanic, covers, sha12,
} from "./sweep-clauses-srd-text.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const LEDGERS = {
  classes: "scripts/clauses/srd-classes.json",
  feats: "scripts/clauses/feats.json",
  species: "scripts/clauses/species.json",
};
const STATUSES = new Set(["held", "gap", "left", "flavor"]);

export function readLedger(which) {
  const file = path.join(ROOT, LEDGERS[which]);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

export function textsFor(which) {
  return which === "classes" ? classFeatureTexts() : which === "feats" ? featTexts() : speciesTexts();
}

// What a species entry's clauses must cover: every field of the row but its
// id and name, and each trait line on its own.
export function speciesUnits(row) {
  const units = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === "id" || key === "name") continue;
    if (key === "traits") {
      for (const trait of value) units.push(JSON.stringify(trait));
      continue;
    }
    units.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }
  return units;
}

export function unitsOf(which, text) {
  return which === "species" ? speciesUnits(text.row) : sentencesOf(text.text);
}

// "scripts/test-enforce-x.mjs: the title" -> [file, title]
export function probeParts(probe) {
  const at = String(probe ?? "").indexOf(": ");
  return at < 0 ? [String(probe ?? ""), ""] : [probe.slice(0, at), probe.slice(at + 2)];
}

const fileCache = new Map();
function sourceOf(file) {
  if (!fileCache.has(file)) {
    const full = path.join(ROOT, file);
    fileCache.set(file, fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null);
  }
  return fileCache.get(file);
}

// Whether the suite a clause names really holds the test or gap it names: the
// title (or gap id) as a string in the file. A title built from a template
// (`${type}: rage halves...`) is found by its fixed part.
export function probeExists(probe) {
  const [file, title] = probeParts(probe);
  const source = sourceOf(file);
  if (source === null) return `no file ${file}`;
  if (!title) return `no test named in ${probe}`;
  if (source.includes(title)) return null;
  const escaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (source.includes(escaped)) return null;
  return `${file} has no test or gap "${title.slice(0, 80)}"`;
}

// Every problem with one ledger, as lines. Empty when it is sound.
export function ledgerProblems(which) {
  const ledger = readLedger(which);
  const texts = textsFor(which);
  const problems = [];
  for (const [key, text] of texts) {
    const entry = ledger[key];
    if (!entry) {
      problems.push(`${key}: no ledger entry (a feature added since the ledger was written: split its text into clauses)`);
      continue;
    }
    if (entry.sha !== sha12(text.text)) {
      problems.push(`${key}: the text changed (ledger ${entry.sha}, now ${sha12(text.text)}): read it again and re-split its clauses`);
      continue;
    }
    if (entry.source !== text.source) problems.push(`${key}: source ${entry.source}, the text is in ${text.source}`);
    if (!Array.isArray(entry.clauses) || !entry.clauses.length) {
      problems.push(`${key}: no clauses`);
      continue;
    }
    for (const clause of entry.clauses) {
      const label = `${key}: "${String(clause.c).slice(0, 60)}"`;
      if (!STATUSES.has(clause.is)) problems.push(`${label}: status ${clause.is}`);
      if (!text.text.includes(clause.c)) problems.push(`${label}: not a piece of the text`);
      if (clause.is === "held" && (!clause.by || !clause.probe)) problems.push(`${label}: held needs by and probe`);
      if (clause.is === "gap" && !clause.probe && !clause.read_only) problems.push(`${label}: a gap needs a probe, or read_only with what stopped the run`);
      if (clause.is === "left" && !clause.why) problems.push(`${label}: left needs the written reason`);
      if (clause.probe) {
        // A gap another sweep recorded names that sweep's suite and its
        // generated gap id, which is built at run time: the file is checked.
        const missing = clause.recorded_by ? (sourceOf(probeParts(clause.probe)[0]) === null ? `no file ${probeParts(clause.probe)[0]}` : null) : probeExists(clause.probe);
        if (missing) problems.push(`${label}: ${missing}`);
      }
    }
    if (entry.tierOf) continue;
    for (const unit of unitsOf(which, text)) {
      if (!entry.clauses.some((clause) => covers(clause.c, unit))) {
        problems.push(`${key}: no clause covers "${unit.slice(0, 90)}"`);
      }
    }
  }
  for (const key of Object.keys(ledger)) {
    if (!texts.has(key)) problems.push(`${key}: in the ledger, no longer in the registry`);
  }
  return problems;
}

export function ledgerCounts(which) {
  const counts = { entries: 0, clauses: 0, held: 0, gap: 0, read_only: 0, left: 0, flavor: 0 };
  for (const entry of Object.values(readLedger(which))) {
    counts.entries += 1;
    for (const clause of entry.clauses ?? []) {
      counts.clauses += 1;
      counts[clause.is] += 1;
      if (clause.is === "gap" && clause.read_only) counts.read_only += 1;
    }
  }
  return counts;
}

// The probes the ledgers send to one suite file: id -> the clauses it runs.
export function probesNamedIn(suiteFile) {
  const out = new Map();
  for (const which of Object.keys(LEDGERS)) {
    for (const [key, entry] of Object.entries(readLedger(which))) {
      for (const clause of entry.clauses ?? []) {
        if (!clause.probe) continue;
        const [file, id] = probeParts(clause.probe);
        if (file !== suiteFile) continue;
        out.set(id, [...(out.get(id) ?? []), { key, entry, clause }]);
      }
    }
  }
  return out;
}

// Runs one probe suite off the ledgers. `probes` is id -> async fn that
// asserts what the clause promises. `skip` is id -> the written reason a
// probe does not run here (no content pack).
export async function runProbes(suiteFile, probes, { skip = {} } = {}) {
  const name = path.basename(suiteFile, ".mjs");
  const { test, gap, finish } = suite(name);
  const named = probesNamedIn(suiteFile);
  let skipped = 0;
  for (const [id, rows] of named) {
    const fn = probes[id];
    if (skip[id]) {
      skipped += 1;
      continue;
    }
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
    if (first.clause.is === "gap") {
      await gap(
        id,
        {
          rule: `"${rows.map((row) => row.clause.c).join('" / "')}" (${first.key}, ${first.entry.source})`,
          where: first.clause.where ?? "unknown",
          severity: first.clause.severity ?? "medium",
          ...(first.clause.note ? { note: first.clause.note } : {}),
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
  if (skipped) console.log(`${name}: skipped ${skipped}: ${Object.entries(skip).map(([id, why]) => `${id} (${why})`).join("; ")}`);
  finish();
}

export { sha12, sentencesOf, statesMechanic, covers };
