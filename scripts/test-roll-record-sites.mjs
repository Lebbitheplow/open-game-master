// No file puts a roll on record by hand. The ones that did were on a ledger
// (scripts/roll-record-sites.json), with how many times each did each of the
// three things by hand and which family of sites it moved with; the ledger is
// empty now, and this suite keeps it so.
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
// A new one fails here until it goes through recordRoll. The ledger's `total`
// is the sum of its counts, all 0: a pull request that raises one says why in
// its diff.
//
// The door also keeps one mark: the rolls an AI GM asked for with
// request_roll (recordRoll's `asked`, issue #1073). The gate that holds an
// AI GM's numbers takes a total from that list and from nowhere else
// (src/lib/dm/ai-gate.ts), so which files may say `asked` is on the ledger
// too (`asked`): the two where a GM's own request_roll puts its roll on
// record. A card says it the same way as it is dealt (createPendingRoll's
// `asked`), and is held to the same list. A third file that says it, or a
// file that writes a turn's asked or paid list by hand, fails here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");
const ledgerPath = path.join(import.meta.dirname, "roll-record-sites.json");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

// The door itself, and the store it writes through.
// And the turn store, which keeps the rolls its stored row lists, with the
// migration that files the turns open when a card's roll began to join its
// turn as it lands (run once, on rows the door never wrote).
const HOMES = new Set(["lib/dm/roll-record.ts", "lib/db/rolls.ts", "lib/db/dm-turns.ts", "lib/db/answered-cards-backfill.ts"]);
const BY_HAND = {
  store: /\binsertRoll\(/g,
  // The publish and its event name, which may sit a line apart.
  send: /\bpublish\w*\([^;]{0,240}?"roll_result"/g,
  // Onto a turn's list in hand, in any of the ways a list grows, or onto its
  // stored row.
  join: /\brollIds\.(?:push|unshift|splice|concat)\(|\.rollIds\s*=(?!=)|\bjoinStoredTurn\(/g,
};
const KINDS = Object.keys(BY_HAND);
// A turn's asked or paid list written by hand: grown, or set whole. A call
// that parks cuts both back by their length (src/lib/dm/held-call.ts), which
// is no write of an id and is not matched.
const MARK_BY_HAND = /\b(?:asked|paid)RollIds\.(?:push|unshift|splice|concat)\(|\.(?:asked|paid)RollIds\s*=(?!=)|\b(?:asked|paid)_roll_ids_json\s*=(?!=)/g;

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

// The files whose call to recordRoll, or to createPendingRoll for a card,
// says `asked`, whatever value it gives and however deep in what the call
// is handed (a card's `carry` written whole): read from the syntax tree, so
// the word in another place (another call's field, a local of that name) is
// not counted.
const SAYS_ASKED = new Set(["recordRoll", "createPendingRoll"]);
function saysAsked(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  let count = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SAYS_ASKED.has(node.expression.text)) {
      const within = (inner) => {
        if (ts.isObjectLiteralExpression(inner)) {
          for (const property of inner.properties) {
            const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null;
            if (name === "asked") {
              count += 1;
            }
          }
        }
        ts.forEachChild(inner, within);
      };
      node.arguments.forEach(within);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

const found = {};
const asking = [];
const marking = [];
for (const file of walk(root)) {
  const key = path.relative(root, file).split(path.sep).join("/");
  const text = fs.readFileSync(file, "utf8");
  if (saysAsked(file, text)) {
    asking.push(key);
  }
  if (HOMES.has(key)) {
    continue;
  }
  const code = codeOf(file, text);
  if ((code.match(MARK_BY_HAND) ?? []).length) {
    marking.push(key);
  }
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
// Who may say a roll was asked for, and who writes the marks.
const mayAsk = ledger.asked ?? [];
for (const key of asking) {
  if (!mayAsk.includes(key)) {
    problems.push(`${key}: tells recordRoll or createPendingRoll a roll is one an AI GM asked for (\`asked\`), and is not one of the files the ledger names for it (${mayAsk.join(", ")}). Only a GM's own request_roll asks for a roll: a roll marked anywhere else pays for a number the model made up.`);
  }
}
for (const key of mayAsk) {
  if (!asking.includes(key)) {
    problems.push(`${key}: on the ledger's \`asked\` list and no call to recordRoll or createPendingRoll there says \`asked\` any more; strike it.`);
  }
}
for (const key of marking) {
  problems.push(`${key}: writes a turn's asked or paid list by hand. The door writes the first with the roll (recordRoll's \`asked\`) and the gate the second (src/lib/db/dm-turns.ts payOnTurn).`);
}
const unused = Object.keys(ledger.families).filter((family) => !Object.values(ledger.sites).some((entry) => entry.family === family));
for (const family of unused) {
  problems.push(`family "${family}": no site is left in it; strike it.`);
}
assert.deepEqual(problems, [], problems.join("\n"));
console.log(`test-roll-record-sites: ${Object.keys(found).length} files on the ledger; by hand: ${said(total) || "none"}; files that say a roll was asked for: ${asking.length}`);
