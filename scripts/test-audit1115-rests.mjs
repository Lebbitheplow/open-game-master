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

await test("R03 a worn, attuned Periapt of Wound Closure doubles what each hit die heals and stabilizes its dying wearer", async () => {
  // SRD 5.1, Periapt of Wound Closure: "While you wear this pendant, you
  // stabilize whenever you are dying at the start of your turn. In
  // addition, whenever you roll a Hit Die to regain hit points, double the
  // number of hit points it restores."
  const { rollDeathSave } = await import("../src/lib/dm/death.ts");
  const table = await openTable();
  const periapt = { name: "Periapt of Wound Closure", qty: 1, attuned: true, equipped: true };
  const wearer = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 14 }, equipment: [periapt], hitDice: { die: "d10", total: 5, spent: 0 } });
  const bare = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 14 }, equipment: [{ ...periapt, attuned: false }], hitDice: { die: "d10", total: 5, spent: 0 } });
  assert.equal(table.sheet(wearer.id).equipment[0]?.attuned, true, "the periapt is stored attuned");
  table.patch(wearer.id, { currentHp: 10 });
  table.patch(bare.id, { currentHp: 10 });
  table.diceLog();
  // 4 + 2 doubled is 12; the unattuned pendant does nothing (4 + 2).
  table.dice(4, 4);
  const rest = await shortRest(table, [{ characterId: wearer.id, dice: 1 }, { characterId: bare.id, dice: 1 }]);
  assert.equal(rest.ok, true, rest.error);
  rolled(table);
  assert.equal(table.sheet(wearer.id).currentHp, 10 + 12);
  assert.equal(table.sheet(bare.id).currentHp, 10 + 6);

  // Dying at the start of their turn, the wearer stabilizes: no save is
  // rolled, and the track reads stable.
  table.patch(wearer.id, { currentHp: 0, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } });
  table.clearDice();
  table.diceLog();
  table.dice(1, 3);
  rollDeathSave(table.campaign(), wearer.id);
  const track = table.sheet(wearer.id).deathSaves;
  assert.equal(track?.stable, true, JSON.stringify(track));
  assert.equal(track?.dead, false);
  assert.equal(track?.failures, 0);
  assert.equal(table.sheet(wearer.id).currentHp, 0, "stable is not healed");
  table.clearDice();
});

await test("R04 for 24 hours after a Potion of Vitality every hit die spent heals its maximum", async () => {
  // SRD 5.1, Potion of Vitality: "For the next 24 hours, you regain the
  // maximum number of hit points for any Hit Die you spend."
  const table = await openTable();
  const fighter = table.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { con: 14 }, hitDice: { die: "d10", total: 5, spent: 0 } });
  table.patch(fighter.id, { currentHp: 10, equipment: [{ name: "Potion of Vitality", qty: 1 }] });
  const drunk = await table.invoke("use_item", { characterId: fighter.id, item: "Potion of Vitality" });
  assert.equal(drunk.ok, true, drunk.error);
  table.clearDice();
  table.diceLog();
  table.dice(1, 2);
  const rest = await shortRest(table, [{ characterId: fighter.id, dice: 2 }]);
  assert.equal(rest.ok, true, rest.error);
  table.clearDice();
  // Two d10s at their maximum, each with the +2: 24, whatever the faces.
  assert.equal(table.sheet(fighter.id).currentHp, 10 + 24);
  // A day later the potion is spent: the dice heal as rolled again.
  await table.invoke("pass_time", { amount: 1, unit: "days" });
  table.patch(fighter.id, { currentHp: 10 });
  table.dice(1);
  await shortRest(table, [{ characterId: fighter.id, dice: 1 }]);
  table.clearDice();
  assert.equal(table.sheet(fighter.id).currentHp, 10 + 3);
});

await test("R05 a character brought back from death is no longer attuned to anything", async () => {
  // SRD 5.1, Attunement: "A creature's attunement to an item ends if ...
  // the creature dies." Back from the dead, a hero attunes again with a
  // short rest; the cloak's +1 does not come back with them.
  const table = await openTable();
  const cleric = table.addHero({
    name: "Brother Tam", class: "cleric", level: 5, abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 3: { max: 2, used: 0 } }, prepared: ["Revivify"], known: [], cantrips: [] },
    equipment: [{ name: "Diamond", qty: 1, worth: 300 }, { name: "Component pouch", qty: 1 }],
  });
  const fallen = table.addHero({ name: "Lyra", equipment: [{ name: "Cloak of Protection", qty: 1, attuned: true, equipped: true }] });
  assert.equal(table.sheet(fallen.id).equipment[0]?.attuned, true, "the cloak is stored attuned");
  table.patch(fallen.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true }, currentHp: 0 });
  table.dice(4, 4);
  const raised = await table.invoke("heal", { characterId: fallen.id, casterId: cleric.id, spell: "Revivify", level: 3 });
  assert.equal(raised.ok, true, raised.error);
  table.clearDice();
  const cloak = table.sheet(fallen.id).equipment.find((item) => item.name === "Cloak of Protection");
  assert.ok(cloak, "the cloak is still carried");
  assert.equal(Boolean(cloak.attuned), false);
});

finish();
