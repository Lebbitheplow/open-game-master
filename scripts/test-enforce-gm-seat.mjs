// The GM seat's cards (issue 685 audit, 4.G and section 7's "Left open"):
//
//   - At a table a person runs, a legendary creature's legendary actions and
//     the lair's are cards of the monsters' Hand, offered only while they can
//     be taken (SRD 5.1: one at a time, at the end of another creature's
//     turn, from the actions left this round; the lair on initiative count
//     20, losing ties, once a round), and played through the console's own
//     invoke route with the same tools as its forms, which refuse them with
//     the same sentences. The console's legendary_action form spent one on
//     the creature's own turn while it was held for a person (`due`).
//   - At a live table the AI runs with a person steering ("steered"), the AI
//     plays the enemies and the allies nobody commands: the steering seat is
//     shown no monsters' Hand and no ally's, and the routes refuse their
//     cards, while the console's forms correct the fight as before.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-gm-seat");

const campaigns = await import("../src/lib/db/campaigns.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { deriveMonsterHand, monsterCalls } = await import("../src/lib/battlemap/monster-hand.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { personRunsTable } = await import("../src/lib/dm/enemies-due.ts");
const { hasHumanDm } = await import("../src/lib/dm/viewer.ts");
const { AI_PLAYS_FOES, aiRunsFoes, aiTurnRefusal } = await import("../src/lib/workshop/test-seats-logic.ts");

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const DRAGON = {
  ac: 18,
  maxHp: 200,
  dexMod: 0,
  saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  speed: "40 ft.",
  attacks: [{ name: "Tail", toHit: 11, damage: "2d8+6", type: "bludgeoning", mode: "melee", reach: 15 }],
  attacksPerTurn: 1,
  specials: [],
  traits: [
    "Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead.",
    "The dragon can take 3 legendary actions, choosing from the options below.",
    "Legendary action: Detect. The dragon makes a Wisdom (Perception) check.",
    "Legendary action: Tail Attack. The dragon makes a tail attack.",
    "Legendary action: Wing Attack (Costs 2 Actions). The dragon beats its wings. Each creature within 10 feet of the dragon must succeed on a DC 22 Dexterity saving throw or take 15 (2d6 + 8) bludgeoning damage and be knocked prone.",
    "Lair action: Magma erupts from a point on the ground. Each creature in the geyser's area must make a DC 15 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one.",
    "Lair action: The ground shakes; each creature makes a DC 15 Dex save or falls prone.",
  ],
  resist: "",
  immune: "fire",
  vulnerable: "",
  conditionImmune: "",
  cr: 13,
  xp: 10000,
  size: "Huge",
};

async function post(world, name, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// A person in the GM seat holding no character.
function seatGm(world, mode) {
  const gm = world.addUser("gm");
  const status = world.campaign().status;
  campaigns.setCampaignStatus(world.campaignId, "lobby");
  assert.ok(campaigns.joinByInviteCode(gm.id, world.campaign().inviteCode).campaign, "the GM joins");
  campaigns.setCampaignStatus(world.campaignId, status);
  assert.equal(campaigns.setDmMode(world.campaignId, mode, gm.id)?.dmUserId, gm.id, "the GM takes the seat");
  return gm;
}

// The dragon's row as the GM's view projects it, and its cards.
function dragonHand(world, dragonId) {
  const view = activePublicEncounter(world.campaignId, { enemyNumbers: true });
  const row = view.enemies.find((enemy) => enemy.id === dragonId);
  return { row, cards: deriveMonsterHand(row, { enemyActions: true, legendaryCards: true }) };
}

// Plays a card as MonsterHand.tsx does: each call in order (one for a
// legendary card), marked as a card, stopping at the first refusal.
async function play(world, card, targets, user) {
  const calls = monsterCalls(card, targets);
  assert.ok(calls, `${card.name} needs a target`);
  const answers = [];
  for (const call of calls) {
    const out = await post(world, "dm/invoke", { ...call, hand: true }, user);
    answers.push(out);
    if (out.status !== 200) {
      break;
    }
  }
  return answers;
}

// Kara and a dragon beside her, at a table a person runs; Kara's turn.
async function dragonTable() {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", maxHp: 120 });
  const gm = seatGm(world, "human");
  await kit.fight(1, { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
  const [foe] = world.enemies();
  kit.setEnemy(foe.id, { ac: DRAGON.ac, maxHp: DRAGON.maxHp, stats: DRAGON });
  kit.place(kara.id, 5, 2);
  kit.place(foe.id, 6, 2);
  kit.giveTurn(kara.id);
  return { world, kit, kara: world.sheet(kara.id), gm, dragon: world.enemies()[0] };
}

await test("At a person's table the dragon's legendary actions are its cards at the end of Kara's turn, played through the console's tools: one at a turn's end, from what is left", async () => {
  const { world, kara, gm, dragon } = await dragonTable();
  const { row, cards } = dragonHand(world, dragon.id);
  assert.deepEqual([row.actions.legendary.left, row.actions.legendary.max], [3, 3]);
  const tail = cards.find((card) => card.name === "Tail Attack");
  assert.equal(tail.cost, "legendary");
  assert.equal(tail.disabled, null);

  const hp = world.sheet(kara.id).currentHp;
  world.dice(19, 8, 8);
  const answers = await play(world, tail, [kara.id], gm);
  world.clearDice();
  // One call: the spend and the swing together (legendary-play.ts).
  assert.deepEqual(answers.map((out) => out.status), [200], JSON.stringify(answers.map((out) => out.body)));
  assert.equal(answers[0].body.result.remaining, 2);
  assert.equal(answers[0].body.result.hit, true);
  assert.equal(world.encounter().legendary.pools[dragon.id].actions, 2, "one legendary action spent");
  assert.ok(world.sheet(kara.id).currentHp < hp, "the tail landed");
  assert.ok(listRecentRolls(world.campaignId, 5).some((roll) => roll.kind === "attack"), "the attack was rolled");

  // One at the end of a turn: none is offered again until another ends,
  // and the console's form hears the tool's own sentence.
  assert.equal(dragonHand(world, dragon.id).row.actions.legendary, undefined);
  const again = await post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: dragon.id, action: "Detect" } }, gm);
  assert.equal(again.status, 409);
  assert.match(again.body.error, /has already taken a legendary action at the end of this turn/);

  // Kara's turn ends: the next turn's end opens with two left; Wing Attack
  // costs two, and plays its save on everyone caught.
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, round: encounter.round + 1 });
  const next = dragonHand(world, dragon.id);
  assert.equal(next.row.actions.legendary.left, 2);
  const wing = next.cards.find((card) => card.name === "Wing Attack");
  assert.equal(wing.disabled, null);
  world.dice(1);
  const blown = await play(world, wing, [kara.id], gm);
  world.clearDice();
  assert.deepEqual(blown.map((out) => out.status), [200], JSON.stringify(blown.map((out) => out.body)));
  assert.equal(world.encounter().legendary.pools[dragon.id].actions, 0);
  assert.ok(world.sheet(kara.id).conditions.includes("prone"), "Kara failed the save and was knocked prone");
  // None left this round: no card.
  const encounter2 = world.encounter();
  encounters.saveEncounter({ ...encounter2, round: encounter2.round + 1 });
  assert.equal(dragonHand(world, dragon.id).row.actions.legendary, undefined, "with none left, none is offered");
});

await test("A legendary action is refused on the creature's own turn while a person plays it, the console's form included", async () => {
  const { world, gm, dragon } = await dragonTable();
  // The pointer walked past the dragon: its turn has begun, held for the GM.
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [dragon.id] } });
  assert.equal(dragonHand(world, dragon.id).row.actions.legendary, undefined, "no legendary card on its own turn");
  const own = await post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: dragon.id, action: "Detect" } }, gm);
  assert.equal(own.status, 409, JSON.stringify(own.body));
  assert.match(own.body.error, /It is .+'s own turn; legendary actions come at the end of other creatures' turns/);
  assert.equal(world.encounter().legendary.pools[dragon.id]?.actions ?? 3, 3, "nothing was spent");
});

await test("A legendary action is refused for the rest of the creature's own turn once it has acted, and offered again once its turn is handed on", async () => {
  const { world, kit, kara, gm, dragon } = await dragonTable();
  // Kara ends her turn: the pointer walks past the dragon, held for the GM.
  kit.giveTurn(kara.id);
  assert.equal((await post(world, "encounter/end-turn", {}, { id: kara.userId })).status, 200);
  assert.deepEqual(world.encounter().legendary.due, [dragon.id], "the dragon's turn waits on the GM");
  // The GM plays its Tail on its own turn.
  world.dice(19, 8, 8);
  const swing = await post(world, "dm/invoke", { name: "enemy_attack", args: { enemyId: dragon.id, targetCharacterId: kara.id } }, gm);
  world.clearDice();
  assert.equal(swing.status, 200, JSON.stringify(swing.body));
  // Still its own turn: the end of its own turn is no moment for one.
  assert.equal(dragonHand(world, dragon.id).row.actions.legendary, undefined, "no legendary card inside its own turn");
  const inside = await post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: dragon.id, action: "Detect" } }, gm);
  assert.equal(inside.status, 409, JSON.stringify(inside.body));
  assert.match(inside.body.error, /the end of its own turn is not one/);
  assert.equal(world.encounter().legendary.pools[dragon.id]?.actions ?? 3, 3, "nothing was spent");
  // The GM hands the turn on: Kara's turn, whose end is the next one's.
  kit.handOnEnemies();
  assert.ok(dragonHand(world, dragon.id).row.actions.legendary, "offered once its turn is over");
  const next = await post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: dragon.id, action: "Detect" } }, gm);
  assert.equal(next.status, 200, JSON.stringify(next.body));
});

await test("The lair acts on initiative count 20 from the dragon's card, once a round: its option's save lands on everyone caught", async () => {
  const { world, kara, gm, dragon } = await dragonTable();
  assert.equal(dragonHand(world, dragon.id).row.actions.lair, undefined, "not before the count has passed");
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, lair: true, lairDue: encounter.round, lairUsedRound: 0 } });
  const { cards } = dragonHand(world, dragon.id);
  const shake = cards.find((card) => card.name === "Lair: The ground shakes");
  assert.ok(shake, cards.map((card) => card.name).join(", "));
  assert.equal(shake.cost, "lair");
  world.dice(1);
  const answers = await play(world, shake, [kara.id], gm);
  world.clearDice();
  assert.deepEqual(answers.map((out) => out.status), [200, 200], JSON.stringify(answers.map((out) => out.body)));
  assert.ok(world.sheet(kara.id).conditions.includes("prone"));
  assert.equal(world.encounter().legendary.lairUsedRound, encounter.round);
  assert.equal(dragonHand(world, dragon.id).row.actions.lair, undefined, "the lair has acted this round");
  const twice = await post(world, "dm/invoke", { name: "lair_action", args: { action: "1" } }, gm);
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /already acted this round/);
});

// The audit's open question, answered from the code: at a live steered
// table the AI plays the enemies (src/lib/workshop/test-seats-logic.ts
// aiRunsFoes). Nobody in the seat narrates, so a move wakes the AI's turn,
// and no person is the one playing the monsters.
async function steeredTable() {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara" });
  const bot = createCompanionUser("Pip");
  const made = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(kara.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  const gm = seatGm(world, "steered");
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  kit.place(kara.id, 5, 2);
  kit.place(world.enemies()[0].id, 6, 2);
  return { world, kit, kara: world.sheet(kara.id), pip: world.sheet(made.id), gm, goblin: world.enemies()[0] };
}

await test("At a live steered table the AI plays the enemies: a monsters' Hand card from the steering seat is refused, and the console's form still corrects the fight", async () => {
  const { world, kara, gm, goblin } = await steeredTable();
  const campaign = world.campaign();
  assert.equal(campaign.kind, "campaign", "a live table, not a test");
  assert.equal(hasHumanDm(campaigns.campaignSeats(campaign)), false, "nobody in the seat narrates");
  assert.equal(personRunsTable(campaign), false, "no person plays the monsters");
  assert.equal(aiRunsFoes(campaign.gameSettings.dmMode), true);

  const before = listRecentRolls(world.campaignId, 50).length;
  for (const card of [
    { name: "enemy_attack", args: { enemyId: goblin.id, targetCharacterId: kara.id } },
    { name: "take_action", args: { enemyId: goblin.id, action: "dodge" } },
    { name: "enemy_flees", args: { enemyId: goblin.id, reason: "Breaks off and runs." } },
  ]) {
    const out = await post(world, "dm/invoke", { ...card, hand: true }, gm);
    assert.equal(out.status, 409, `${card.name}: ${JSON.stringify(out.body)}`);
    assert.equal(out.body.error, AI_PLAYS_FOES);
  }
  assert.equal(listRecentRolls(world.campaignId, 50).length, before, "a refused card rolled something");
  assert.equal(world.enemies()[0].status, "alive");

  // The console's own form, the steering seat's correction, still goes through.
  world.dice(19, 4);
  const form = await post(world, "dm/invoke", { name: "enemy_attack", args: { enemyId: goblin.id, targetCharacterId: kara.id } }, gm);
  world.clearDice();
  assert.equal(form.status, 200, JSON.stringify(form.body));
  // A correction that only touches an enemy is no card's business either way.
  const hurt = await post(world, "dm/invoke", { name: "apply_damage", args: { enemyId: goblin.id, amount: 1 }, hand: true }, gm);
  assert.equal(hurt.status, 200, JSON.stringify(hurt.body));
});

await test("At a live steered table an ally nobody commands is the AI's: the steering seat's card for it is refused with the reason", async () => {
  const { world, kit, pip, gm } = await steeredTable();
  kit.giveTurn(pip.id);
  const out = await post(world, "actions", { kind: "do", content: "Pip takes the Dodge action.", characterId: pip.id, intent: { card: "basic", action: "dodge" } }, gm);
  assert.equal(out.status, 409, JSON.stringify(out.body));
  assert.equal(out.body.error, aiTurnRefusal(world.campaign(), "Pip"));
  assert.match(out.body.error, /The AI GM plays Pip's turn at this table/);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "nothing was spent");
  // Table talk from the seat is free.
  const ooc = await post(world, "actions", { kind: "ooc", content: "Nice dodge.", characterId: pip.id }, gm);
  assert.notEqual(ooc.body.error, aiTurnRefusal(world.campaign(), "Pip"));
  // At a table a person runs, the same card is the GM's to play.
  campaigns.setDmMode(world.campaignId, "human", gm.id);
  const theirs = await post(world, "actions", { kind: "do", content: "Pip takes the Dodge action.", characterId: pip.id, intent: { card: "basic", action: "dodge" } }, gm);
  assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
});

await test("The screens follow the same rule at every steered table: no monsters' Hand and no ally's Hand for the steering seat, and the cards are marked as cards", () => {
  const view = read("app/campaigns/[campaignId]/SessionView.tsx");
  assert.match(view, /const aiRunsFoes = aiRunsFoesAt\(campaign\?\.gameSettings\?\.dmMode\);/);
  assert.doesNotMatch(view, /Boolean\(state\.testFight\) && aiRunsTest/, "the rule was a test table's only");
  assert.match(view, /aiRunsFoes=\{aiRunsFoes\}/);
  const composer = read("app/campaigns/[campaignId]/Composer.tsx");
  assert.match(composer, /\{!partyHand && !aiRunsFoes && hand\.encounter \? \(/);
  assert.match(composer, /const gmCompanions = isDm && hostOffers\(capabilities, "gmCompanionTurns"\) && !aiRunsFoes;/);
  const hand = read("app/campaigns/[campaignId]/MonsterHand.tsx");
  assert.match(hand, /body: JSON\.stringify\(\{ \.\.\.call, hand: true \}\)/);
  assert.match(hand, /legendaryCards: hostOffers\(capabilities, "legendaryCards"\)/);
  assert.equal(aiRunsFoes("human"), false);
  assert.equal(aiRunsFoes("assisted"), false);
});

finish();
