// Every reader of the turn pointer outside held-turn.ts and can-act.ts is on
// a ledger (scripts/turn-pointer-readers.json), each file with its count and
// why it reads the bare pointer.
//
// The pointer rests only on characters: while the enemies grouped before a
// hero take their turns it already sits on that hero, whose turn has not
// begun (src/lib/dm/held-turn.ts). A reader that asks "is it X's own turn"
// of order[turnIndex] or actingCombatantId alone answered "it is Brom's own
// turn" in the middle of the goblins': a goblin's shove of Brom was refused
// as a walk of his, a dead rider mounted, a reaction to the goblin was
// refused as one taken on his turn (findings doors-01, -17, -18, -19). Such
// a question goes through ownTurnOf(encounter, id). What remains here reads
// the pointer for its own mechanics (advancing it, the turn's key, the floor
// that follows it) or to show whose place it is, and says so.
//
// A new raw read fails here until it is moved onto ownTurnOf or put on the
// ledger with its reason; a read removed is struck off.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");
const ledger = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "turn-pointer-readers.json"), "utf8"));

// The helpers themselves: can-act.ts is pure and its callers pair canAct with
// heldTurnRefusal; held-turn.ts is where ownTurnOf lives.
const HOMES = new Set(["lib/dm/can-act.ts", "lib/dm/held-turn.ts"]);
const RAW = /order\[[a-zA-Z.]*turnIndex\]|actingCombatantId\(|currentPcId\(/g;

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

// Code only: a comment that names the pointer reads nothing. Printed back
// by the compiler without its comments, so a "/*" inside a string or a URL
// hides no code.
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
  const count = (codeOf(file, fs.readFileSync(file, "utf8")).match(RAW) ?? []).length;
  if (count) {
    found[key] = count;
  }
}

const problems = [];
for (const [key, count] of Object.entries(found)) {
  const entry = ledger.readers[key];
  if (!entry) {
    problems.push(`${key}: ${count} raw read(s) of the turn pointer. Ask ownTurnOf(encounter, id) (src/lib/dm/held-turn.ts) whether it is someone's own turn; a read of the pointer's own mechanics or a display goes on scripts/turn-pointer-readers.json with its reason.`);
  } else if (entry.count !== count) {
    problems.push(`${key}: ${count} raw read(s), the ledger says ${entry.count}. ${count > entry.count ? "A new one asks ownTurnOf, or the ledger's reason covers it and the count goes up." : "Strike the one removed."}`);
  } else if (!entry.why?.trim()) {
    problems.push(`${key}: the ledger gives no reason.`);
  }
}
for (const key of Object.keys(ledger.readers)) {
  if (!found[key]) {
    problems.push(`${key}: on the ledger and reads the pointer no more; strike it.`);
  }
}
assert.deepEqual(problems, [], problems.join("\n"));
console.log(`test-turn-pointer-readers: ${Object.keys(found).length} files on the ledger, ${Object.values(found).reduce((a, b) => a + b, 0)} raw reads`);
