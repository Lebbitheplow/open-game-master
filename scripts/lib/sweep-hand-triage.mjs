// Reads a dump of the Hand sweep's rows (SWEEP_HAND_DUMP) and
//   - prints the failures grouped by cause (sweep-hand-causes.mjs), and the
//     failures no cause claims, grouped by what the engine said;
//   - with --known <file>, writes the known rows by class
//     (scripts/lib/sweep-hand-known.mjs);
//   - with --findings <file>, appends one finding per cause as a JSON line.
//
//   node scripts/lib/sweep-hand-triage.mjs /tmp/dump.jsonl [--known file] [--findings file]
import fs from "node:fs";
import { CAUSES, causeOf } from "./sweep-hand-causes.mjs";

const args = process.argv.slice(2);
const file = args[0];
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const judged = rows.filter((row) => !row.skip);
const failing = judged.filter((row) => !row.ok);

const tally = {};
for (const row of judged) {
  tally[row.prop] ??= { ok: 0, fail: 0 };
  tally[row.prop][row.ok ? "ok" : "fail"] += 1;
}
console.log(`${rows.length} rows, ${judged.length} judged, ${failing.length} failing, ${rows.length - judged.length} skipped, ${new Set(rows.map((row) => `${row.classId}/${row.build}`)).size} characters`);
console.log(JSON.stringify(tally));

const byCause = new Map();
const loose = new Map();
for (const row of failing) {
  const cause = causeOf(row);
  if (cause) {
    const group = byCause.get(cause.id) ?? { rows: [], cards: new Set(), builds: new Set(), states: new Set(), classes: new Set() };
    group.rows.push(row);
    group.cards.add(`${row.card}${row.variant}`);
    group.builds.add(`${row.classId}/${row.build}`);
    group.states.add(row.state);
    group.classes.add(row.classId);
    byCause.set(cause.id, group);
    continue;
  }
  const said = row.msg.replace(/\b(Goblin \d|Hero|Ally|Mage|Fallen)\b/g, "X").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "ID").slice(0, 240);
  const key = `${row.prop} ${row.card}${row.variant} :: ${said}`;
  const group = loose.get(key) ?? { count: 0, builds: new Set(), states: new Set() };
  group.count += 1;
  group.builds.add(`${row.classId}/${row.build}`);
  group.states.add(row.state);
  loose.set(key, group);
}
for (const cause of CAUSES) {
  const group = byCause.get(cause.id);
  console.log(`\n[${cause.severity}] ${cause.id}: ${group ? `${group.rows.length} rows, ${group.cards.size} cards, ${group.builds.size} characters, states ${[...group.states].join(",")}` : "NO ROWS"}`);
  if (group) console.log(`   ${[...group.cards].slice(0, 10).join(", ")}${group.cards.size > 10 ? ` (+${group.cards.size - 10})` : ""}\n   e.g. ${group.rows[0].id}: ${group.rows[0].msg.slice(0, 200)}`);
}
console.log(`\nNO CAUSE: ${loose.size} groups`);
for (const [key, group] of [...loose].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${key}\n     x${group.count} builds=${[...group.builds].slice(0, 3).join(", ")}${group.builds.size > 3 ? ` (+${group.builds.size - 3})` : ""} states=${[...group.states].join(",")}`);
}
const skips = {};
for (const row of rows.filter((entry) => entry.skip)) skips[row.skip] = (skips[row.skip] ?? 0) + 1;
console.log(`\nSKIPS ${JSON.stringify(skips, null, 1)}`);

// ---- the known rows ----
//
// For one card and one property in one suite: "*|*" when every row fails;
// else the states in which every character holding the card fails, as one
// entry for all of them, and each character's remaining failing states as an
// entry of its own ("*" when that is every state it was judged in).
function knownRows(suiteName) {
  const mine = judged.filter((row) => row.suite === suiteName);
  const byCard = new Map();
  for (const row of mine) {
    const key = `${row.prop}|${row.card}${row.variant}`;
    const list = byCard.get(key) ?? [];
    list.push(row);
    byCard.set(key, list);
  }
  const out = [];
  for (const [, list] of byCard) {
    const failed = (row) => !row.ok && causeOf(row);
    const bad = list.filter(failed);
    if (!bad.length) continue;
    const { prop, card: cardId, variant } = list[0];
    const tail = `${cardId}${variant}`;
    for (const cause of new Set(bad.map((row) => causeOf(row).id))) {
      const ofCause = (row) => failed(row) && causeOf(row).id === cause;
      if (list.every(ofCause)) {
        out.push([`${prop}|*|*|${tail}`, cause]);
        continue;
      }
      const covered = new Set();
      const everyone = [...new Set(list.map((row) => row.state))].filter((state) => {
        const inState = list.filter((row) => row.state === state);
        return inState.every(ofCause) && new Set(inState.map((row) => row.build)).size > 1;
      });
      if (everyone.length) {
        out.push([`${prop}|*|${everyone.join(",")}|${tail}`, cause]);
        for (const row of list) if (everyone.includes(row.state)) covered.add(row.id);
      }
      for (const build of new Set(list.filter(ofCause).map((row) => row.build))) {
        const whole = list.filter((row) => row.build === build);
        const left = whole.filter((row) => ofCause(row) && !covered.has(row.id));
        if (!left.length) continue;
        const states = whole.every(ofCause) && !whole.some((row) => covered.has(row.id)) ? "*" : left.map((row) => row.state).join(",");
        out.push([`${prop}|${build}|${states}|${tail}`, cause]);
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// One file per class (or extras group), so none grows past a screenful of
// scrolling, and an index that joins them.
const knownFile = option("--known");
if (knownFile) {
  const suites = [...new Set(rows.map((row) => row.suite))].sort();
  const groupOf = (suiteName) => suiteName.replace(/^test-enforce-sweep-hand-/, "").replace(/-[a-d]$/, "");
  const groups = [...new Set(suites.map(groupOf))];
  const stem = knownFile.replace(/\.mjs$/, "");
  const base = stem.split("/").pop();
  let count = 0;
  for (const group of groups) {
    const lines = [
      `// The rows of the Hand sweep that fail today: ${group}. See ${base}.mjs.`,
      "// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.",
      "export const ROWS = {",
    ];
    for (const suiteName of suites.filter((entry) => groupOf(entry) === group)) {
      const list = knownRows(suiteName);
      count += list.length;
      lines.push(`  ${JSON.stringify(suiteName)}: [`);
      for (const [key, cause] of list) lines.push(`    [${JSON.stringify(key)}, ${JSON.stringify(cause)}],`);
      lines.push("  ],");
    }
    lines.push("};", "");
    fs.writeFileSync(`${stem}-${group}.mjs`, lines.join("\n"));
  }
  const index = [
    "// The rows of the Hand sweep that fail today, by suite (scripts/lib/sweep-hand-run.mjs",
    "// sweepSuite): KNOWN[suite][rowId] = { rule, where, severity, note }.",
    "//",
    "// A row id is `${prop}|${character}|${states}|${card.id}${variant}`. The character is",
    "// \"*\" for a row that fails for every character of the suite holding the card; the",
    "// states are \"*\" or a list. Each row names its cause in sweep-hand-causes.mjs, which",
    "// holds the rule, where the fix lies and the severity.",
    "//",
    "// WRITTEN, with the per-class files beside it, by",
    "//   node scripts/lib/sweep-hand-triage.mjs <dump> --known scripts/lib/sweep-hand-known.mjs",
    "// from a full run with SWEEP_HAND_DUMP=<dump> set. A gap that closes fails its suite:",
    "// write the files again from a fresh dump (and drop the cause when its last row is gone).",
    'import { CAUSE_BY_ID } from "./sweep-hand-causes.mjs";',
    ...groups.map((group, at) => `import { ROWS as ROWS_${at} } from "./${base}-${group}.mjs";`),
    "",
    `const ROWS = { ${groups.map((group, at) => `...ROWS_${at}`).join(", ")} };`,
    "",
    "export const KNOWN = Object.fromEntries(",
    "  Object.entries(ROWS).map(([suiteName, list]) => [",
    "    suiteName,",
    "    Object.fromEntries(",
    "      list.map(([key, id]) => {",
    "        const cause = CAUSE_BY_ID[id];",
    "        if (!cause) throw new Error(`sweep-hand-known: no cause \"${id}\" for ${key}`);",
    "        return [key, { cause: id, rule: cause.rule, where: cause.where, severity: cause.severity, note: cause.note }];",
    "      }),",
    "    ),",
    "  ]),",
    ");",
    "",
  ];
  fs.writeFileSync(knownFile, index.join("\n"));
  console.log(`\nwrote ${count} known rows to ${stem}-<group>.mjs (${groups.length} files) and their index ${knownFile}`);
}

const findingsFile = option("--findings");
if (findingsFile) {
  const lines = [];
  for (const cause of CAUSES) {
    const group = byCause.get(cause.id);
    if (!group) continue;
    const sample = group.rows[0];
    const suites = [...group.classes].sort().map((classId) => `scripts/test-enforce-sweep-hand-${classId}*.mjs`).slice(0, 4).join(", ");
    lines.push(JSON.stringify({
      id: cause.id,
      severity: cause.severity,
      kind: cause.kind,
      area: "hand",
      rule: cause.rule,
      observed: `${group.rows.length} rows, ${group.cards.size} cards, ${group.builds.size} characters (states: ${[...group.states].join(", ")}). ${sample.name}: ${sample.msg}${cause.note ? ` ${cause.note}` : ""}`.slice(0, 1200),
      paths: cause.paths ?? "",
      where: cause.where,
      repro: `${suites}${group.classes.size > 4 ? ", ..." : ""}; the gaps whose rows name cause ${cause.id} (scripts/lib/sweep-hand-known-*.mjs), e.g. the row ${sample.id} of ${sample.suite}; one row by eye: node scripts/lib/sweep-hand-probe.mjs ${sample.classId} "${sample.build.split("@")[0]}" ${sample.state} "${sample.card}"`,
      fix_hint: cause.fix_hint ?? "",
      files: cause.files ?? [],
      read_only: false,
      ruling: null,
      pinned: cause.pinned ?? null,
      in_flight_pr: null,
    }));
  }
  fs.appendFileSync(findingsFile, lines.join("\n") + "\n");
  console.log(`appended ${lines.length} findings to ${findingsFile}`);
}
