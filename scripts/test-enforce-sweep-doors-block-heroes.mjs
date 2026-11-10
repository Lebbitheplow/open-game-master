// The blocking matrix, a hero acting: every way the catalog lets a character
// act (scripts/lib/sweep-doors-rows.mjs heroRows, built from
// src/lib/dm/invoke-catalog.ts), with the character in every state the rules
// say bars that act, through the GM console's form and the AI GM's tool call.
// A cell holds when the door refuses and the database is as it was.
//
// The states and the SRD 5.1 sentence each one keeps are in STATES below.
// What fails today is in KNOWN, keyed by cell (row|state|door), and runs as a
// gap(): the suite is green today and fails the day one closes.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { dbTools, doors as openDoors, stageFight } from "./lib/sweep-doors.mjs";
import { heroRows, unclassified } from "./lib/sweep-doors-rows.mjs";
import { enemyRows } from "./lib/sweep-doors-rows.mjs";
import { known, runMatrix } from "./lib/sweep-doors-matrix.mjs";
import { ACTORS, heroStates } from "./lib/sweep-doors-states.mjs";

const api = suite("test-enforce-sweep-doors-block-heroes");
const { test, finish } = api;

const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");

const rows = heroRows(ADJUDICATIONS);

// ---- what fails today, and what cannot be run ----

const SKIP = {
  "use_reaction:Opportunity Attack": "on the battle map the server rolls an opportunity attack itself as the enemy leaves reach (use_reaction answers so), and the stage has a map",
  "move_token|console": "at the console move_token walks no player's character (the GM drags the token on the board: the battle-map move route, in the routes sweep)",
  "move_token:disengage|console": "as move_token|console",
  "take_action:pin": "needs the Grappler feat and a grapple already held",
};

const BOTH = ["console", "ai"];
const cellsOf = (row, states, doorIds = BOTH) => states.flatMap((state) => doorIds.map((door) => `${row}|${state}|${door}`));

const KNOWN = {
  // mount_up and dismount ask one thing, whose turn it is (and the console
  // not even that): nothing reads the rider's state.
  ...known(
    [
      ...cellsOf("mount_up", ["dead", "dying", "stable", "asleep", "stunned", "paralyzed", "petrified", "surprised", "held"]),
      ...cellsOf("dismount", ["dead", "dying", "stable", "asleep", "stunned", "paralyzed", "petrified", "surprised", "held"]),
    ],
    {
      where: "src/lib/dm/mount-tools.ts handleMountUp, handleDismount, spendMountingMovement (no canAct kind \"move\", no heldTurnRefusal)",
      severity: "medium",
      note: "SRD 5.1, Mounting and Dismounting: \"Once during your move, you can mount a creature that is within 5 feet of you or dismount.\" A dead, dying, stunned, paralyzed, petrified or surprised character has no move, and mounting spends half of it.",
    },
  ),
  // The console's free hand off the rider's turn is written down.
  ...known(cellsOf("mount_up", ["not_turn"], ["console"]).concat(cellsOf("dismount", ["not_turn"], ["console"])), {
    where: "src/lib/dm/mount-tools.ts spendMountingMovement: \"a person at the console keeps a free hand\" (a written ruling; recorded for the maintainer to confirm)",
    severity: "low",
    note: "ruling",
  }),
  ...known(cellsOf("take_action:grapple", ["charmed_by_target"]).concat(cellsOf("take_action:shove", ["charmed_by_target"])), {
    where: "src/lib/dm/action-tools.ts (case \"grapple\" / \"shove\"): no charmedBy check, as pc-attack-gate.ts, cast-at-enemy.ts and aoe-damage.ts have",
    severity: "medium",
    note: "SRD 5.1, Grappling and Shoving a Creature: each is \"a special melee attack\", so the charmer cannot be its target.",
  }),
  ...known(cellsOf("handle_item:drop", ["dying", "stable", "not_turn", "held"]), {
    where: "src/lib/dm/gear-tool.ts handleItemCall (case \"drop\") -> gear-ground.ts drop: a drop asks no canAct and no heldTurnRefusal",
    severity: "low",
    note: "SRD 5.1, Other Activity on Your Turn: \"You can also interact with one object or feature of the environment for free, during either your move or your action.\" Dropping is free (gear-tool.ts), but it is still the turn's, and an unconscious character lets go of nothing by choice.",
  }),
  ...known(["move_token|not_turn|ai:family", "move_token:disengage|not_turn|ai:family"], {
    where: "src/lib/dm/map-tools.ts (move_token's refusal of a player's token off its turn)",
    severity: "low",
    note: "Off their turn pc_attack, take_action and every cast refuse as rules; move_token refuses as retry and names forced:true in the same sentence, which invites the model to resend the walk as a forced one.",
  }),
};

await test("every catalog entry with a character, enemy or token picker is a row of a matrix or has a written reason", () => {
  assert.deepEqual(unclassified(ADJUDICATIONS, [...rows, ...enemyRows(ADJUDICATIONS)]), []);
});

// ---- the stages, all built before the one snapshot they share ----

const WORLD = { campaign: { maxPlayers: 8, startingLevel: 5 }, gameSettings: { ttsEnabled: false } };
const stages = new Map();

async function build(kind, actor) {
  const world = await openWorld(WORLD);
  const t = await stageFight(world, kind === "away" ? { absent: actor } : kind === "held" ? { last: actor } : {});
  t.stageKind = kind;
  t.doors = await openDoors(world);
  if (kind === "held") {
    // The hero before the enemies ends their turn: the pointer walks past
    // the enemies still to act and rests on the actor (enemies-due.ts).
    const before = ACTORS.filter((key) => key !== actor).map((key) => t[key]);
    const lastBefore = world.encounter().order.filter((entry) => entry.kind === "pc" && before.some((sheet) => sheet.id === entry.characterId)).at(-1);
    t.kit.giveTurn(lastBefore.characterId);
    const ended = tools.endOwnTurn(world.campaignId, world.sheet(lastBefore.characterId).userId);
    const now = world.encounter();
    assert.equal(now.order[now.turnIndex].characterId, t[actor].id, `the held stage: the pointer rests on ${actor} (${JSON.stringify(ended).slice(0, 200)})`);
    assert.ok((now.legendary.due ?? []).length > 0 && now.legendary.turnStart === t[actor].id, "the held stage: enemies are due before the actor's turn begins");
  }
  return t;
}

stages.set("main", await build("main"));
for (const actor of ACTORS) {
  stages.set(`away:${actor}`, await build("away", actor));
  stages.set(`held:${actor}`, await build("held", actor));
}
const db = await dbTools();
const base = db.snapshot();
const stageFor = async (kind, row) => ({ t: stages.get(kind === "main" ? "main" : `${kind}:${row.actor}`), base });

// On the clear table the actor holds the turn (a reaction's actor does not).
for (const row of rows) {
  const prelude = row.prelude;
  row.prelude = async (t) => {
    if (t.stageKind === "main") {
      const holder = row.kind === "reaction" ? ACTORS.map((key) => t[key]).find((sheet) => sheet.id !== t[row.actor].id) : t[row.actor];
      t.kit.giveTurn(holder.id);
    }
    await prelude?.(t);
  };
}

const STATES = await heroStates();

const callers = [
  // The player's word comes first at both doors: move_token walks a
  // character only for the move their player just declared.
  { id: "console", prepare: (t, actorId) => t.world.say("player", "I do it now.", t.world.sheet(actorId)), call: (t, name, args) => t.doors.console(name, args) },
  {
    id: "ai",
    prepare: (t, actorId) => t.world.say("player", "I do it now.", t.world.sheet(actorId)),
    call: (t, name, args) => t.doors.ai(name, args),
  },
];

await runMatrix({
  api, db, rows, states: STATES, doors: callers, stageFor,
  actorOf: (row, t) => t[row.actor].id,
  KNOWN, SKIP, label: "hero",
});

for (const t of stages.values()) {
  t.world.close();
}
finish();
