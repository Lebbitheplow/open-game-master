// Which files still write a roll's sentence by hand (issue #1064, step 2).
//
// A roll's `detail` was a sentence each site wrote, in English, and a table
// in another language read it half translated. A family of sites that has
// moved writes none: it hands the door fields (src/lib/roll-parts.ts), and
// src/lib/roll-words.ts makes the words from them. The families move one at
// a time, so this suite keeps a ledger (scripts/roll-parts-sites.json):
//
//   moved   the files of each family that has moved. None of them hands a
//           door a sentence or calls a sentence builder: a site there that
//           goes back to writing its own fails here. These files are held
//           more strictly than the rest (below);
//   sites   every other file that hands words to a roll's door, with how
//           many times. A count that rises is a new sentence by hand, and
//           fails; one that falls is a site moved, and the ledger is
//           lowered with it. `total` is their sum, so it only goes down.
//
// "Hands words to a door" is read from the syntax tree, and is one of:
//
//   - a `detail` in what is handed to recordRoll, createPendingRoll,
//     rollCharacterD20, rollCharacterDice or parkHeldCall;
//   - a `record: { detail }` option, in any call (a creature's forced save);
//   - the words handed by position to rollCard, secretRoll, dmRoll,
//     castersDamage, rollOwnDice or rollOwnDiceStored;
//   - a call to a sentence builder of src/lib/roll-labels.ts: rollAgainst,
//     rollOn, thrownOn, attackOn.
//
// In a moved file the scan is wider, since nothing there has a sentence to
// write: any `detail` written into any object (so one spread into a door's
// argument, held in a variable first, or handed to a door by another name
// is seen), any use at all of a sentence builder's name, and any `reason`
// written into any object: the line a waiting card says under its title is
// a sentence too, and a moved family says it in fields (`line`,
// src/lib/roll-words.ts cardLine).
//
// And everywhere: a note written as typed (`notes: [{ typed: ... }]`) with
// words in the code. A typed note is what a person or the model typed, so it holds a
// value handed in; words the engine writes are one of its own notes, by
// their id (src/lib/roll-words.ts ROLL_NOTES).
//
// What this cannot see, in a file that has not moved: a sentence spread into
// a door's argument or held in a variable first, a door called by another
// name, and the callers of a helper that takes words from them (a save's, a
// check's): such a helper is counted once, where it hands the words on. A
// family that moves lists its files under `moved`, where the wider scan
// holds them, and its helpers join the doors above when they take fields.
// What a moved family's rolls store is held at run time, whatever road they
// took, by the dice-site sweep (scripts/test-enforce-sweep-dice-sites.mjs,
// `words`), and the door refuses a roll handed no words at all.
//
// `node scripts/test-roll-sentence-sites.mjs --counts` prints what the
// source holds now.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");
const ledger = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "roll-parts-sites.json"), "utf8"));

// Doors handed an object that may say `detail`.
const BY_FIELD = new Set(["recordRoll", "createPendingRoll", "rollCharacterD20", "rollCharacterDice", "parkHeldCall"]);
// Doors handed the words by position.
const BY_PLACE = { rollCard: 4, secretRoll: 4, dmRoll: 3, castersDamage: 3, rollOwnDice: 2, rollOwnDiceStored: 2 };
// The builders of a sentence, and the module they live in.
const BUILDERS = new Set(["rollAgainst", "rollOn", "thrownOn", "attackOn"]);
const BUILDERS_HOME = "lib/roll-labels.ts";

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

const named = (property) => (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null);
const says = (literal, name) => literal.properties.some((property) => named(property) === name);

const MOVED = new Set(Object.values(ledger.moved).flat());
const typedByHand = [];
// Whether a property sits in a roll's `notes`: `notes: [{ typed }]`, or a
// list built up to it.
function inNotes(node) {
  for (let at = node.parent, up = 0; at && up < 5; at = at.parent, up += 1) {
    if (ts.isPropertyAssignment(at) && named(at) === "notes") {
      return true;
    }
  }
  return false;
}
// A zod schema's field: `z.string().optional()`.
function schemaField(node) {
  let at = node;
  while (ts.isCallExpression(at) || ts.isPropertyAccessExpression(at)) {
    at = at.expression;
  }
  return ts.isIdentifier(at) && at.text === "z";
}
const literalWords = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);

function sentencesIn(file, text, key) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  let count = 0;
  const strict = MOVED.has(key);
  const visit = (node) => {
    // A typed note with the engine's words in it, in any file.
    if (ts.isPropertyAssignment(node) && named(node) === "typed" && literalWords(node.initializer) && inNotes(node)) {
      typedByHand.push(`${key}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    if (strict) {
      // Any sentence written into any object, and any use of a builder.
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && named(node) === "detail") {
        count += 1;
      }
      if (ts.isIdentifier(node) && BUILDERS.has(node.text)) {
        count += 1;
      }
      // A waiting card's own line, written by hand: a `reason` in any object,
      // but for a tool's argument of that name in its schema (`z....`).
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && named(node) === "reason" && !(ts.isPropertyAssignment(node) && schemaField(node.initializer))) {
        count += 1;
      }
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : null;
      if (callee && BY_FIELD.has(callee) && node.arguments.some((argument) => ts.isObjectLiteralExpression(argument) && says(argument, "detail"))) {
        count += 1;
      }
      if (callee && callee in BY_PLACE && node.arguments.length > BY_PLACE[callee]) {
        count += 1;
      }
      if (callee && BUILDERS.has(callee) && key !== BUILDERS_HOME) {
        count += 1;
      }
    }
    // A forced save's own record, whoever takes it.
    if (ts.isPropertyAssignment(node) && named(node) === "record" && ts.isObjectLiteralExpression(node.initializer) && says(node.initializer, "detail")) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

const found = {};
for (const file of walk(root)) {
  const key = path.relative(root, file).split(path.sep).join("/");
  const count = sentencesIn(file, fs.readFileSync(file, "utf8"), key);
  if (count) {
    found[key] = count;
  }
}

if (process.argv.includes("--counts")) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2));
  process.exit(0);
}

const problems = [];
const moved = Object.entries(ledger.moved).flatMap(([family, files]) => files.map((file) => [file, family]));
for (const [file, family] of moved) {
  if (!fs.existsSync(path.join(root, file))) {
    problems.push(`${file}: listed as moved with "${family}" and is not a file any more; strike it.`);
  }
  if (found[file]) {
    problems.push(`${file}: writes a roll's sentence by hand ${found[file]} time(s), and its family ("${family}") has moved. Hand the door the roll's parts (src/lib/roll-parts.ts): src/lib/roll-words.ts makes the words from them, in the reader's language.`);
  }
  if (ledger.sites[file] !== undefined) {
    problems.push(`${file}: listed as moved and among the files that still write a sentence; it is one or the other.`);
  }
}
const movedFiles = new Set(moved.map(([file]) => file));
for (const [file, count] of Object.entries(found)) {
  if (movedFiles.has(file)) {
    continue;
  }
  const listed = ledger.sites[file];
  if (listed === undefined) {
    problems.push(`${file}: hands a roll's door a sentence written by hand (${count}), and is not on the ledger. A new roll says what it is in fields (src/lib/roll-parts.ts); if its family has not moved yet, list the file in scripts/roll-parts-sites.json with its count and raise the total, so the diff says so.`);
  } else if (count > listed) {
    problems.push(`${file}: writes a roll's sentence by hand ${count} time(s), the ledger says ${listed}. The new one hands the door parts, or the diff raises the ledger and says why.`);
  } else if (count < listed) {
    problems.push(`${file}: writes a roll's sentence by hand ${count} time(s), the ledger says ${listed}. Lower it, and the total.`);
  }
}
for (const file of Object.keys(ledger.sites)) {
  if (!found[file]) {
    problems.push(`${file}: on the ledger and writes no sentence by hand any more; strike it, and list it with its family under "moved" if its family moved.`);
  }
}
const total = Object.entries(found).reduce((sum, [file, count]) => sum + (movedFiles.has(file) ? 0 : count), 0);
if (ledger.total !== total) {
  problems.push(`total: the source holds ${total}, the ledger says ${ledger.total}.`);
}
for (const where of typedByHand) {
  problems.push(`${where}: a typed note with words written in the code. A typed note holds what a person or the model typed; the engine's own words are a note of its own, by its id (src/lib/roll-words.ts ROLL_NOTES), so the dictionaries can find them.`);
}
assert.deepEqual(problems, [], problems.join("\n"));
console.log(`test-roll-sentence-sites: ${movedFiles.size} files in ${Object.keys(ledger.moved).length} moved family, none writes a sentence; ${Object.keys(ledger.sites).length} files still do, ${total} times`);
