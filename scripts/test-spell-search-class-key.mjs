// The spell search's class filter (src/lib/content/index.ts searchSpells)
// reads a row's lists as the save's check does (spellOnListKey): a class is a
// whole entry of the row's list, never part of one. A substring match offered
// a paladin the six spells the pack files under "anti-paladin" alone, and the
// level-up then refused each ("Borrowing is not on the paladin spell list").
import assert from "node:assert/strict";
import { hasPack } from "./lib/enforce-world.mjs";

const { searchSpells } = await import("../src/lib/content/index.ts");
const { spellOnListKey } = await import("../src/lib/classes/class-spell-list.ts");

// A process.exit inside a vitest file fails it, so the check is skipped in
// place when there is no pack.
if (!hasPack) {
  console.log("no content pack: skipped (the bundled checklist has no anti-paladin rows)");
} else {
  const rows = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = searchSpells({ classSlug: "paladin", limit: 100, offset });
    rows.push(...page);
    if (page.length < 100) break;
  }
  assert.ok(rows.length > 50, `only ${rows.length} paladin spells`);
  const stray = rows.filter((row) => !spellOnListKey("paladin", row));
  assert.deepEqual(stray.map((row) => `${row.name} (${row.classes.join(", ")})`), [], "spells offered to a paladin that the paladin list does not hold");
  assert.ok(!rows.some((row) => row.name === "Borrowing"), "Borrowing (anti-paladin only) is offered to a paladin");
  console.log(`ok ${rows.length} paladin spells, each on the paladin list`);
}
