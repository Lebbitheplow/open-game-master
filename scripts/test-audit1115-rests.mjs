// Rests, resources, time and progression (rules audit 2026-11-15, lens R):
// each test pins one finding, R01 onward, against SRD 5.1. The pure rules are
// imported directly; the ones that live in a handler run through a table.
//
// The table helpers come first: they point the database at a scratch
// directory before anything from src/ loads.
import assert from "node:assert/strict";
import { openTable, rolled } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-audit1115-rests");
const { populateResources } = await import("../src/lib/srd/class-resources.ts");

const mods = { str: 0, dex: 2, con: 1, int: 3, wis: 0, cha: 0 };
const shortRest = (table, spend) => table.invoke("take_rest", { kind: "short", ...(spend ? { spend } : {}) });

await test("R01 a counter sized by the proficiency bonus reads the total level on a multiclass sheet", () => {
  // SRD 5.1, Multiclassing: "Your proficiency bonus is always based on your
  // total character level, not your level in a particular class." A wizard 2
  // / fighter 5 is 7th level, proficiency +3, so Bladesong's uses are 3.
  const classes = [{ id: "wizard", level: 2 }, { id: "fighter", level: 5 }];
  const bladesong = populateResources([{ name: "Bladesong", classId: "wizard" }], 7, mods, undefined, classes);
  assert.equal(bladesong.sub_bladesong?.max, 3);
  // Twice the bonus (a Psi Warrior's psionic dice): fighter 3 / rogue 6 is
  // 9th level, proficiency +4, eight dice.
  const psionic = populateResources(
    [{ name: "Psionic Power (Psi Warrior)", classId: "fighter" }],
    9,
    mods,
    undefined,
    [{ id: "fighter", level: 3 }, { id: "rogue", level: 6 }],
  );
  assert.equal(psionic.sub_psionic_energy?.max, 8);
  // A single-class sheet reads as it always did.
  assert.equal(populateResources([{ name: "Bladesong", classId: "wizard" }], 9, mods, undefined)?.sub_bladesong?.max, 4);
});

await test("R02 Durable floors each hit die at twice the Constitution modifier, not the dice together", async () => {
  // Durable: "When you roll a Hit Die to regain hit points, the minimum
  // number of hit points you regain from the roll equals twice your
  // Constitution modifier (minimum of 2)." CON 16 (+3): each die heals at
  // least 6. A 1 and a 10 on two d10s heal 6 + 13 = 19, not max(17, 12).
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 16 }, feats: ["Durable"], hitDice: { die: "d10", total: 5, spent: 0 } });
  table.patch(fighter.id, { currentHp: 10 });
  table.diceLog();
  table.dice(1, 10);
  const rest = await shortRest(table, [{ characterId: fighter.id, dice: 2 }]);
  assert.equal(rest.ok, true, rest.error);
  rolled(table);
  assert.equal(table.sheet(fighter.id).currentHp, 10 + 6 + 13);
});

finish();
