// The blocking matrix at the players' own doors: every route a player's seat
// uses to act for their character in a fight (a Hand card through the
// actions route, the board's walk and its undo, End Turn, the sheet's gear
// toggle), with the character in every state that bars the act
// (scripts/lib/sweep-doors-states.mjs, the same states the tool doors are
// held to), at a table a person runs, where a played card reaches the engine
// at once (actions/route.ts directCardCalls). A cell holds when the route
// answers with an error status and the database is as it was.
//
// Two more states are the routes' own: the character dominated by the other
// side (its player's moves are the GM's until the charm ends,
// companion-command.ts dominatedRefusal), and the act sent by ANOTHER seat
// naming this character's id.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { answer, dbTools, doors as openDoors, passToEnemies, stageFight } from "./lib/sweep-doors.mjs";
import { known, runMatrix } from "./lib/sweep-doors-matrix.mjs";
import { ACTORS, heroStates } from "./lib/sweep-doors-states.mjs";

const api = suite("test-enforce-sweep-doors-routes");
const { test, gap, finish } = api;

const { setDmMode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { dominatedByFoe } = await import("../src/lib/dm/companion-command.ts");
const { ADJUDICATION_NAMES } = await import("../src/lib/dm/invoke-catalog.ts");

// ---- the rows: a route, its body, and what the act spends ----

const enemyAim = (t, index) => ({ targetKind: "enemy", targetId: t.foes[index].id, targetName: t.foes[index].displayName });
const card = (t, actor, content, intent) => ({ content, characterId: t[actor].id, kind: "do", intent });

const ROWS = [
  { id: "card:attack", tool: "actions", actor: "brom", kind: "attack", takesId: true, args: (t) => card(t, "brom", "Brom swings his longsword at the goblin.", { card: "attack", weapon: "Longsword", ...enemyAim(t, 0) }) },
  { id: "card:spell", tool: "actions", actor: "wren", kind: "cast", takesId: true, args: (t) => card(t, "wren", "Wren hurls a fire bolt at the goblin.", { card: "spell", spell: "Fire Bolt", slotLevel: null, ...enemyAim(t, 1) }) },
  { id: "card:heal", tool: "actions", actor: "sera", kind: "cast", takesId: true, reaches: true, prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }), args: (t) => card(t, "sera", "Sera lays a hand on Brom.", { card: "spell", spell: "Cure Wounds", slotLevel: 1, targetKind: "ally", targetId: t.brom.id, targetName: "Brom" }) },
  { id: "card:dodge", tool: "actions", actor: "brom", kind: "action", takesId: true, args: (t) => card(t, "brom", "Brom dodges.", { card: "basic", action: "dodge" }) },
  { id: "card:potion", tool: "actions", actor: "brom", kind: "action", takesId: true, prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }), args: (t) => card(t, "brom", "Brom drinks a potion.", { card: "gear", action: "use", item: "Potion of Healing", targetKind: "self", targetId: t.brom.id, targetName: "Brom" }) },
  { id: "walk", tool: "battle-map/move", actor: "wren", kind: "move", args: () => ({ x: 2, y: 4 }) },
  {
    // Taking a step back is barred by what bars the seat, not by a state
    // laid after the step (the route answers those "That move stands").
    id: "walk:undo", tool: "battle-map/undo", actor: "wren", kind: "undo",
    prelude: async (t) => {
      const walked = await post(t, t.wren, "battle-map/move", { x: 2, y: 4 });
      assert.ok(walked.ok, `the stage's walk: ${answer(walked)}`);
    },
    args: () => ({}),
  },
  { id: "gear:unequip", tool: "sheet/usage", actor: "brom", kind: "action", takesId: true, args: (t) => ({ characterId: t.brom.id, gear: { Shield: { equipped: false } } }) },
  { id: "end-turn", tool: "encounter/end-turn", actor: "brom", kind: "pass", args: () => ({}) },
];

// ---- what fails today, and what cannot be run ----

const SKIP = {};

const KNOWN = {
  ...known([], {}),
};

// ---- the stages ----

const WORLD = { campaign: { maxPlayers: 8, startingLevel: 5 }, gameSettings: { ttsEnabled: false } };
const stages = new Map();

async function build(kind, actor) {
  const world = await openWorld(WORLD);
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "the owner takes the GM's chair");
  const t = await stageFight(world, kind === "away" ? { absent: actor } : kind === "held" ? { last: actor } : {});
  t.stageKind = kind;
  t.doors = await openDoors(world);
  if (kind === "held") {
    await passToEnemies(t, actor);
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

async function post(t, user, path, body) {
  const handler = await t.world.route(`campaigns/[campaignId]/${path}`);
  t.world.signIn({ id: user.userId ?? user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (response.status >= 300 && typeof json?.error === "string") {
    const said = refusals.get(path) ?? new Set();
    said.add(json.error);
    refusals.set(path, said);
  }
  return response.status < 300
    ? { ok: true, result: { status: response.status, ...json } }
    : { ok: false, error: `${response.status} ${json?.error ?? text.slice(0, 200)}` };
}

// Every sentence a route refused a player with, by route.
const refusals = new Map();

for (const row of ROWS) {
  const prelude = row.prelude;
  row.prelude = async (t) => {
    if (t.stageKind === "main") {
      t.kit.giveTurn(t[row.actor].id);
    }
    await prelude?.(t);
  };
}

// ---- the states ----

const STATES = [
  ...(await heroStates()).map((state) => ({ ...state, family: null })),
  {
    id: "dominated", words: "dominated by the other side",
    rule: "SRD 5.1, Dominate Person: \"You can use your action to take total and precise control of the target ... the creature takes only the actions you choose\": its player's moves for it are refused while the charm holds (src/lib/dm/companion-command.ts dominatedRefusal).",
    bars: () => true,
    apply: (t, id) => {
      t.world.patch(id, { conditions: ["charmed"], conditionMeta: { charmed: { spell: "Dominate Person", source: t.foes[1].id } } });
      const moved = moveToSide(t.world.campaign(), id, "foe", { quiet: true });
      assert.ok(!("error" in moved) && dominatedByFoe(t.world.campaignId, t.world.sheet(id)), `the stage's domination: ${JSON.stringify(moved)}`);
      // Still their place in the order: the GM plays the turn.
      if (t.world.encounter().order.some((entry) => entry.characterId === id)) {
        t.kit.giveTurn(id);
      }
    },
  },
];

// The floor follows the pointer the stage and the state moved (the engine
// sets both together; the kit moves the pointer alone).
function syncFloor(t) {
  if (t.stageKind !== "main") {
    return;
  }
  const floor = initiativeFloorFor(t.world.campaignId);
  if (floor) {
    setFloor(t.world.campaignId, floor);
  }
}

const callers = [{ id: "seat", prepare: (t) => syncFloor(t), call: (t, path, body, row) => post(t, t[row.actor], path, body) }];

await runMatrix({
  api, db, rows: ROWS, states: STATES,
  doors: callers.map((door) => ({ ...door, call: (t, path, body) => door.call(t, path, body, ROWS.find((row) => row.tool === path && JSON.stringify(row.args(t)) === JSON.stringify(body))) })),
  stageFor,
  actorOf: (row, t) => t[row.actor].id,
  KNOWN, SKIP, label: "route",
});

// ---- another seat names this character ----

const OTHER_SEAT_RULE = "A player acts for their own character: an id another seat owns is refused, never acted on (the routes' own checks: \"That is not one of your characters.\").";
const KNOWN_SEATS = {};
// Routes that take a character's id and are no act of a fight: asked only
// whether another seat can reach the character through them.
const ID_ROUTES = [
  { id: "hit-dice", tool: "sheet/hit-dice", actor: "brom", takesId: true, args: (t) => ({ dice: 1, characterId: t.brom.id }) },
  { id: "spells:unprepare", tool: "sheet/spells", actor: "sera", takesId: true, args: (t) => ({ action: "unprepare", spell: "Bless", sheetId: t.sera.id }) },
  { id: "foresight", tool: "foresight", actor: "wren", takesId: true, args: (t) => ({ on: true, characterId: t.wren.id }) },
  { id: "usage:slots", tool: "sheet/usage", actor: "wren", takesId: true, args: (t) => ({ characterId: t.wren.id, slots: { 1: 4 } }) },
  { id: "usage:resources", tool: "sheet/usage", actor: "brom", takesId: true, args: (t) => ({ characterId: t.brom.id, resources: { second_wind: 1 } }) },
];
{
  const { t } = await stageFor("main", { actor: "brom" });
  for (const row of [...ROWS, ...ID_ROUTES].filter((candidate) => candidate.takesId)) {
    const intruder = ACTORS.map((key) => t[key]).find((sheet) => sheet.id !== t[row.actor].id);
    const id = `${row.id}|other_seat`;
    const run = async () => {
      db.restore(base);
      await row.prelude?.(t);
      syncFloor(t);
      const before = db.snapshot();
      const out = await post(t, intruder, row.tool, row.args(t));
      const victim = t.world.sheet(t[row.actor].id);
      const was = before.get("character_sheets").rows.find((entry) => entry.id === victim.id);
      const now = db.db.prepare("SELECT * FROM character_sheets WHERE id = ?").get(victim.id);
      const spoke = db.db.prepare("SELECT COUNT(*) AS n FROM campaign_messages WHERE character_id = ?").get(victim.id).n;
      const spokeBefore = before.get("campaign_messages").rows.filter((entry) => entry.character_id === victim.id).length;
      assert.ok(
        JSON.stringify(was) === JSON.stringify(now) && spoke === spokeBefore,
        `${intruder.name}'s seat sent ${row.tool} naming ${victim.name}: ${answer(out)}; ${victim.name}'s sheet ${JSON.stringify(was) === JSON.stringify(now) ? "is untouched" : "changed"}, ${spoke - spokeBefore} line(s) written as ${victim.name}`,
      );
    };
    if (KNOWN_SEATS[id]) {
      await gap(id, { rule: OTHER_SEAT_RULE, ...KNOWN_SEATS[id] }, run);
    } else {
      await test(`route ${id}`, run);
    }
  }
}

// ---- what a refusal says to a player ----

// A route's refusal is read by the player who pressed the button. The tools'
// names are the model's words (tool-errors.ts: each sentence is written for
// the model), so none belongs in one.
const TOOL_WORD = new RegExp(`\\b(${ADJUDICATION_NAMES.filter((name) => name.includes("_")).join("|")})\\b`);
const KNOWN_WORDS = {};
for (const [path, said] of refusals) {
  const leaks = [...said].filter((sentence) => TOOL_WORD.test(sentence));
  const run = () => assert.deepEqual(leaks, [], `${path} answered a player in the model's tool words`);
  if (KNOWN_WORDS[path]) {
    await gap(`words:${path}`, { rule: "A refusal a player reads is in plain words: no tool name (CONTRIBUTING.md, \"Plain words on screen\").", ...KNOWN_WORDS[path] }, run);
  } else {
    await test(`route ${path}: no refusal names a GM tool`, run);
  }
}

for (const t of stages.values()) {
  t.world.close();
}
finish();
