// The blocking matrix, an enemy acting: every way the catalog lets the GM act
// FOR a creature (scripts/lib/sweep-doors-rows.mjs enemyRows, built from
// src/lib/dm/invoke-catalog.ts), with the creature in every state the rules
// say bars that act, through the GM console's form and the AI GM's tool call.
// A cell holds when the door refuses and the database is as it was.
//
// A creature is a monster's stat block, and the conditions bind it as they
// bind a character (SRD 5.1, Conditions: "A condition lasts either until it
// is countered ... or for a duration specified by the effect that imposed
// the condition", on "a creature").
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { dbTools, doors as openDoors, passToEnemies, stageFight } from "./lib/sweep-doors.mjs";
import { enemyActorOf, enemyRows } from "./lib/sweep-doors-rows.mjs";
import { known, runMatrix } from "./lib/sweep-doors-matrix.mjs";

const api = suite("test-enforce-sweep-doors-block-enemies");
const { finish } = api;

const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const rows = enemyRows(ADJUDICATIONS);

// ---- what fails today, and what cannot be run ----

const CHARACTERS_ONLY = "the engine's own answer: \"An enemy's take_action is dash, disengage, dodge or escape\"; its attacks are enemy_attack, its abilities cast_at_player or aoe_damage";
const SKIP = Object.fromEntries(
  ["hide", "help", "grapple", "shove", "ready", "search", "use_object", "pin", "improvise"].map((action) => [`take_action:enemy:${action}`, CHARACTERS_ONLY]),
);

const BOTH = ["console", "ai"];
const cellsOf = (row, states) => states.flatMap((state) => BOTH.map((door) => `${row}|${state}|${door}`));

const KNOWN = {};

// ---- the stage ----

const world = await openWorld({ campaign: { maxPlayers: 8, startingLevel: 5 }, gameSettings: { ttsEnabled: false } });
// The enemies' turns have come: the hero before them has ended their turn,
// so the AI's calls for them are in order (src/lib/dm/enemy-turn-order.ts).
const t = await stageFight(world, { last: "wren" });
await passToEnemies(t, "wren");
t.stageKind = "enemies-due";
t.doors = await openDoors(world);
const db = await dbTools();
const base = db.snapshot();
const stageFor = async () => ({ t, base });

// ---- the states ----

const lay = (condition, extra = () => ({})) => async (table, id, row) => {
  const out = await table.world.invoke("set_condition", { enemyId: id, condition, ...extra(table, row) });
  assert.ok(out.ok, `laying ${condition}: ${out.error}`);
};
const acts = (row, ...more) => ["action", ...more].includes(row.kind);
const INCAPACITATED = "SRD 5.1, Incapacitated: \"An incapacitated creature can't take actions or reactions.\"";

const STATES = [
  {
    id: "dead", words: "dead", family: ["retry", "refused:rules"],
    rule: "SRD 5.1, Monsters and Death: \"A monster usually dies or is destroyed when it drops to 0 hit points.\" A dead creature does nothing.",
    bars: () => true,
    apply: async (table, id) => {
      const out = await table.world.invoke("apply_damage", { enemyId: id, amount: 200, type: "force" });
      assert.ok(out.ok && table.kit.enemy(id).status === "dead", `killing it: ${out.error ?? table.kit.enemy(id).status}`);
    },
  },
  {
    id: "fled", words: "gone from the fight (fled)", family: ["retry", "refused:rules"],
    rule: "A creature that has fled the fight takes no part in it (enemy_flees: \"it is out of the fight\").",
    bars: (row) => row.tool !== "enemy_flees",
    apply: async (table, id) => {
      // A row's prelude may have bound it (the escape row grapples it), and
      // a creature at speed 0 cannot run (enemy_flees): it breaks free, then
      // runs.
      for (const condition of ["grappled", "restrained"].filter((name) => table.kit.enemy(id).conditions.includes(name))) {
        await table.world.invoke("clear_enemy_condition", { enemyId: id, condition });
      }
      const out = await table.world.invoke("enemy_flees", { enemyId: id, reason: "it runs" });
      assert.ok(out.ok && table.kit.enemy(id).status !== "alive", `sending it off: ${out.error ?? table.kit.enemy(id).status}`);
    },
  },
  {
    id: "asleep", words: "unconscious (asleep)", family: ["refused:rules"],
    rule: `SRD 5.1, Unconscious: "An unconscious creature is incapacitated (see the condition), can't move or speak, and is unaware of its surroundings." ${INCAPACITATED}`,
    bars: (row) => acts(row, "move", "intent"),
    apply: lay("unconscious"),
  },
  {
    id: "stunned", words: "stunned", family: ["refused:rules"],
    rule: `SRD 5.1, Stunned: "A stunned creature is incapacitated (see the condition), can't move, and can speak only falteringly." ${INCAPACITATED}`,
    bars: (row) => acts(row, "move"),
    apply: lay("stunned"),
  },
  {
    id: "paralyzed", words: "paralyzed", family: ["refused:rules"],
    rule: `SRD 5.1, Paralyzed: "A paralyzed creature is incapacitated (see the condition) and can't move or speak." ${INCAPACITATED}`,
    bars: (row) => acts(row, "move"),
    apply: lay("paralyzed"),
  },
  {
    id: "petrified", words: "petrified", family: ["refused:rules"],
    rule: `SRD 5.1, Petrified: "The creature is incapacitated (see the condition), can't move or speak, and is unaware of its surroundings." ${INCAPACITATED}`,
    bars: (row) => acts(row, "move", "intent"),
    apply: lay("petrified"),
  },
  {
    id: "incapacitated", words: "incapacitated", family: ["refused:rules"],
    rule: INCAPACITATED,
    bars: (row) => acts(row),
    apply: lay("incapacitated"),
  },
  {
    id: "surprised", words: "surprised in round 1", family: ["refused:rules"],
    rule: "SRD 5.1, Surprise: \"If you're surprised, you can't move or take an action on your first turn of the combat, and you can't take a reaction until that turn ends.\"",
    bars: (row) => acts(row, "move"),
    apply: (table, id) => {
      const encounter = table.world.encounter();
      assert.equal(encounter.round, 1, "the stage is in round 1");
      encounters.saveEncounter({ ...encounter, surprisedIds: [id] });
    },
  },
  {
    id: "acted", words: "done with its action this round", family: ["refused:rules"],
    rule: "SRD 5.1, Your Turn: \"On your turn, you can move a distance up to your speed and take one action.\" One action a round for a creature (can-act.ts canEnemyAct).",
    bars: (row) => acts(row),
    apply: (table, id) => {
      const encounter = table.world.encounter();
      encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, acted: { round: encounter.round, ids: [id] } } });
    },
  },
  {
    // A retry here is right too: the model picks the creature's target, so a
    // charmer picked is its call to fix (a hero's is the player's word, and
    // is refused as rules).
    id: "charmed_by_target", words: "charmed by the character the act harms", family: ["refused:rules", "retry"],
    rule: "SRD 5.1, Charmed: \"A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects.\"",
    bars: (row) => Boolean(row.harms),
    apply: lay("charmed", (table) => ({ sourceCharacterId: table.brom.id })),
  },
  {
    id: "grappled", words: "grappled (speed 0)", family: ["refused:rules"],
    rule: "SRD 5.1, Grappled: \"A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.\"",
    bars: (row) => row.kind === "move",
    apply: lay("grappled", (table) => ({ sourceCharacterId: table.brom.id })),
  },
  {
    id: "restrained", words: "restrained (speed 0)", family: ["refused:rules"],
    rule: "SRD 5.1, Restrained: \"A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed.\"",
    bars: (row) => row.kind === "move",
    apply: lay("restrained"),
  },
];

const callers = [
  { id: "console", call: (table, name, args) => table.doors.console(name, args) },
  { id: "ai", call: (table, name, args) => table.doors.ai(name, args) },
];

await runMatrix({
  api, db, rows, states: STATES, doors: callers, stageFor,
  actorOf: (row, table) => enemyActorOf(row, table),
  KNOWN, SKIP, label: "enemy",
});

world.close();
finish();
