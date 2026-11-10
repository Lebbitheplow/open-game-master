// Lifecycle sweep, part 3: what a restart forgets.
//
// A server restart keeps the database and nothing else. State a module keeps
// in its own scope (a module-level Map or Set it writes to while the game
// runs, or a map it hangs on globalThis) is gone, so anything of the GAME
// kept there, and not only of the plumbing, changes what the table may do
// after a restart (pull request #886: an item's cast credit; #736: the cast
// last sent).
//
// The table is found, not listed: every module under src/lib/dm that declares
// a Map, Set, WeakMap or WeakSet at module level and writes to it, and every
// `globalThis.__odm... ??=` there. Each must have a line in REGISTRY saying
// what it is:
//
//   plumbing  queues, locks, caches, one call's own scratch: a restart costs
//             a recomputation or a retry, and restart recovery owns it;
//   ruling    game state, with a written reason in the file for losing it;
//   state     game state with no such reason: a gap(), shown by running the
//             module's own function in the running copy and in a fresh copy
//             of the module beside the same database (scripts/lib/
//             sweep-lifecycle.mjs restarted).
//
// A new one with no line fails the suite the day it lands.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { restarted } from "./lib/sweep-lifecycle.mjs";
import { stage } from "./lib/sweep-lifecycle-stage.mjs";

const { test, finish } = suite("test-enforce-sweep-lifecycle-restart");

const root = path.resolve(import.meta.dirname, "../src/lib/dm");

function scan() {
  const found = [];
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".ts")).sort()) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/^(?:export )?(?:const|let) (\w+)(?::[^=\n]+)? = new (?:Map|Set|WeakMap|WeakSet)\b/gm)) {
      if (new RegExp(`\\b${match[1]}\\.(?:set|add|delete|clear)\\(`).test(source)) {
        found.push(`${file}:${match[1]}`);
      }
    }
    for (const match of source.matchAll(/globalThis\.(__odm\w+)\s*\?\?=/g)) {
      found.push(`${file}:${match[1]}`);
    }
  }
  return [...new Set(found)];
}

const PLUMBING = "plumbing";
const REGISTRY = {
  // ---- game state with no written reason: none today. Grim Harvest, Keeper
  // of Souls, Form of the Beast's bite and the hoards a turn paid were here;
  // the database keeps their marks now (src/lib/dm/turn-marks.ts). ----
  // ---- game state, the loss written down in the file ----
  "feature-teleport.ts:credits": { kind: "ruling", what: "\"A restart forgets them; the move is then refused as an unpaid teleport, and nothing was moved for free.\"" },
  "manual-ticks.ts:ticks": { kind: "ruling", what: "\"A restart forgets them, which costs only the old behaviour (the cast spends).\"" },
  // ---- plumbing ----
  "call-tracker.ts:__odmUtilityCalls": { kind: PLUMBING, what: "model calls in flight" },
  "cast.ts:__odmCastSent": { kind: PLUMBING, what: "digests of the cast last sent: empty, the next write sends it again" },
  "cast.ts:__odmCastPending": { kind: PLUMBING, what: "a send already queued this tick" },
  "chapter-close.ts:__odmChapterPacing": { kind: PLUMBING, what: "chapter pacing counters, rebuilt from the transcript" },
  "chronal-shift.ts:__odmArmedShifts": { kind: PLUMBING, what: "armed only while one call runs" },
  "claims.ts:__odmReaderReplies": { kind: PLUMBING, what: "a cache of reader replies" },
  "compaction.ts:__odmCompaction": { kind: PLUMBING, what: "compaction in flight" },
  "context-retrieval.ts:__odmIdfCache": { kind: PLUMBING, what: "a cache" },
  "embedding-reindex.ts:__odmEmbeddingCatchUp": { kind: PLUMBING, what: "a catch-up in flight" },
  "fight-events.ts:firing": { kind: PLUMBING, what: "a lock while events fire" },
  "fusion-logic.ts:tokenMemo": { kind: PLUMBING, what: "a memo" },
  "inference-gate.ts:__odmInferenceGate": { kind: PLUMBING, what: "a gate on model calls" },
  "job-control.ts:__odmDmJobStorage": { kind: PLUMBING, what: "async context" },
  "job-control.ts:__odmTurnScopeStorage": { kind: PLUMBING, what: "async context" },
  "job-control.ts:__odmTurnDoneHooks": { kind: PLUMBING, what: "hooks registered at load" },
  "job-control.ts:__odmOpenTurnScopes": { kind: PLUMBING, what: "turns in flight" },
  "job-control.ts:__odmStandInTurns": { kind: PLUMBING, what: "stand-in turns in flight" },
  "loop.ts:__odmTurnRequested": { kind: PLUMBING, what: "turn requests, recovered at boot (test-real-dice-restart)" },
  "model.ts:__odmUtilityBreakers": { kind: PLUMBING, what: "circuit breakers" },
  "narration-slot.ts:__odmNarrationSlots": { kind: PLUMBING, what: "narration in flight" },
  "player-word-read.ts:readings": { kind: PLUMBING, what: "a cache of a model's reading of a player's words; read again when empty" },
  "queue.ts:releases": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmQueues": { kind: PLUMBING, what: "the queue, recovered at boot" },
  "queue.ts:__odmDmPauses": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmRunning": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmWatchdog": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmRunningDone": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmFirst": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmDropped": { kind: PLUMBING, what: "the queue" },
  "queue.ts:__odmDmDepths": { kind: PLUMBING, what: "the queue" },
  "status.ts:__odmDmStatus": { kind: PLUMBING, what: "the status line" },
  "table-wait.ts:__odmTableWait": { kind: PLUMBING, what: "timers for a waiting table" },
  "token-calibration.ts:__odmTokenCalibration": { kind: PLUMBING, what: "a learned ratio" },
  "tool-profiles.ts:GROUPED": { kind: PLUMBING, what: "built at load" },
  "turn-warmup.ts:__odmTurnHeads": { kind: PLUMBING, what: "prompt warm-ups" },
  "turn-warmup.ts:__odmTurnWarmups": { kind: PLUMBING, what: "prompt warm-ups" },
  "turn.ts:CARDS_OUT": { kind: PLUMBING, what: "one call's scratch" },
  "held-call.ts:PARKED": { kind: PLUMBING, what: "one call's scratch: which answers are a held call's park" },
  "held-call.ts:WATCHED": { kind: PLUMBING, what: "one call's scratch: the watch stop a held call's answer opened" },
  "held-call.ts:__odmWatchAnswered": { kind: PLUMBING, what: "the next held call is a stop's own, already answered; a restart's taken flag answers the calls a stop held (turn.ts resumeDmTurn)" },
  "turn.ts:toolsSentByTurn": { kind: PLUMBING, what: "the tools a running turn was sent" },
  "turn.ts:toolFieldsByName": { kind: PLUMBING, what: "a cache of each tool's parameter shapes for the argument door, built again from the tool catalogue when empty" },
};

const found = scan();
await test("every module-level store under src/lib/dm has a line in the registry", () => {
  const missing = found.filter((key) => !REGISTRY[key]);
  assert.deepEqual(missing, [], "a module keeps state in memory that this sweep has not classed: say whether a restart may forget it");
});
await test("the registry names nothing that is gone", () => {
  assert.deepEqual(Object.keys(REGISTRY).filter((key) => !found.includes(key)), []);
});

// ---- shown by running: Grim Harvest's once a turn ----
const RULE = "src/lib/srd/subclasses.json, School of Necromancy, Grim Harvest: \"Once per turn, killing a creature with a spell of 1st level or higher restores twice the spell's level in hit points, three times for necromancy spells.\"";
await test(
  `Grim Harvest's once a turn holds across a restart (${RULE})`,
  async () => {
    const ctx = await stage("fight", {
      heroes: [
        { name: "Kara", class: "fighter", level: 5, maxHp: 44 },
        { name: "Mira", maxHp: 60, ...caster("wizard", "int", ["Ray of Sickness"], [], 9), subclass: "School of Necromancy" },
      ],
    });
    const { world, mage, e1 } = ctx;
    const hooks = await import("../src/lib/dm/authored-hooks.ts");
    world.patch(mage.id, { currentHp: 10 });
    const kill = (module) => module.authoredOnKill(world.campaign(), world.encounter(), e1, mage.id, false, { level: 1, school: "necromancy" });
    const first = kill(hooks);
    // Staging that fails is the suite breaking, not the gap: plain errors.
    if (!first.some((line) => /regains/.test(line))) {
      throw new Error(`setup: the first kill of the turn did not heal (${JSON.stringify(first)}); is the subclass's row held?`);
    }
    world.patch(mage.id, { currentHp: 10 });
    if (kill(hooks).some((line) => /regains/.test(line))) {
      throw new Error("setup: a second kill in the same turn heals again in the running server");
    }
    world.patch(mage.id, { currentHp: 10 });
    const fresh = await restarted("lib/dm/authored-hooks.ts");
    assert.deepEqual(kill(fresh).filter((line) => /regains/.test(line)), [], "after a restart, a second kill in the same turn heals again: the once-a-turn mark was in memory only");
  },
);

const counts = Object.values(REGISTRY).reduce((sum, entry) => ({ ...sum, [entry.kind]: (sum[entry.kind] ?? 0) + 1 }), {});
console.log(`sweep-lifecycle-restart: ${found.length} module-level stores under src/lib/dm classed: ${JSON.stringify(counts)}; Grim Harvest's mark is shown by running across a restart`);
finish();
