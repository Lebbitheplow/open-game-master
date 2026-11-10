// The blocking matrix with no fight on: every catalog entry that rolls or
// spends for one character outside a fight (scripts/lib/sweep-doors-rows.mjs
// quietRows), asked of a character who is dead, dying, stable at 0,
// unconscious or petrified, through the GM console's form and the AI GM's
// tool call. A cell holds when the door refuses and the database is as it
// was.
//
// Only the states nobody argues about are walked here: the dead do nothing,
// and SRD 5.1 says of the unconscious and the petrified that the creature
// "is incapacitated ..., can't move or speak, and is unaware of its
// surroundings". A stunned or paralyzed character outside a fight is left to
// the fight matrix (test-enforce-sweep-doors-block-heroes.mjs).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { cleric, wizard } from "./lib/enforce-spells.mjs";
import { BROM, dbTools, doors as openDoors } from "./lib/sweep-doors.mjs";
import { quietRows } from "./lib/sweep-doors-rows.mjs";
import { runMatrix } from "./lib/sweep-doors-matrix.mjs";
import { heroStates } from "./lib/sweep-doors-states.mjs";

const api = suite("test-enforce-sweep-doors-block-quiet");
const { finish } = api;

const rows = quietRows();

// ---- what fails today, and what cannot be run ----

const SKIP = {};


// None left: every deed out of a fight asks canAct first
// (src/lib/dm/deed-guard.ts), group_check counts out who cannot act, and
// check_notice counts out the petrified with the unconscious.
const KNOWN = {};

// ---- the stage: a quiet table with a shop, a fence and three heroes ----

const world = await openWorld({ campaign: { maxPlayers: 8, startingLevel: 5 }, gameSettings: { ttsEnabled: false } });
const brom = world.addHero({ user: world.addUser(), ...BROM });
const sera = world.addHero({ user: world.addUser(), name: "Sera", maxHp: 33, gold: 50, ...cleric(5) });
const wren = world.addHero({ user: world.addUser(), name: "Wren", maxHp: 27, gold: 50, ...wizard(5) });
for (const [name, args] of [
  ["move_party", { name: "Harrowmere Market", layoutDescription: "A crowded market square with stalls on every side and a well at its centre. Lanes lead off north and east.", visionClear: true }],
  ["open_shop", { name: "The Rusty Anchor", kind: "general", size: "town", keeper: "Old Tam" }],
  ["set_npc", { name: "Marla the Fence", attitude: "indifferent", trait: "wary", location: "Harrowmere Market", gender: "Female" }],
]) {
  const out = await world.invoke(name, args);
  assert.ok(out.ok, `the stage's ${name}: ${out.error}`);
}
const t = { world, brom, sera, wren, stageKind: "quiet", doors: await openDoors(world) };
const db = await dbTools();
const base = db.snapshot();

const WALKED = ["dead", "dying", "stable", "asleep", "petrified"];
const STATES = (await heroStates()).filter((state) => WALKED.includes(state.id)).map((state) => ({ ...state, bars: () => true }));
assert.equal(STATES.length, WALKED.length, "the shared states still hold every state this matrix walks");

const say = (table, actorId) => table.world.say("player", "I do it now.", table.world.sheet(actorId));
const callers = [
  { id: "console", prepare: say, call: (table, name, args) => table.doors.console(name, args) },
  { id: "ai", prepare: say, call: (table, name, args) => table.doors.ai(name, args) },
];

await runMatrix({
  api, db, rows, states: STATES, doors: callers,
  stageFor: async () => ({ t, base }),
  actorOf: (row, table) => table[row.actor].id,
  KNOWN, SKIP, label: "quiet",
});

world.close();
finish();
