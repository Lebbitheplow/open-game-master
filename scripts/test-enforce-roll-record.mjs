// The one door a roll goes on record through (src/lib/dm/roll-record.ts,
// issue #915).
//
// Some rolls were stored and thrown on the dice stage and never shown in the
// chronicle, which draws a roll's card from the turn it was made in. The
// site had pushed the roll onto a copy of the turn that nobody saved, or was
// handed no turn at all: Sleep's pool of hit points, the dice of an authored
// spend, a creature's initiative as a fight opens. recordRoll stores a roll,
// sends it, adds it to its turn and says how it landed, and the helpers every
// such site already calls (rollCard, dmRoll, secretRoll, rollOwnDice) go
// through it.
//
// What is held here:
//   - inside a GM call a roll joins the call's own turn, once, whether its
//     site holds a copy of the turn or none;
//   - a call that parks takes its rolls back, off the turn as well;
//   - a turn other than the call's (a stand-in turn) keeps its own rolls;
//   - outside a call the roll is written to the turn's stored row, and a
//     copy of the turn saved afterwards does not write it away;
//   - a roll whose site posts a line for it joins no turn: one home;
//   - dice the player entered are on record and sent as physical, with
//     nothing for the site to carry, and dice the server threw as digital;
//   - at the engine: Sleep's pool and a creature's initiative are on the
//     turn of the call that rolled them.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { announced, homeProblem, lastSeq, rollHomes, rollMark, rollsAfter } from "./lib/roll-homes.mjs";

const { test, finish } = suite("test-enforce-roll-record");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);

const { closeStandInTurn, createDmTurn, getDmTurn, openStandInTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { isHeldPark, parkHeldCall, runHeld, takeDecided } = await import("../src/lib/dm/held-call.ts");
const { recordRoll } = await import("../src/lib/dm/roll-record.ts");
const { dmRoll, rollCard } = await import("../src/lib/dm/roll-card.ts");

const hero = world.addHero({ name: "Dicey", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED });
const mage = world.addHero({
  name: "Wim", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Sleep"], known: [], cantrips: [] },
});

const campaign = () => world.campaign();
const newTurn = () => createDmTurn(world.campaignId, [], "human_dm");
const storedIds = (turnId) => getDmTurn(turnId).rollIds;
const SPEC = { name: "roll_record_test", rawArguments: "{}", toolCallId: null };
// One roll of the hero's, as a site would hand it to the door.
const aRoll = (more = {}) => ({ campaignId: world.campaignId, characterId: hero.id, requestedBy: "dm", kind: "custom", detail: "a test die", result: rollExpression("1d6"), ...more });

await test("outside a GM call, a roll handed only its turn's id is on the turn's stored row, once", () => {
  const turn = newTurn();
  const roll = recordRoll(aRoll({ turnId: turn.id }));
  assert.deepEqual(storedIds(turn.id), [roll.id]);
  assert.equal(homeProblem(roll.id), null);
});

await test("a copy of the turn read before the roll and saved after it does not write the roll away", () => {
  const turn = newTurn();
  const older = getDmTurn(turn.id);
  const roll = recordRoll(aRoll({ turnId: turn.id }));
  older.callIndex += 1;
  saveDmTurn(older);
  assert.deepEqual(storedIds(turn.id), [roll.id], "the older copy's save dropped the roll");
  assert.deepEqual(older.rollIds, [roll.id], "the copy in hand does not know the roll it now holds");
});

await test("outside a GM call, a roll handed the turn in hand is on it and on the stored row, once each", () => {
  const turn = newTurn();
  const roll = recordRoll(aRoll({ turn }));
  assert.deepEqual(turn.rollIds, [roll.id]);
  assert.deepEqual(storedIds(turn.id), [roll.id]);
  saveDmTurn(turn);
  assert.deepEqual(storedIds(turn.id), [roll.id], "saved, the roll is on the turn twice");
});

await test("inside a GM call, a roll joins the call's own turn once, handed a copy of the turn or none", () => {
  const turn = newTurn();
  const copy = getDmTurn(turn.id);
  const made = runHeld(campaign(), turn, SPEC, () => [recordRoll(aRoll({ turn: copy })), recordRoll(aRoll()), recordRoll(aRoll({ turnId: turn.id }))]);
  assert.deepEqual(turn.rollIds, made.map((roll) => roll.id), "the call's turn does not hold its three rolls in order");
  saveDmTurn(turn);
  for (const roll of made) {
    assert.equal(homeProblem(roll.id), null, `roll ${roll.detail}`);
  }
});

await test("the helpers a site calls put their roll on the call's turn when handed no turn", () => {
  const turn = newTurn();
  const mark = rollMark();
  runHeld(campaign(), turn, SPEC, () => {
    rollCard(campaign(), null, hero.id, "custom", "a card's die", "1d6", null);
    dmRoll(world.campaignId, null, "custom", "the GM's die", "1d6");
  });
  saveDmTurn(turn);
  const rolls = rollsAfter(world.campaignId, mark);
  assert.deepEqual(rolls.map((roll) => roll.detail), ["a card's die", "the GM's die"]);
  assert.deepEqual(storedIds(turn.id), rolls.map((roll) => roll.id));
});

await test("a call that parks takes its rolls back: none on record, none on the turn", () => {
  const turn = newTurn();
  const mark = rollMark();
  const sheet = world.sheet(hero.id);
  const answer = runHeld(campaign(), turn, SPEC, () => {
    recordRoll(aRoll());
    parkHeldCall({
      sheet: { id: sheet.id, userId: sheet.userId, name: sheet.name }, kind: "custom", detail: "a die of their own", expression: "1d6",
      advantage: "none", dc: null, reason: "the test", visibility: "public", parkedFor: "real_dice", note: "Waiting on Dicey.",
    });
  });
  assert.ok(isHeldPark(answer), "the call did not park");
  assert.deepEqual(turn.rollIds, [], "the turn in hand kept a roll the call took back");
  assert.equal(rollsAfter(world.campaignId, mark).length, 0, "the roll outlived its call");
  saveDmTurn(turn);
  assert.deepEqual(storedIds(turn.id), []);
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
});

await test("a stand-in turn opened inside a call keeps the rolls made on it", () => {
  const turn = newTurn();
  let standIn;
  let roll;
  runHeld(campaign(), turn, SPEC, () => {
    standIn = openStandInTurn(world.campaignId);
    roll = recordRoll(aRoll({ turn: standIn }));
    closeStandInTurn(standIn);
  });
  saveDmTurn(turn);
  assert.deepEqual(storedIds(standIn.id), [roll.id]);
  assert.deepEqual(storedIds(turn.id), [], "the roll is on the call's turn as well as its own");
});

await test("a roll whose site posts a line for it joins no turn, and the line is its one home", () => {
  const turn = newTurn();
  const roll = runHeld(campaign(), turn, SPEC, () => recordRoll(aRoll({ turn, home: "line" })));
  saveDmTurn(turn);
  assert.deepEqual(storedIds(turn.id), []);
  assert.equal(homeProblem(roll.id), "on no turn and no line", "before its line is posted the roll has no home");
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "system", glyph: "die-d20", content: "Dicey rolls a test die.", rollIds: [roll.id] });
  assert.deepEqual(rollHomes(roll.id).turns, []);
  assert.equal(homeProblem(roll.id), null);
});

await test("a roll is sent once as the server's dice, and a roll no seat is sent is not sent", () => {
  const turn = newTurn();
  const seq = lastSeq(world.campaignId);
  const shown = recordRoll(aRoll({ turnId: turn.id }));
  const kept = recordRoll(aRoll({ turnId: turn.id, visibility: "dm", send: false }));
  assert.deepEqual(announced(world.campaignId, seq, shown.id).map((payload) => payload.source), ["digital"]);
  assert.equal(announced(world.campaignId, seq, kept.id).length, 0);
});

await test("dice the player entered are on record and sent as physical with nothing for the site to carry, and the server's own as digital", () => {
  const turn = newTurn();
  const seq = lastSeq(world.campaignId);
  const entered = { characterId: hero.id, kind: "saving_throw", outcome: rollExpression("1d20", () => 14), raw: true, landing: { physical: true, source: "physical" } };
  const made = runHeld(
    campaign(), turn, SPEC,
    () => {
      // The server's own die for the same character and kind, before the
      // player's is taken: it is not theirs.
      const before = recordRoll(aRoll({ kind: "saving_throw", detail: "a save the server threw" }));
      const decided = takeDecided(hero.id, "saving_throw");
      assert.ok(decided, "the run was not handed the player's roll");
      const theirs = recordRoll(aRoll({ kind: "saving_throw", detail: "a save", dc: 10, result: decided.outcome }));
      // A site that threw its dice where it stands says so.
      const after = recordRoll(aRoll({ kind: "saving_throw", detail: "another the server threw", landing: null }));
      return { before, theirs, after };
    },
    { decided: [entered], tape: [], recorded: new Map() },
  );
  assert.equal(getRoll(made.theirs.id).detail, "a save (physical)");
  assert.deepEqual(announced(world.campaignId, seq, made.theirs.id).map((payload) => payload.source), ["physical"], "the stage was told to throw a die the player had already rolled");
  for (const roll of [made.before, made.after]) {
    assert.doesNotMatch(getRoll(roll.id).detail, /physical/);
    assert.deepEqual(announced(world.campaignId, seq, roll.id).map((payload) => payload.source), ["digital"]);
  }
});

// ---- at the engine: sites that were handed no turn ----

await test("a creature's initiative, stored for the GM and handed no turn, is on the turn of the call that opened the fight", async () => {
  const mark = rollMark();
  // The mage first, so the next case casts on their own turn.
  await kit.fight(2, { heroFaces: { [mage.id]: 19, [hero.id]: 5 } });
  const rolls = rollsAfter(world.campaignId, mark).filter((roll) => roll.kind === "initiative" && roll.visibility === "dm");
  assert.ok(rolls.length > 0, "the opening rolled no creature's initiative");
  for (const roll of rolls) {
    assert.equal(homeProblem(roll.id), null, `${roll.detail}`);
  }
});

await test("Sleep's pool of hit points is on the turn of the call that cast it", async () => {
  const [enemy] = world.enemies();
  const mark = rollMark();
  const out = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Sleep", saveAbility: "wis", level: 1, condition: "unconscious" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  const pool = rollsAfter(world.campaignId, mark).find((roll) => /Sleep: hit points it can affect/.test(roll.detail));
  assert.ok(pool, "Sleep rolled no pool");
  assert.equal(homeProblem(pool.id), null);
  await kit.endFight();
});

world.close();
finish();
