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
//   - a storyteller's secret roll joins no turn, a GM call's own included,
//     and an AI GM's answer to a whisper stays out of the shared chat when
//     the only die its tools threw was behind the screen;
//   - dice the player entered are on record and sent as physical, with
//     nothing for the site to carry, and dice the server threw as digital;
//   - a check or save a tool rolls for a character (contest-roll.ts
//     rollCharacterCheck, rollFeatureSave; between-io.ts characterSave;
//     forced-save.ts rollCharacterSave) goes the same way: on the call's
//     turn, or the turn it is handed, and as the player's own when they
//     rolled its d20;
//   - a roll that is not public is handed to the door whole (request_roll
//     with a visibility, a creature's side of a contest) and is in the log
//     with its number taken out (src/lib/table-delivery.ts);
//   - an attack's and a creature's dice go the same way: a pet's save and a
//     coat of poison's damage, whose sites were handed no turn, are on the
//     turn of the call that rolled them;
//   - the dice thrown as a waiting d20 lands, outside any call (the hit's
//     damage, the swing queued behind it), are on the attack's turn, and the
//     d20 itself is listed ahead of them, on the turn and on the line a
//     person's turn posts;
//   - an opportunity attack's cards are on the line the strike posts, in a
//     GM call and out of one: its attack, its damage, then what the blow went
//     on to roll on its short turn. A death save's card is on its line the
//     same way, with the die of the stable wait a third success rolls. At
//     a table a person runs, such a roll its player entered is on that line
//     alone, not on the line the GM's call posts as well;
//   - the dice the clock throws inside a GM call (an item's charges at dawn,
//     a Ring of Regeneration's) are on that call's turn;
//   - at the engine: Sleep's pool and a creature's initiative are on the
//     turn of the call that rolled them.
//
// And one thing the door must not widen: the number gate for an AI GM's heal
// and apply_damage (src/lib/dm/ai-gate.ts) takes a bare number that equals a
// total the model asked for this turn. A roll that missed its turn was out of
// the gate's sight by that accident. It is on the turn now, and is the
// engine's own, spent as its call ends (src/lib/dm/held-call.ts
// spendOwnRolls), so it pays for no number the model sends.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { announced, homeProblem, lastSeq, rollHomes, rollMark, rollsAfter } from "./lib/roll-homes.mjs";

const { test, finish } = suite("test-enforce-roll-record");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);

const { closeStandInTurn, createDmTurn, getDmTurn, getLatestDmTurnId, listOpenPendingRolls, openStandInTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { rollPetSave } = await import("../src/lib/dm/pet-save-roll.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { insertPlayerWhisper } = await import("../src/lib/db/dm-whispers.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const { allocateSeq, setDmMode, setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { firstStoredAfter, getRoll } = await import("../src/lib/db/rolls.ts");
const { getSheetById } = await import("../src/lib/db/sheets.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { entryDice, rollExpression } = await import("../src/lib/dice.ts");
const { isHeldPark, parkHeldCall, runHeld, takeDecided } = await import("../src/lib/dm/held-call.ts");
const { recordRoll } = await import("../src/lib/dm/roll-record.ts");
const { dmRoll, rollCard, secretRoll } = await import("../src/lib/dm/roll-card.ts");
const { rollCharacterCheck, rollFeatureSave } = await import("../src/lib/dm/contest-roll.ts");
const { characterSave } = await import("../src/lib/dm/between-io.ts");
const { rollCharacterSave } = await import("../src/lib/dm/forced-save.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");

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

await test("a check or save a tool rolls for a character is on the call's turn handed none or a copy, and outside a call on the turn it is handed, once each", () => {
  const turn = newTurn();
  const mark = rollMark();
  const sheet = () => world.sheet(hero.id);
  runHeld(campaign(), turn, SPEC, () => {
    rollCharacterCheck(campaign(), sheet(), { skill: "athletics" }, "Dicey: a check handed no turn");
    rollCharacterCheck(campaign(), sheet(), { skill: "athletics" }, "Dicey: a check handed a copy", getDmTurn(turn.id));
    rollFeatureSave(campaign(), sheet(), "con", 10, "a feature's save");
    characterSave(campaign(), sheet(), { ability: "con", dc: 10, detail: "Dicey: CON save in a call" });
  });
  saveDmTurn(turn);
  const inCall = rollsAfter(world.campaignId, mark);
  assert.equal(inCall.length, 4, `the call stored ${inCall.length} rolls`);
  assert.deepEqual(storedIds(turn.id), inCall.map((roll) => roll.id));
  const other = newTurn();
  const outside = rollMark();
  rollCharacterCheck(campaign(), sheet(), { skill: "athletics" }, "Dicey: a check outside a call", other);
  const made = rollsAfter(world.campaignId, outside).map((roll) => roll.id);
  assert.equal(made.length, 1);
  assert.deepEqual(other.rollIds, made);
  assert.deepEqual(storedIds(other.id), made);
});

await test("a d20 the player entered for a check or save a tool rolls is on record and sent as theirs, by each helper", () => {
  const sheet = () => world.sheet(hero.id);
  const helpers = {
    rollCharacterCheck: ["skill_check", () => rollCharacterCheck(campaign(), sheet(), { skill: "athletics" }, "Dicey: Athletics")],
    rollFeatureSave: ["saving_throw", () => rollFeatureSave(campaign(), sheet(), "con", 10, "a feature's save")],
    characterSave: ["saving_throw", () => characterSave(campaign(), sheet(), { ability: "con", dc: 10, detail: "Dicey: CON save" })],
    rollCharacterSave: ["saving_throw", (turn) => rollCharacterSave(campaign(), turn, sheet(), "con", 10, "Dicey: CON save, forced")],
  };
  for (const [name, [kind, roll]] of Object.entries(helpers)) {
    const turn = newTurn();
    const seq = lastSeq(world.campaignId);
    const mark = rollMark();
    const entered = { characterId: hero.id, kind, outcome: rollExpression("1d20", () => 14), raw: true, landing: { physical: true, source: "physical" } };
    runHeld(campaign(), turn, SPEC, () => void roll(turn), { decided: [entered], tape: [], recorded: new Map() });
    const made = rollsAfter(world.campaignId, mark);
    assert.equal(made.length, 1, `${name} stored ${made.length} roll(s)`);
    assert.match(made[0].detail, /\(physical\)$/, `${name}: the record does not say the dice were the player's`);
    assert.deepEqual(announced(world.campaignId, seq, made[0].id).map((payload) => payload.source), ["physical"], `${name}: the stage was told to throw a d20 the player had already rolled`);
    assert.deepEqual(turn.rollIds, [made[0].id], `${name}: the roll is not on the call's turn once`);
  }
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

await test("a turn and another turn's id handed together: the roll joins the turn the id names, and only that one", () => {
  const held = newTurn();
  const named = newTurn();
  const roll = recordRoll(aRoll({ turn: held, turnId: named.id }));
  saveDmTurn(held);
  assert.deepEqual(rollHomes(roll.id).turns, [named.id]);
});

await test("a call that saved its turn midway, opened a stand-in turn and then parked leaves nothing behind, and the rolls from before it stay once each", () => {
  const live = newTurn();
  const byId = recordRoll(aRoll({ turnId: live.id }));
  const inHand = recordRoll(aRoll({ turn: live }));
  const mark = rollMark();
  const sheet = world.sheet(hero.id);
  let standIn = null;
  const out = runHeld(campaign(), live, SPEC, () => {
    recordRoll(aRoll());
    saveDmTurn(live);
    standIn = openStandInTurn(world.campaignId);
    recordRoll(aRoll({ turn: standIn }));
    rollCard(campaign(), null, hero.id, "custom", "a card handed no turn", "1d6", null);
    parkHeldCall({ sheet: { id: sheet.id, userId: sheet.userId, name: sheet.name }, kind: "custom", detail: "a die to wait on", expression: "1d6", advantage: "none", dc: null, reason: "the roll record's test", visibility: "public", parkedFor: "real_dice", note: "wait" });
  });
  assert.equal(isHeldPark(out), true, "the call did not park");
  assert.equal(rollsAfter(world.campaignId, mark).length, 0, "a parked call left a roll on record");
  assert.equal(getDmTurn(standIn.id), null, "a parked call left its stand-in turn");
  saveDmTurn(live);
  const stored = storedIds(live.id);
  assert.deepEqual([...stored].sort(), [byId.id, inHand.id].sort());
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
});

await test("a storyteller's secret roll, handed no turn, joins none: not the GM call's own turn either, whose cards every seat's message names", () => {
  const turn = newTurn();
  let rollId = "";
  runHeld(campaign(), turn, SPEC, () => {
    rollId = secretRoll(world.campaignId, null, hero.id, "skill_check", "Deception, in secret", "1d20").rollId;
    return {};
  });
  saveDmTurn(turn);
  assert.equal(getRoll(rollId)?.visibility, "secret");
  assert.deepEqual(rollHomes(rollId), { turns: [], lines: [] });
  assert.equal(storedIds(turn.id).includes(rollId), false);
});

// ---- at the engine: sites that were handed no turn ----

await test("a creature's initiative, stored for the GM and handed no turn, is on the turn of the call that opened the fight", async () => {
  const mark = rollMark();
  // The mage first, so the next case casts on their own turn.
  await kit.fight(2, { heroFaces: { [mage.id]: 19, [hero.id]: 5 } });
  const rolls = rollsAfter(world.campaignId, mark).filter((roll) => roll.kind === "initiative" && roll.visibility === "dm");
  assert.ok(rolls.length > 0, "the opening rolled no creature's initiative");
  const opening = getLatestDmTurnId(world.campaignId);
  for (const roll of rolls) {
    assert.equal(homeProblem(roll.id), null, `${roll.detail}`);
    assert.deepEqual(rollHomes(roll.id).turns, [opening], `${roll.detail}: on another turn than the opening's`);
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
  assert.deepEqual(rollHomes(pool.id).turns, [getLatestDmTurnId(world.campaignId)], "the pool is on another turn than the cast's");
  await kit.endFight();
});

// ---- attacks and creatures ----

await test("a roll that joins a list late belongs ahead of the first roll stored after it, or at the end", () => {
  const [first, second, third] = [recordRoll(aRoll()), recordRoll(aRoll()), recordRoll(aRoll())];
  assert.equal(firstStoredAfter(first.id, [third.id, second.id]), third.id, "the first of the list that came after it, in the list's order");
  assert.equal(firstStoredAfter(second.id, [first.id, third.id]), third.id);
  assert.equal(firstStoredAfter(third.id, [first.id, second.id]), null);
  assert.equal(firstStoredAfter("no such roll", [first.id]), null);
});

await test("a pet's save handed no turn is on the call's turn, once, and outside a call on the turn it is handed", async () => {
  const summoned = await world.invoke("summon_pet", { characterId: hero.id, kind: "other", form: "wolf", name: "Patch" });
  assert.equal(summoned.ok, true, `refused: ${summoned.error}`);
  const owner = () => world.sheet(hero.id);
  const save = (turn, source) => rollPetSave(campaign(), turn, owner(), owner().pets[0], { ability: "dex", dc: 10, magical: false, source });
  const turn = newTurn();
  const mark = rollMark();
  runHeld(campaign(), turn, SPEC, () => {
    save(null, "a zone, handed no turn");
    save(getDmTurn(turn.id), "a rider, handed a copy");
  });
  saveDmTurn(turn);
  const inCall = rollsAfter(world.campaignId, mark);
  assert.equal(inCall.length, 2, `the call stored ${inCall.length} rolls`);
  assert.deepEqual(storedIds(turn.id), inCall.map((roll) => roll.id));
  const other = newTurn();
  const outside = rollMark();
  save(other, "a blast, outside a call");
  const made = rollsAfter(world.campaignId, outside).map((roll) => roll.id);
  assert.equal(made.length, 1);
  assert.deepEqual(other.rollIds, made);
  assert.deepEqual(storedIds(other.id), made);
  world.patch(hero.id, { pets: [] });
});

await test("the dice a coat of poison adds to a hit are on the turn of the attack, whose site was handed none", async () => {
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Poison, Basic (vial)", qty: 1 }] });
  const coated = await world.invoke("use_item", { characterId: hero.id, item: "Poison, Basic (vial)" });
  assert.equal(coated.ok, true, `refused: ${coated.error}`);
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [mage.id]: 5 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const mark = rollMark();
  // The d20, the sword's d8, the creature's save (a 1 fails DC 10), the d4.
  const swing = await kit.swing(hero.id, enemy.id, [15, 5, 1, 3]);
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  const rolls = rollsAfter(world.campaignId, mark);
  const poison = rolls.find((roll) => /basic poison/i.test(roll.detail));
  await kit.endFight();
  world.patch(hero.id, { conditions: [], conditionMeta: {} });
  assert.ok(poison, `the coat rolled no damage: ${rolls.map((roll) => roll.detail).join(", ")}`);
  assert.equal(poison.attacker?.id, hero.id, "the coat's damage names another roller than the one who struck");
  assert.equal(homeProblem(poison.id), null);
  assert.deepEqual(rollHomes(poison.id).turns, rollHomes(swing.toHit.id).turns, "the coat's dice are on another turn than the attack's");
});

// A fighter holding a Bardic Inspiration die swings at AC 15 and rolls an 11:
// the miss waits on their choice. Spending the die makes it a hit, outside any
// GM call, and the server throws the damage there and then
// (src/lib/dm/pc-attack-parked.ts, pc-attack-resolve.ts serverBlow).
async function waitingSwing(table, tableKit, attacks = 1) {
  const fighter = table.addHero({
    user: table.addUser(), name: "Reya", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });
  await tableKit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  const [enemy] = table.enemies();
  tableKit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15 });
  tableKit.place(fighter.id, 5, 5);
  tableKit.place(enemy.id, 5, 6);
  table.patch(fighter.id, { conditions: ["bardic inspiration (d8)"] });
  const target = { targetEnemyId: enemy.id };
  return { fighter, enemy, args: { characterId: fighter.id, attacks: Array.from({ length: attacks }, () => target) } };
}

await test("at a table a person runs, the damage the server throws once a waiting d20 lands is on the attack's turn, and the line lists the attack before it", async () => {
  const table = await openWorld();
  assert.ok(setDmMode(table.campaignId, "human", table.owner.id)?.dmUserId, "the owner takes the GM's seat");
  const tableKit = await combatKit(table);
  const { fighter, args } = await waitingSwing(table, tableKit);
  table.dice(5);
  const swing = await table.invoke("pc_attack", args);
  table.clearDice();
  assert.equal(swing.ok, true, `refused: ${swing.error}`);
  const [pending] = listOpenPendingRolls(table.campaignId);
  assert.equal(pending?.parkedFor, "after_roll", "the miss does not wait on the die");
  const mark = rollMark();
  table.signIn({ id: table.sheet(fighter.id).userId });
  // The Bardic die (11 + 6 hits AC 15), then the sword's d8.
  table.dice(6, 4);
  const out = await callRoute(await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"), "POST", { use: "bardic" }, { campaignId: table.campaignId, pendingRollId: pending.id });
  table.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const made = rollsAfter(table.campaignId, mark);
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage"]);
  const [toHit, damage] = made;
  assert.equal(homeProblem(damage.id), null, "the damage the server threw");
  assert.deepEqual(rollHomes(damage.id).turns, [pending.turnId]);
  const note = listRecentMessages(table.campaignId, 50).filter((message) => message.authorType === "system" && message.rollIds?.includes(toHit.id)).at(-1);
  assert.ok(note, "the landing posted no line");
  assert.deepEqual(note.rollIds, [toHit.id, damage.id], "the line does not list the attack and then its damage");
  table.close();
});

await test("on an AI's turn, the damage the server throws once a waiting d20 lands, and the swing queued behind it, are on the turn in the order they were rolled", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false } });
  const tableKit = await combatKit(table);
  const model = await fakeModel();
  try {
    model.pointAt(table);
    const { fighter, args } = await waitingSwing(table, tableKit, 2);
    model.script([reply({ calls: [modelCall("pc_attack", args)] }), reply({ text: "Steel rings twice." })]);
    table.dice(5);
    await model.turn(table, "I swing twice at the goblin.", fighter.id, table.sheet(fighter.id).userId);
    table.clearDice();
    const [pending] = listOpenPendingRolls(table.campaignId);
    assert.equal(pending?.parkedFor, "after_roll", "the first swing does not wait on the die");
    const mark = rollMark();
    table.signIn({ id: pending.userId });
    // The die (a hit), its damage, then the second swing: a 12 and its damage.
    table.dice(6, 4, 12, 5);
    const out = await callRoute(await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"), "POST", { use: "bardic" }, { campaignId: table.campaignId, pendingRollId: pending.id });
    table.clearDice();
    assert.equal(out.status, 200, JSON.stringify(out.json));
    await settleQueue(table.campaignId);
    const made = rollsAfter(table.campaignId, mark);
    assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage", "attack", "damage"]);
    assert.deepEqual(getDmTurn(pending.turnId).rollIds, made.map((roll) => roll.id), "the turn does not hold the four rolls in the order they were made");
    for (const roll of made) {
      assert.equal(homeProblem(roll.id), null, `${roll.kind} "${roll.detail}"`);
    }
  } finally {
    model.close();
    table.close();
  }
});

// Every roll_result the log holds for a roll, read from the table itself:
// the reader every seat replays through leaves out a roll behind the screen.
const logged = (rollId) =>
  getDatabase()
    .prepare("SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND type = 'roll_result'")
    .all(world.campaignId)
    .map((row) => JSON.parse(row.payload_json))
    .filter((payload) => payload.roll?.id === rollId);

await test("a requested roll that is not public, and a creature's side of a contest, are handed to the door whole and are in the log with their number taken out", async () => {
  const hiddenInLog = (roll, what) => {
    const rows = logged(roll.id);
    assert.equal(rows.length, 1, `${what} is in the log ${rows.length} time(s)`);
    assert.equal(rows[0].roll.total, null, `${what}: its total is in the log`);
    assert.equal(rows[0].roll.breakdown, null, `${what}: its dice are in the log`);
    assert.equal(rows[0].roll.hidden, true);
    assert.equal(homeProblem(roll.id), null, what);
  };
  for (const visibility of ["blind", "dm", "self"]) {
    const mark = rollMark();
    const out = await world.invoke("request_roll", { characterId: hero.id, kind: "skill_check", skill: "perception", dc: 10, visibility, reason: "a noise" });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    const [roll, ...more] = rollsAfter(world.campaignId, mark);
    assert.deepEqual(more, []);
    assert.equal(roll.visibility, visibility);
    assert.equal(typeof getRoll(roll.id).total, "number", "the record itself lost its number");
    hiddenInLog(roll, `a ${visibility} roll`);
  }
  await kit.fight(1);
  const [enemy] = world.enemies();
  const mark = rollMark();
  const out = await world.invoke("request_roll", { characterId: hero.id, kind: "skill_check", skill: "stealth", againstEnemyId: enemy.id, reason: "slipping past" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  const theirs = rollsAfter(world.campaignId, mark).find((roll) => roll.visibility === "dm" && /contest/.test(roll.detail));
  assert.ok(theirs, "the creature's side of the contest is on no record");
  hiddenInLog(theirs, "the creature's side of the contest");
  await kit.endFight();
});

await test("an AI GM's answer to a whisper stays out of the shared chat when the only die its tools threw was behind the screen, and that die is on the turn", async () => {
  const quiet = await openWorld();
  quiet.addHero({ name: "Host" });
  const player = quiet.addUser("p");
  const rook = quiet.addHero({ user: player, name: "Rook", gender: "Male", abilities: { cha: 20 } });
  await quiet.invoke("set_npc", { name: "Vela", gender: "Female", drawnTo: ["men"] });
  const bond = relationships.ensureRelationship({ campaignId: quiet.campaignId, characterId: rook.id, characterName: "Rook", subjectKind: "npc", subjectName: "Vela" });
  relationships.patchRelationship(bond.id, { approval: 80 });
  const model = await fakeModel();
  try {
    model.pointAt(quiet);
    insertPlayerWhisper(quiet.campaignId, player.id, rook.id, "Alone with Vela by the well, I ask if I may court her.");
    // romance_advance throws the NPC's consent die for the GM alone, handed
    // no turn (src/lib/dm/relationship-tools.ts).
    model.script([
      reply({
        calls: [
          modelCall("romance_advance", { characterId: rook.id, subject: "Vela", to: "interested" }),
          modelCall("send_whisper", { characterIds: [rook.id], message: "Vela answers you quietly, out of the others' hearing." }),
        ],
      }),
      reply({}), reply({}), reply({}), reply({}), reply({}),
    ]);
    const before = new Set(listRecentMessages(quiet.campaignId, 60).map((message) => message.id));
    await startDmTurn(quiet.campaignId);
    await settleQueue(quiet.campaignId);
    const turn = getDmTurn(getLatestDmTurnId(quiet.campaignId));
    const behind = turn.rollIds.map((id) => getRoll(id)).filter((roll) => roll?.visibility === "dm");
    assert.ok(behind.length > 0, "the consent die is not on the turn of the call that threw it");
    const spoken = listRecentMessages(quiet.campaignId, 60).filter((message) => !before.has(message.id) && message.authorType === "dm");
    assert.deepEqual(spoken.map((message) => message.content), [], "a private exchange wrote a GM line to the shared chat");
  } finally {
    model.close();
  }
});

// ---- opportunity attacks, death saves and the clock's dice ----

const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const { enemiesStrikeWalker } = await import("../src/lib/dm/opportunity-sides.ts");
const { strikePetsOnWalk } = await import("../src/lib/dm/opportunity-pets.ts");
const { rollDeathSave } = await import("../src/lib/dm/death.ts");
const { rechargeAtDawn } = await import("../src/lib/dm/item-charges.ts");
const { regenerationClock } = await import("../src/lib/dm/regeneration-ring.ts");
const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");

// The one line that carries these rolls' cards: it lists them in the order
// they were made, no other line lists any of them, and each has one home.
function onOneLine(rolls, what, table = world) {
  assert.ok(rolls.length, `${what}: no roll was made`);
  const lines = listRecentMessages(table.campaignId, 80).filter((message) => message.authorType === "system" && rolls.some((roll) => message.rollIds?.includes(roll.id)));
  assert.equal(lines.length, 1, `${what}: ${lines.length} lines list its rolls: ${lines.map((line) => line.content).join(" | ")}`);
  assert.deepEqual(lines[0].rollIds, rolls.map((roll) => roll.id), `${what}: the line does not list its rolls in the order they were made`);
  for (const roll of rolls) {
    assert.equal(homeProblem(roll.id), null, `${what}: ${roll.kind} "${roll.detail}"`);
  }
  return lines[0];
}

// On no turn: its line is its only home.
const onNoTurn = (rolls, what) => {
  for (const roll of rolls) {
    assert.deepEqual(rollHomes(roll.id).turns, [], `${what}: its ${roll.kind} is on a turn as well as on its line`);
  }
};

// A fight on a bare floor with everyone far apart, and its creatures.
async function bareFight(count = 1) {
  await kit.fight(count, { heroFaces: { [hero.id]: 19, [mage.id]: 5 } });
  kit.openField();
  kit.scatter();
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200 });
  }
  return enemies;
}

await test("a creature's opportunity attack on a character who walks away outside any GM call is on the line the strike posts: the attack, its damage, then the save its rider forced on the strike's short turn", async () => {
  const [enemy] = await bareFight();
  // A wolf's bite: a Strength save or be knocked prone.
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing", mode: "melee", onHit: { save: "str", dc: 11, condition: "prone" } }] } });
  kit.place(enemy.id, 5, 5);
  kit.place(mage.id, 6, 5);
  const mark = rollMark();
  // The creature's d20, its two damage dice, the mage's Strength save.
  world.dice(19, 2, 2, 5);
  const out = resolveOpportunityAttacks(campaign(), mage.id, { x: 6, y: 5 }, { x: 8, y: 5 }, false, [{ x: 7, y: 5 }, { x: 8, y: 5 }]);
  world.clearDice();
  const made = rollsAfter(world.campaignId, mark);
  await kit.endFight();
  assert.equal(out.notes.length, 1, `the walk posted ${out.notes.length} lines: ${out.notes.join(" ")}`);
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage", "saving_throw"], made.map((roll) => roll.detail).join(", "));
  const line = onOneLine(made, "the strike");
  assert.equal(line.content, out.notes[0]);
  const [toHit, damage, save] = made;
  assert.equal(toHit.attacker?.id, enemy.id);
  assert.equal(damage.attacker?.id, enemy.id);
  onNoTurn([toHit, damage], "the strike");
  assert.equal(rollHomes(save.id).turns.length, 1, "the save the rider forced is not on the strike's short turn");
});

await test("inside a GM call, a creature's opportunity attack is on the strike's line all the same, and not on the call's turn", async () => {
  const [enemy] = await bareFight();
  kit.place(enemy.id, 5, 5);
  kit.place(mage.id, 6, 5);
  const turn = newTurn();
  const mark = rollMark();
  world.dice(19, 4);
  const out = runHeld(campaign(), turn, SPEC, () => resolveOpportunityAttacks(campaign(), mage.id, { x: 6, y: 5 }, { x: 8, y: 5 }, false, [{ x: 7, y: 5 }, { x: 8, y: 5 }]));
  world.clearDice();
  saveDmTurn(turn);
  const made = rollsAfter(world.campaignId, mark);
  await kit.endFight();
  assert.equal(out.notes.length, 1, `the walk posted ${out.notes.length} lines: ${out.notes.join(" ")}`);
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage"]);
  onOneLine(made, "the strike");
  onNoTurn(made, "the strike");
  assert.deepEqual(storedIds(turn.id), [], "the call's turn lists the strike's dice");
});

await test("a character's opportunity swing at a creature the GM walks off is on the line the swing posts, and not on the turn of the call that moved the creature", async () => {
  const [enemy] = await bareFight();
  const carried = world.sheet(hero.id).equipment;
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  kit.enemyTurn(enemy.id);
  const mark = rollMark();
  // The fighter's d20 (a hit) and the sword's d8.
  world.dice(15, 5);
  const out = await world.invoke("move_token", { token: enemy.id, x: 9, y: 5 });
  world.clearDice();
  const made = rollsAfter(world.campaignId, mark).filter((roll) => /opportunity attack/.test(roll.detail));
  await kit.endFight();
  world.patch(hero.id, { equipment: carried });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage"]);
  const line = onOneLine(made, "the swing");
  assert.match(line.content, /opportunity attack/);
  assert.ok(made.every((roll) => roll.attacker?.id === hero.id), "the swing names another roller");
  onNoTurn(made, "the swing");
});

await test("at a table a person runs, an opportunity swing its player rolled on their own dice is on the swing's line alone, not on the line the GM's call posts as well", async () => {
  const table = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
  assert.ok(setDmMode(table.campaignId, "human", table.owner.id)?.dmUserId, "the owner takes the GM's seat");
  const tableKit = await combatKit(table);
  const fighter = table.addHero({
    user: table.addUser(), name: "Reya", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });
  await tableKit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  tableKit.openField();
  tableKit.scatter();
  const [enemy] = table.enemies();
  tableKit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200 });
  tableKit.place(fighter.id, 5, 5);
  tableKit.place(enemy.id, 6, 5);
  tableKit.enemyTurn(enemy.id);
  setMemberRealDice(table.campaignId, table.sheet(fighter.id).userId, true);
  const mark = rollMark();
  const walked = await table.invoke("move_token", { token: enemy.id, x: 9, y: 5 });
  assert.equal(walked.ok, true, `refused: ${walked.error}`);
  assert.equal(walked.result?.parked, true, `the walk did not wait on the seat's dice: ${JSON.stringify(walked.result)}`);
  // The seat enters its d20 (a hit), then the damage the call asks for next.
  const submit = await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  for (let round = 0; round < 4; round += 1) {
    const open = listOpenPendingRolls(table.campaignId).filter((pending) => pending.parkedFor === "real_dice");
    if (!open.length) {
      break;
    }
    for (const pending of open) {
      table.signIn({ id: pending.userId });
      const landed = await callRoute(submit, "POST", { dice: entryDice(pending.expression).map((sides) => (sides === 20 ? 15 : 3)) }, { campaignId: table.campaignId, pendingRollId: pending.id });
      assert.equal(landed.status, 200, JSON.stringify(landed.json));
    }
  }
  const made = rollsAfter(table.campaignId, mark).filter((roll) => /opportunity attack/.test(roll.detail));
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage"]);
  assert.ok(made.every((roll) => /\(physical\)$/.test(roll.detail)), "the seat's own dice are not on record as theirs");
  const line = onOneLine(made, "the swing", table);
  assert.match(line.content, /opportunity attack/);
  onNoTurn(made, "the swing");
  table.close();
});

await test("inside a GM call, a creature's opportunity attack on a pet walking off with its owner, and on a creature of the other side, are each on the line that strike posts and not on the call's turn", async () => {
  const [enemy] = await bareFight();
  world.patch(hero.id, { pets: [{ name: "Ember", kind: "familiar", form: "imp", hp: 30, maxHp: 30, ac: 10, speed: 20, attacks: [], notes: "" }] });
  kit.place(enemy.id, 5, 5);
  kit.place(hero.id, 6, 5);
  const turn = newTurn();
  let mark = rollMark();
  world.dice(15, 4);
  const atPet = runHeld(campaign(), turn, SPEC, () => strikePetsOnWalk(campaign(), hero.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }]));
  world.clearDice();
  let made = rollsAfter(world.campaignId, mark);
  world.patch(hero.id, { pets: [] });
  await kit.endFight();
  assert.equal(atPet.length, 1, `the pet's walk posted ${atPet.length} lines`);
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage"]);
  assert.equal(onOneLine(made, "the strike at the pet").content, atPet[0]);
  onNoTurn(made, "the strike at the pet");
  assert.ok(made.every((roll) => roll.attacker?.id === enemy.id && roll.characterId === hero.id), "the strike at the pet names another roller or owner");

  // Two creatures: the first fights for the party (Dominate Person) and
  // strikes the second as it walks off.
  const [turned, walker] = await bareFight(2);
  patchEnemyConditions(turned.id, ["charmed"], { charmed: { spell: "Dominate Person", source: hero.id } });
  kit.place(turned.id, 5, 5);
  kit.place(walker.id, 6, 5);
  mark = rollMark();
  world.dice(15, 4);
  const atWalker = runHeld(campaign(), turn, SPEC, () => enemiesStrikeWalker(world.campaignId, walker.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], 1));
  world.clearDice();
  saveDmTurn(turn);
  made = rollsAfter(world.campaignId, mark).filter((roll) => roll.visibility === "public");
  await kit.endFight();
  assert.equal(atWalker.length, 1, `the creature's walk posted ${atWalker.length} lines`);
  assert.deepEqual(made.map((roll) => roll.kind), ["attack", "damage"]);
  assert.equal(onOneLine(made, "the strike at the creature").content, atWalker[0]);
  onNoTurn(made, "the strike at the creature");
  assert.ok(made.every((roll) => roll.attacker?.id === turned.id), "the strike at the creature names another roller");
  assert.deepEqual(storedIds(turn.id), [], "the call's turn lists a strike's dice");
});

await test("a death save is on the line it posts and on no turn, outside a GM call and inside one, where a third success's line lists the save and then the die of the stable wait", () => {
  const dying = (successes = 0) => world.patch(hero.id, { currentHp: 0, deathSaves: { successes, failures: 0, stable: false, dead: false }, conditions: ["unconscious", "prone"], conditionMeta: {} });
  const saved = (mark) => rollsAfter(world.campaignId, mark);
  dying();
  let mark = rollMark();
  world.dice(12);
  const said = rollDeathSave(campaign(), hero.id);
  world.clearDice();
  let made = saved(mark);
  assert.deepEqual(made.map((roll) => roll.kind), ["saving_throw"]);
  assert.equal(onOneLine(made, "a death save outside a call").content, said);
  onNoTurn(made, "a death save outside a call");

  dying(2);
  const turn = newTurn();
  mark = rollMark();
  // The save, then the d4 of hours.
  world.dice(12, 3);
  runHeld(campaign(), turn, SPEC, () => rollDeathSave(campaign(), hero.id, turn.id));
  world.clearDice();
  saveDmTurn(turn);
  made = saved(mark);
  world.patch(hero.id, { currentHp: 44, deathSaves: null, conditions: [], conditionMeta: {} });
  assert.deepEqual(made.map((roll) => roll.kind), ["saving_throw", "custom"]);
  onOneLine(made, "a third success inside a call");
  onNoTurn(made, "a third success inside a call");
  assert.deepEqual(storedIds(turn.id), [], "the call's turn lists the save or the die of the stable wait");
});

await test("the dice the clock throws inside a GM call are on that call's turn: an item's charges at dawn and a Ring of Regeneration's", () => {
  world.patch(hero.id, {
    currentHp: 10,
    equipment: [{ name: "Wand of Magic Missiles", qty: 1, charges: 1 }, { name: "Ring of Regeneration", qty: 1, attuned: true, equipped: true }],
  });
  const turn = newTurn();
  const mark = rollMark();
  world.dice(3, 2);
  runHeld(campaign(), turn, SPEC, () => {
    rechargeAtDawn(world.campaignId, 0, 24 * 60);
    regenerationClock(world.campaignId, 0, 10);
  });
  world.clearDice();
  saveDmTurn(turn);
  const made = rollsAfter(world.campaignId, mark);
  world.patch(hero.id, { currentHp: 44, equipment: [] });
  assert.equal(made.length, 2, `the clock stored ${made.length} rolls: ${made.map((roll) => roll.detail).join(", ")}`);
  assert.match(made[0].detail, /Wand of Magic Missiles regains charges at dawn/);
  assert.match(made[1].detail, /Ring of Regeneration/);
  assert.deepEqual(storedIds(turn.id), made.map((roll) => roll.id), "the call's turn does not hold the clock's two rolls");
  for (const roll of made) {
    assert.equal(homeProblem(roll.id), null, roll.detail);
  }
});

// ---- a roll that joins its turn pays for no number of the model's ----

await test("an AI GM's bare heal equal to a Ring of Regeneration's dice is refused: thrown as its pass_time moved the clock, they are on the turn now, and spent as that call ends", async () => {
  world.patch(hero.id, { currentHp: 10, equipment: [{ name: "Ring of Regeneration", qty: 1, attuned: true, equipped: true }] });
  world.say("player", "We wait ten minutes for the rain to pass.", getSheetById(hero.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const call = (name, args) => invokeEngine(campaign(), { kind: "ai", turnId: turn.id }, { name, args });
  const mark = rollMark();
  world.dice(4);
  const waited = await call("pass_time", { amount: 10, unit: "minutes" });
  world.clearDice();
  assert.equal(waited.ok, true, `refused: ${waited.error}`);
  const found = rollsAfter(world.campaignId, mark).find((roll) => /Ring of Regeneration/.test(roll.detail));
  assert.ok(found, "the ring rolled nothing");
  const ring = getRoll(found.id);
  assert.deepEqual(rollHomes(ring.id).turns, [turn.id], "the ring's dice are not on the AI's turn");
  const before = world.sheet(hero.id).currentHp;
  const healed = await call("heal", { characterId: hero.id, amount: ring.total });
  const after = world.sheet(hero.id).currentHp;
  world.patch(hero.id, { currentHp: 44, equipment: [] });
  turn.status = "done";
  saveDmTurn(turn);
  assert.equal(healed.ok, false, `a bare heal of ${ring.total}, the total of the ring's dice, was taken and healed ${after - before}`);
  assert.equal(after, before);
});

await test("an AI GM's bare heal equal to Sleep's pool is refused: the pool is on the turn now, and it is the engine's own, spent as its call ends", async () => {
  await kit.fight(2, { heroFaces: { [mage.id]: 19, [hero.id]: 5 } });
  const [enemy] = world.enemies();
  world.patch(hero.id, { currentHp: 4 });
  // An AI GM's turn, after the mage's player has spoken (player-word.ts).
  world.say("player", "I cast Sleep on it.", getSheetById(mage.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const call = (name, args) => invokeEngine(campaign(), { kind: "ai", turnId: turn.id }, { name, args });
  const mark = rollMark();
  const cast = await call("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Sleep", saveAbility: "wis", level: 1, condition: "unconscious" });
  assert.equal(cast.ok, true, `refused: ${cast.error}`);
  const found = rollsAfter(world.campaignId, mark).find((roll) => /Sleep: hit points it can affect/.test(roll.detail));
  assert.ok(found, "Sleep rolled no pool");
  const pool = getRoll(found.id);
  assert.deepEqual(rollHomes(pool.id).turns, [turn.id], "the pool is not on the AI's turn");
  const healed = await call("heal", { characterId: hero.id, amount: pool.total });
  const hp = world.sheet(hero.id).currentHp;
  world.patch(hero.id, { currentHp: 44 });
  await kit.endFight();
  assert.equal(healed.ok, false, `a bare heal of ${pool.total}, the total of Sleep's pool, was taken and healed ${hp - 4}`);
  assert.equal(hp, 4);
});

world.close();
finish();
