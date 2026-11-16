// Every file that still puts a roll on record by hand is on a ledger
// (scripts/roll-record-sites.json), with how many times it does each of the
// three things by hand and which family of sites it moves with.
//
// A roll on record is stored, sent to the table, added to the cards of the
// turn it was made in, and says who rolled it and how. One function does all
// four: recordRoll (src/lib/dm/roll-record.ts). A site that does them by hand
// can skip one, and the one usually skipped is the turn: the roll is stored
// and thrown on the dice stage, and the chronicle never shows its card
// (issue #915: Turn the Tide, Balm of Peace, Rally, a rest's hit dice, an
// opportunity attack). By hand is:
//
//   store  insertRoll(...)
//   send   a publish of "roll_result"
//   join   rollIds.push(...)
//
// A new one fails here until it goes through recordRoll. One moved onto
// recordRoll is struck off, so the counts only go down: the ledger's `total`
// is their sum, and a pull request that raises it says why in its diff.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");
const ledgerPath = path.join(import.meta.dirname, "roll-record-sites.json");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

// The door itself, and the store it writes through.
// And the turn store, which keeps the rolls its stored row lists.
const HOMES = new Set(["lib/dm/roll-record.ts", "lib/db/rolls.ts", "lib/db/dm-turns.ts"]);
const BY_HAND = {
  store: /\binsertRoll\(/g,
  // The publish and its event name, which may sit a line apart.
  send: /\bpublish\w*\([^;]{0,240}?"roll_result"/g,
  join: /\brollIds\.push\(/g,
};
const KINDS = Object.keys(BY_HAND);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Code only, as scripts/test-turn-pointer-readers.mjs reads it: a comment
// that names insertRoll stores nothing.
const printer = ts.createPrinter({ removeComments: true });
function codeOf(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return printer.printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind));
}

const found = {};
for (const file of walk(root)) {
  const key = path.relative(root, file).split(path.sep).join("/");
  if (HOMES.has(key)) {
    continue;
  }
  const code = codeOf(file, fs.readFileSync(file, "utf8"));
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, (code.match(BY_HAND[kind]) ?? []).length]));
  if (KINDS.some((kind) => counts[kind])) {
    found[key] = counts;
  }
}

// `node scripts/test-roll-record-sites.mjs --counts` prints what the source
// holds now, for striking a moved site off the ledger.
if (process.argv.includes("--counts")) {
  console.log(JSON.stringify(found, null, 2));
  process.exit(0);
}

const said = (counts) => KINDS.filter((kind) => counts[kind]).map((kind) => `${kind} ${counts[kind]}`).join(", ");
const problems = [];
for (const [key, counts] of Object.entries(found)) {
  const entry = ledger.sites[key];
  if (!entry) {
    problems.push(`${key}: puts a roll on record by hand (${said(counts)}). Call recordRoll (src/lib/dm/roll-record.ts), which stores it, sends it, adds it to the turn and says who rolled it.`);
    continue;
  }
  for (const kind of KINDS) {
    const listed = entry[kind] ?? 0;
    if (counts[kind] > listed) {
      problems.push(`${key}: ${kind} by hand ${counts[kind]} time(s), the ledger says ${listed}. The new one goes through recordRoll.`);
    } else if (counts[kind] < listed) {
      problems.push(`${key}: ${kind} by hand ${counts[kind]} time(s), the ledger says ${listed}. Strike the one moved, and lower the ledger's total.`);
    }
  }
  if (!ledger.families[entry.family]) {
    problems.push(`${key}: its family "${entry.family}" is not one the ledger names.`);
  }
}
for (const key of Object.keys(ledger.sites)) {
  if (!found[key]) {
    problems.push(`${key}: on the ledger and records no roll by hand any more; strike it.`);
  }
}
const total = Object.fromEntries(KINDS.map((kind) => [kind, Object.values(found).reduce((sum, counts) => sum + counts[kind], 0)]));
for (const kind of KINDS) {
  if (ledger.total[kind] !== total[kind]) {
    problems.push(`total.${kind}: the source holds ${total[kind]}, the ledger says ${ledger.total[kind]}.`);
  }
}
const unused = Object.keys(ledger.families).filter((family) => !Object.values(ledger.sites).some((entry) => entry.family === family));
for (const family of unused) {
  problems.push(`family "${family}": no site is left in it; strike it.`);
}
assert.deepEqual(problems, [], problems.join("\n"));
console.log(`test-roll-record-sites: ${Object.keys(found).length} files on the ledger; by hand: ${said(total)}`);
