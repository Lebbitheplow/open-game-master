// At a table the AI runs, a player on real dice is asked for initiative when
// the fight opens (play-test 2026-11-07, B3).
//
// The AI's fight rolls the initiative the server throws as it opens and told
// the model to request_roll the rest. Codex started two fights without that
// call: the panel sat on "Rolling initiative" with no card for either
// real-dice seat, and on the next turn the deadlock guard
// (encounter-tools.ts ensureInitiativeProgress) rolled their initiative
// digitally ("GM: your initiative is already recorded"). The turn now sends
// those seats their initiative roll cards the moment the fight opens, as a
// fight a person opens does (src/lib/dm/initiative-ask.ts), and waits for
// them as it waits for a request_roll's. Each total is written into the
// answer of the call that opened the fight (initiative-cards-logic.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-real-dice-initiative");

const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { fillInitiativeCard, holdsInitiativeCard, withInitiativeCards } = await import("../src/lib/dm/initiative-cards-logic.ts");
const { startFightAgainst } = await import("../src/lib/dm/encounter-tools.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

// An AI table that allows real dice: the lead (Bran) lets the server roll,
// Kara rolls her own dice.
async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false, dicePolicy: "real_allowed" } });
  const bran = world.addHero({ name: "Bran", class: "fighter", level: 3 });
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
  const karaUserId = world.sheet(kara.id).userId;
  setMemberRealDice(world.campaignId, karaUserId, true);
  const dm = await fakeModel();
  dm.pointAt(world);
  const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  return { world, bran, kara, karaUserId, dm, submitRoute };
}

const startCall = () => call("start_encounter", { enemies: [{ monster: "goblin", count: 1 }], summary: "Raiders at the quarry" });

// A character's initiative rolls, as the rolls table holds them.
function initiativeRollsOf(world, characterId) {
  return listRecentRolls(world.campaignId, 200).filter((roll) => roll.characterId === characterId && roll.kind === "initiative");
}

await test("a fight the AI opens without request_roll sends the real-dice player an initiative card, waits for it, and locks the order on her roll", async () => {
  const { world, bran, kara, karaUserId, dm, submitRoute } = await table();
  const opening = startCall();
  dm.script([
    reply({ text: "A goblin scrambles over the spoil heap, blade out.", calls: [opening] }),
    reply({ text: "Kara is quickest. What do you do?" }),
  ]);
  dm.claims([[]]);

  const narrated = await dm.turn(world, "We walk into the quarry.", bran.id);
  assert.equal(narrated, null, "the turn finished without waiting for Kara's initiative");
  const cards = listOpenPendingRolls(world.campaignId);
  assert.equal(cards.length, 1, `expected one initiative card, found ${cards.length}`);
  assert.equal(cards[0].kind, "initiative");
  assert.equal(cards[0].characterId, kara.id);
  assert.equal(cards[0].userId, karaUserId);
  assert.equal(cards[0].toolCallId, opening.id, "the card does not answer the call that opened the fight");
  assert.equal(getDmTurn(cards[0].turnId)?.status, "awaiting_rolls");
  const waiting = world.encounter();
  assert.equal(waiting.orderReady, false);
  assert.ok(waiting.order.some((entry) => entry.kind === "pc" && entry.characterId === bran.id), "Bran's initiative was not rolled");
  assert.equal(initiativeRollsOf(world, kara.id).length, 0, "the server rolled Kara's initiative");

  world.signIn({ id: karaUserId });
  const answered = await callRoute(submitRoute, "POST", { dice: [17] }, { campaignId: world.campaignId, pendingRollId: cards[0].id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  await settleQueue(world.campaignId);

  const fight = world.encounter();
  assert.equal(fight.orderReady, true, "the order never locked");
  const rolls = initiativeRollsOf(world, kara.id);
  assert.equal(rolls.length, 1, `Kara has ${rolls.length} initiative rolls`);
  assert.equal(rolls[0].requestedBy, "player");
  assert.match(rolls[0].detail, /physical/);
  const entry = fight.order.find((candidate) => candidate.kind === "pc" && candidate.characterId === kara.id);
  assert.equal(entry?.initiative, rolls[0].total);

  // The resumed model reads one answer to its start_encounter, with Kara's
  // total in it and the order's note in place of the wait.
  const last = dm.requests.at(-1);
  const answers = dm.results(last).filter((answer) => answer.id === opening.id);
  assert.equal(answers.length, 1, `the opening call has ${answers.length} answers`);
  const [card] = answers[0].result.initiativeCards;
  assert.equal(card.characterId, kara.id);
  assert.equal(card.total, rolls[0].total);
  assert.equal(card.waiting, undefined);
  assert.match(card.rolledBy, /physical dice/);
  assert.doesNotMatch(String(answers[0].result.next), /request_roll|waits/);
  dm.close();
  world.close();
});

await test("a model that also asks for her initiative in the same reply puts no second card in front of her", async () => {
  const { world, bran, kara, karaUserId, dm, submitRoute } = await table();
  const opening = startCall();
  const asked = call("request_roll", { kind: "initiative", characterId: kara.id, reason: "initiative" });
  dm.script([
    reply({ text: "A goblin bursts from the brush.", calls: [opening, asked] }),
    reply({ text: "Steel rings out. What do you do?" }),
  ]);
  dm.claims([[]]);

  await dm.turn(world, "We press on.", bran.id);
  const cards = listOpenPendingRolls(world.campaignId);
  assert.equal(cards.length, 1, `expected one initiative card, found ${cards.length}`);

  world.signIn({ id: karaUserId });
  const answered = await callRoute(submitRoute, "POST", { dice: [9] }, { campaignId: world.campaignId, pendingRollId: cards[0].id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  await settleQueue(world.campaignId);
  assert.equal(world.encounter().orderReady, true);
  const told = dm.results(dm.requests.at(-1)).find((answer) => answer.id === asked.id)?.result;
  assert.match(String(told?.error), /already with their player/, "the second ask was not refused");
  dm.close();
  world.close();
});

await test("the opening answer is left alone when nobody was asked, and a filled card stops the wait", () => {
  const result = { ok: true, next: "Every initiative is in; combat has begun." };
  assert.equal(withInitiativeCards(result, { rolled: [], waiting: [], waitingIds: [], combat: null }), result);

  const told = withInitiativeCards(
    { ok: true, initiative: "Bran 14", next: "Now call request_roll with kind=initiative for EACH character: Kara (characterId=k), Lia (characterId=l)." },
    { rolled: [], waiting: ["Kara", "Lia"], waitingIds: ["k", "l"], combat: null },
  );
  assert.equal(told.initiative, "Bran 14");
  assert.doesNotMatch(String(told.next), /call request_roll with/);
  assert.match(String(told.next), /Kara and Lia roll their own dice/);
  const content = JSON.stringify(told);
  assert.equal(holdsInitiativeCard(content, "k"), true);
  assert.equal(holdsInitiativeCard(content, "x"), false);
  assert.equal(holdsInitiativeCard("not json", "k"), false);

  const one = fillInitiativeCard(content, "k", { total: 12 });
  assert.equal(holdsInitiativeCard(one, "k"), false);
  assert.equal(holdsInitiativeCard(one, "l"), true);
  assert.match(String(JSON.parse(one).next), /roll their own dice/, "the wait ended with a card still out");
  const both = JSON.parse(fillInitiativeCard(one, "l", { total: 8, combat: "Combat begins. Initiative order: Bran, Kara, Lia." }));
  assert.equal(both.next, "Combat begins. Initiative order: Bran, Kara, Lia.");
  assert.deepEqual(both.initiativeCards.map((card) => card.total), [12, 8]);
});

// A fight no call of the model opened: a lasting companion turning on the
// party starts one of its own (turncoat.ts, through startFightAgainst), from
// the turn's own opening, the clock or a sheet's use. The deadlock guard then
// rolled the real-dice player's initiative before the model was asked. The
// turn now sends her card before the model speaks, and hands it the total.
await test("a fight opened outside a model call sends the real-dice player her card before the model speaks, and the guard rolls only the others", async () => {
  const { world, bran, kara, karaUserId, dm, submitRoute } = await table();
  const opened = startFightAgainst(getCampaignById(world.campaignId), "goblin", "A goblin turns on the party");
  assert.equal("error" in opened, false, JSON.stringify(opened));
  dm.script([reply({ text: "The goblin's knife flashes. Kara, you are quickest." })]);
  dm.claims([[]]);

  const narrated = await dm.turn(world, "We stand our ground.", bran.id);
  assert.equal(narrated, null, "the turn did not wait for Kara's initiative");
  assert.equal(dm.requests.length, 0, "the model spoke before every initiative was in");
  assert.equal(initiativeRollsOf(world, kara.id).length, 0, "the server rolled Kara's initiative");
  const cards = listOpenPendingRolls(world.campaignId);
  assert.equal(cards.length, 1, `expected one initiative card, found ${cards.length}`);
  assert.equal(cards[0].characterId, kara.id);
  assert.equal(getDmTurn(cards[0].turnId)?.status, "awaiting_rolls");
  assert.ok(world.encounter().order.some((entry) => entry.kind === "pc" && entry.characterId === bran.id), "Bran's initiative was not rolled");

  world.signIn({ id: karaUserId });
  const answered = await callRoute(submitRoute, "POST", { dice: [14] }, { campaignId: world.campaignId, pendingRollId: cards[0].id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  await settleQueue(world.campaignId);
  assert.equal(world.encounter().orderReady, true, "the order never locked");
  assert.equal(getDmTurn(cards[0].turnId)?.status, "done");
  assert.equal(dm.requests.length, 1);
  assert.match(JSON.stringify(dm.requests[0]), /Initiative rolled at the table/, "the model was not told her roll");
  dm.close();
  world.close();
});

// A Portent watch stop holds the calls behind an attack (foresight.ts) and
// runs them when the watcher answers (turn.ts runHeldCalls). One that ended
// the fight and one that opened the next sent the real-dice player's card,
// but the held run did not count the cards as waiting: the turn went on, the
// model narrated a fight still collecting initiative, and her total later
// landed on a turn that was over.
await test("a fight opened by a call a Portent stop held still waits for the real-dice player's card", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false, dicePolicy: "real_allowed" } });
  const kit = await combatKit(world);
  const seerUser = world.addUser("seer");
  const seer = world.addHero({ user: seerUser, name: "Seer", class: "wizard", level: 5 });
  // The watcher's player is at the table: an absent one is not stopped for.
  (await import("../src/lib/events.ts")).subscribe(world.campaignId, () => {}, seerUser.id);
  const bran = world.addHero({ name: "Bran", class: "fighter", level: 5, equipment: [{ name: "Longsword", qty: 1 }] });
  const karaUser = world.addUser("kara");
  const kara = world.addHero({ user: karaUser, name: "Kara", class: "fighter", level: 5 });
  const dm = await fakeModel();
  dm.pointAt(world);
  await kit.fight(1, { heroFaces: { [seer.id]: 2, [bran.id]: 19, [kara.id]: 5 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { currentHp: 1, maxHp: 1, ac: 5 });
  kit.place(bran.id, 5, 5);
  kit.place(goblin.id, 6, 5);
  world.patch(seer.id, { resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
  world.signIn(seerUser);
  const watching = await callRoute(await world.route("campaigns/[campaignId]/foresight"), "POST", { on: true, characterId: seer.id }, { campaignId: world.campaignId });
  assert.equal(watching.status, 200, JSON.stringify(watching.json));
  setMemberRealDice(world.campaignId, karaUser.id, true);

  const swing = call("pc_attack", { characterId: bran.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  const opening = startCall();
  dm.script([reply({ calls: [swing, opening] }), reply({ text: "More raiders pour over the ridge." })]);
  dm.claims([[]]);
  await dm.turn(world, "Bran cuts the goblin down.", bran.id);
  const stop = listOpenPendingRolls(world.campaignId).find((pending) => pending.parkedFor === "watch");
  assert.ok(stop, "the attack did not stop for the watching seer");

  world.dice(18, 8);
  world.signIn(seerUser);
  const passed = await callRoute(await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"), "POST", { pass: true }, { campaignId: world.campaignId, pendingRollId: stop.id });
  assert.equal(passed.status, 200, JSON.stringify(passed.json));
  await settleQueue(world.campaignId);
  world.clearDice();
  const card = listOpenPendingRolls(world.campaignId).find((pending) => pending.kind === "initiative");
  assert.ok(card, "no initiative card reached Kara in the new fight");
  assert.equal(card.characterId, kara.id);
  assert.equal(getDmTurn(card.turnId)?.status, "awaiting_rolls", "the turn went on without Kara's initiative");
  assert.equal(dm.requests.length, 1, "the model spoke before every initiative was in");

  world.signIn({ id: karaUser.id });
  const answered = await callRoute(await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"), "POST", { dice: [11] }, { campaignId: world.campaignId, pendingRollId: card.id });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  await settleQueue(world.campaignId);
  assert.equal(world.encounter().orderReady, true);
  assert.equal(getDmTurn(card.turnId)?.status, "done");
  dm.close();
  world.close();
});

finish();
