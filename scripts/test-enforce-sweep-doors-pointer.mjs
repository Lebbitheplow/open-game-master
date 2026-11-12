// The turn pointer read as "whose turn it is".
//
// The pointer rests only on characters: while the enemies grouped before a
// hero take their turns it already sits on that hero (src/lib/dm/
// enemies-due.ts, held-turn.ts). Their turn has not begun. So everything a
// hero may do, or have done to them, on ANOTHER creature's turn must go the
// same way while the pointer rests on them and the enemies are still to act:
// a reaction attack, a shove that moves them, an enemy leaving their reach.
// A reader that asks only "is the pointer on this character" answers "it is
// your own turn" in the middle of the goblins'.
//
// The rows: every authored reaction that is one weapon attack (walked off
// AUTHORED_TABLE, src/lib/srd/authored-effects.ts, so one added next month is
// a row), and the off-turn things the engine does to or for any hero. Each
// is run twice from one staging, once on another hero's turn (the control,
// which must go through) and once on the holder's held turn, and the two
// answers must match. What an on-turn act does on a held turn is the
// blocking matrix's "held" state (test-enforce-sweep-doors-block-heroes.mjs).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { answer, doors as openDoors, passToEnemies, stageFight } from "./lib/sweep-doors.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-doors-pointer");

const { AUTHORED_TABLE } = await import("../src/lib/srd/authored-effects.ts");

const WORLD = { campaign: { maxPlayers: 8, startingLevel: 5 }, gameSettings: { ttsEnabled: false } };

// ---- the rows ----

const rows = [];
for (const [key, entry] of Object.entries(AUTHORED_TABLE)) {
  const [classId, feature] = key.split("::");
  for (const reaction of entry.reactions ?? []) {
    if (reaction.does?.kind !== "attack") {
      continue;
    }
    rows.push({
      id: `reaction-attack:${reaction.name}`,
      reaction,
      holder: { class: classId, subclass: entry.subclass ?? "", level: 20, maxHp: 150, features: [{ name: feature, source: "subclass" }, { name: reaction.name, source: "subclass" }] },
      doors: ["console", "ai"],
      call: (t, door) => t.doors[door]("use_reaction", { characterId: t.brom.id, feature: reaction.name, targetEnemyId: t.foes[0].id }),
      went: (out) => out.ok,
    });
  }
}
rows.push(
  {
    // A shove, a wave, a dragging tentacle: forced movement lands on a
    // creature on somebody else's turn.
    id: "forced-move", holder: {}, doors: ["console", "ai"],
    call: (t, door) => t.doors[door]("move_token", { token: t.brom.id, x: 6, y: 5, forced: true, reason: "the goblin's shove sends him staggering" }),
    went: (out) => out.ok,
  },
  {
    // The goblin beside the hero walks off: the server rolls the hero's
    // opportunity attack itself (the console's hand; the AI's enemy acts
    // only when its turn has come).
    id: "enemy-leaves-reach", holder: {}, doors: ["console"],
    call: (t, door) => t.doors[door]("move_token", { token: t.foes[0].id, x: 5, y: 9 }),
    went: (out) => out.ok && /opportunity/i.test(JSON.stringify(out.result)),
  },
);

// ---- what fails today, and what cannot be run ----

const SKIP = {
  "reaction-attack:Soul of Vengeance": "answers an attack by the creature under the holder's Vow of Enmity, on record: the bare staging has neither vow nor attack (the trigger is the spends sweep's to stage)",
  // A reaction is held to its trigger's record (src/lib/srd/trigger-table.ts,
  // SRD 5.1 Reactions: "an instant response to a trigger of some kind"): the
  // bare staging has nothing for these to answer, so the control cannot go
  // through. The spends sweep stages each trigger (scripts/lib/sweep-spends-walk.mjs).
  "reaction-attack:Opportunist": "answers a creature within 5 feet that another creature just hit, on record: the bare staging has no such hit (the trigger is the spends sweep's to stage)",
  "reaction-attack:Inspiring Surge": "answers the banneret's Action Surge this turn, on record: the bare staging has none (the trigger is the spends sweep's to stage)",
  "reaction-attack:Slayer's Counter": "answers a save the creature under Slayer's Prey forced on the holder, on record: the bare staging has neither (the trigger is the spends sweep's to stage)",
  "reaction-attack:Voice of Authority": "answers a spell of 1st level or higher the holder's cleric cast at them, on record (last-save.ts recordCast): the bare staging has no such spell (the trigger is the spends sweep's to stage)",
};

const HELD_AS_OWN = {
  where: "src/lib/dm/authored-reactions.ts authoredReaction, case \"attack\": `actingCombatantId(encounter) === ctx.sheet.id` reads the pointer alone; it should also ask turnHeldForEnemies (src/lib/dm/held-turn.ts)",
  severity: "medium",
  note: "Refused with \"answers what another creature does on its turn, and it is Brom's own turn\" while the goblins before Brom are taking theirs: the moment these reactions exist for (a creature moving or attacking beside the holder).",
};
const KNOWN = {
  ...Object.fromEntries(
    // Hold the Line now goes on a held turn as on any other hero's
    // (authored-reactions.ts asks turnHeldForEnemies); the four in SKIP wait
    // for their trigger. The entry stays for a reaction that regresses.
    ([]).flatMap((name) => ["console", "ai"].map((door) => [`reaction-attack:${name}|${door}`, HELD_AS_OWN])),
  ),
};

const RULE = "SRD 5.1, Reactions: \"A reaction is an instant response to a trigger of some kind, which can occur on your turn or on someone else's\"; The Order of Combat: \"Each participant in the battle takes a turn in initiative order\", so the enemies grouped before a hero act before that hero's turn begins (src/lib/dm/held-turn.ts).";

async function staged(row, held) {
  const world = await openWorld(WORLD);
  const t = await stageFight(world, { pet: false, bromIs: row.holder, ...(held ? { last: "brom" } : {}) });
  t.doors = await openDoors(world);
  if (held) {
    await passToEnemies(t, "brom");
  } else {
    t.kit.giveTurn(t.sera.id);
  }
  return t;
}

let walked = 0;
let skipped = 0;
const usedKnown = new Set();
const usedSkip = new Set();
for (const row of rows) {
  for (const door of row.doors) {
    const id = `${row.id}|${door}`;
    walked += 1;
    // The control: on another hero's turn the act goes through.
    const control = await staged(row, false);
    const plain = await row.call(control, door);
    if (SKIP[id] ?? SKIP[row.id]) {
      usedSkip.add(SKIP[id] ? id : row.id);
      skipped += 1;
      await test(`${id}: still cannot be played on another hero's turn, as SKIP says`, () => {
        assert.equal(row.went(plain), false, `${id} now goes through on another hero's turn: take it out of SKIP`);
      });
      continue;
    }
    await test(`${id}: goes through on another hero's turn`, () => {
      assert.equal(row.went(plain), true, `the control did not go through, so the held turn cannot be judged: ${answer(plain)}`);
    });
    const run = async () => {
      const t = await staged(row, true);
      const out = await row.call(t, door);
      assert.equal(row.went(out), true, `on the holder's held turn, with the goblins still to act: ${answer(out)} (on another hero's turn: ${answer(plain).slice(0, 80)})`);
    };
    if (KNOWN[id]) {
      usedKnown.add(id);
      await gap(id, { rule: RULE, ...KNOWN[id] }, run);
    } else {
      await test(`${id}: goes the same way on a held turn`, run);
    }
  }
}

await test("every KNOWN and SKIP entry names a row the sweep has", () => {
  assert.deepEqual(Object.keys(KNOWN).filter((id) => !usedKnown.has(id)), []);
  assert.deepEqual(Object.keys(SKIP).filter((id) => !usedSkip.has(id)), []);
});

console.log(`pointer: ${rows.length} rows, ${walked} row-doors walked, ${skipped} skipped with a reason`);
finish();
