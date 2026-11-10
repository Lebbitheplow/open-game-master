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
import { known, runMatrix } from "./lib/sweep-doors-matrix.mjs";
import { heroStates } from "./lib/sweep-doors-states.mjs";

const api = suite("test-enforce-sweep-doors-block-quiet");
const { finish } = api;

const rows = quietRows();

// ---- what fails today, and what cannot be run ----

const SKIP = {};

const BOTH = ["console", "ai"];
const ALL = ["dead", "dying", "stable", "asleep", "petrified"];
const DOWN = ["dying", "stable", "asleep", "petrified"];
const cellsOf = (row, states) => states.flatMap((state) => BOTH.map((door) => `${row}|${state}|${door}`));
const UNAWARE = "SRD 5.1, Unconscious and Petrified: the creature \"is incapacitated (see the condition), can't move or speak, and is unaware of its surroundings\"; the dead do nothing.";

const KNOWN = {
  ...known(
    [
      ...cellsOf("social_check", ALL), ...cellsOf("scene_check", ALL), ...cellsOf("damage_object", ALL), ...cellsOf("lift", ALL),
      ...cellsOf("purchase:buy", ALL), ...cellsOf("purchase:sell", ALL), ...cellsOf("party_stash:stow", ALL), ...cellsOf("mount_up", ALL),
    ],
    {
      where: "src/lib/dm/social-tools.ts handleSocialCheck, scene-tools.ts handleSceneCheck, world-tools.ts handleDamageObject, explore-tools.ts (lift), shop-tools.ts handleBuyItem / handleSellItem with no fight on, party-tools.ts handlePartyStash, mount-tools.ts handleMountUp: none asks the character's state",
      severity: "medium",
      note: `${UNAWARE} A dead character persuades the fence, wins a chase's exchange, swings at a door, sells a dagger. use_item, use_resource, cast_buff, heal, haggle and stabilize refuse the same character through canAct.`,
    },
  ),
  ...known(
    [
      ...cellsOf("request_roll:skill", DOWN), ...cellsOf("request_roll:ability", DOWN), ...cellsOf("group_check", DOWN),
      ...cellsOf("handle_item:hand", DOWN), ...cellsOf("handle_item:drop", DOWN), ...cellsOf("downtime", DOWN),
    ],
    {
      where: "src/lib/dm/invoke-roll.ts handleRequestRoll, check-tools.ts handleGroupCheck, gear-tool.ts handleItemCall (hand, drop, out of a fight), explore-tools.ts (downtime): each refuses or counts out the dead and stops there",
      severity: "medium",
      note: `${UNAWARE} The handlers already turn the dead away; a character at 0 hit points, asleep or turned to stone rolls Athletics, sneaks with the group, hands over a dagger and works a day of downtime (a dying one while their death saves roll).`,
    },
  ),
  ...known(cellsOf("check_notice", ["petrified"]), {
    where: "src/lib/dm/check-tools.ts handleCheckNotice (\"The dead and the unconscious notice nothing\"): the petrified are not counted with them",
    severity: "low",
    note: "SRD 5.1, Petrified: \"is unaware of its surroundings\"; a petrified character's passive Perception still notices the trip wire.",
  }),
  ...known(["downtime|dead|console:family", "downtime|dead|ai:family"], {
    where: "src/lib/dm/explore-tools.ts (downtime's refusal of a dead character)",
    severity: "low",
    note: "\"is dead and spends no downtime\" is the game saying no, marked retry.",
  }),
};

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
