// Appends one finding of the builder sweep to the study's findings file, in
// the shape the brief asks for. Run by hand while a suite is being written:
//
//   node scripts/lib/sweep-builder-finding.mjs '<json>'
//
// A finding whose id is already in the file replaces the earlier line.
import fs from "node:fs";

const FILE = process.env.SWEEP_FINDINGS ?? "/tmp/odm-gapstudy/findings/builder.jsonl";
const SHAPE = {
  id: "", severity: "low", kind: "builder", area: "", rule: "", observed: "", paths: "", where: "", repro: "",
  fix_hint: "", files: [], read_only: false, ruling: null, pinned: null, in_flight_pr: null,
};

const input = JSON.parse(process.argv[2] ?? fs.readFileSync(0, "utf8"));
const lines = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
for (const finding of Array.isArray(input) ? input : [input]) {
  const row = { ...SHAPE, ...finding };
  const at = lines.findIndex((line) => line.id === row.id);
  if (at >= 0) lines[at] = row;
  else lines.push(row);
}
fs.writeFileSync(FILE, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
console.log(`${lines.length} findings in ${FILE}`);
