// One function ends a held spell (src/lib/dm/concentration.ts endHeldSpell,
// reached through breakConcentration and setConcentration): a path that
// drops a character's concentration by writing the sheet ends the
// concentration and leaves the spell running with nobody holding it, as the
// long rest did with Animal Shapes (LC-CONC-02: the ally stayed polymorphed
// for the sixteen hours left after the night). This scan fails on any source
// file that clears concentration itself.
//
// The dynamic side is the lifecycle sweeps: every concentration spell walked
// through damage, a new spell, a condition, the clock and both rests
// (scripts/test-enforce-sweep-lifecycle-conc.mjs, -clock.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");

// Files that name an empty concentration without writing a sheet: the one
// owner, and a sample sheet the tips read.
const ALLOWED = {
  "lib/dm/concentration.ts": "the one owner",
  "lib/characters/hero-tips.ts": "a sample sheet the tips read, never written",
};

const CLEARS = [
  /\bconcentratingOn\s*:\s*null\b/,
  /\bconcentratingOn\s*=\s*null\b/,
  /\bconcentrating_on\s*=\s*NULL\b/i,
];

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* files(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

const found = [];
for (const file of files(root)) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (ALLOWED[rel]) {
    continue;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, "");
    if (CLEARS.some((pattern) => pattern.test(code))) {
      found.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
}
assert.deepEqual(
  found,
  [],
  "concentration is cleared outside concentration.ts: call breakConcentration (it ends the spell's conditions, areas and creatures with it)",
);
for (const rel of Object.keys(ALLOWED)) {
  assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is allowed but gone: strike it`);
}
console.log("ok: concentration ends in one place");
