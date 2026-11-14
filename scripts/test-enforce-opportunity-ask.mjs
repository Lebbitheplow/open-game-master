// A character's opportunity attack is their player's to take. SRD 5.1,
// Opportunity Attacks: "You CAN make an opportunity attack when a hostile
// creature that you can see moves out of your reach. To make the opportunity
// attack, you use your reaction to make one melee attack against the
// provoking creature." The reaction is the same one Shield, Hellish Rebuke
// and Uncanny Dodge spend, so a player may want to keep it.
//
// The engine used to take the swing for them wherever an enemy walked
// (opportunity.ts resolvePcOpportunityWalk). Now a walk that would provoke a
// swing from a character whose player is at the table stops there and asks
// that player, Strike or Let it go, on a card held on the walk's call
// (held-call.ts, as a roll on real dice holds it); the walk goes on once they
// answer, every other swing of it taken in walk order as before. The card
// keeps a clock only while someone else is at the table, and the clock takes
// the swing. A companion, a seat whose player has gone, and a character who
// could not react anyway are never asked.
//
// Every door an enemy walks through asks the same way: the console's
// move_token, the AI's (a tool call and a model turn), enemy_attack's walk-up,
// enemy_flees, and the server's own play of a creature's skipped turn.
//
// Dice forced; every check reads a card, a sheet, the board, a stored roll or
// what the call answered.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { aiEngine, call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

process.env.DM_COMPACT_THRESHOLD ??= "1000000";
const { test, finish } = suite("test-enforce-opportunity-ask");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed" } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const ai = await aiEngine(world);
const { listOpenPendingRolls, getPendingRoll, getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { subscribe } = await import("../src/lib/events.ts");
const route = {
  // Missing on a build without the card: every case below then fails on its
  // first look for the card, not on the import.
  ask: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/opportunity").catch(() => null),
  submit: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
};

const karaUser = world.addUser("kara");
const anaUser = world.addUser("ana");
const orinUser = world.addUser("orin");
const kara = world.addHero({
  user: karaUser, name: "Kara", class: "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const ana = world.addHero({
  user: anaUser, name: "Ana", class: "rogue", level: 3, maxHp: 30, proficiencies: TRAINED,
  abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Dagger", qty: 1, equipped: true }],
});
const orin = world.addHero({
  user: orinUser, name: "Orin", class: "fighter", level: 4, maxHp: 40, proficiencies: TRAINED,
  abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
});

// Who is at the table: an open stream for the player, as the table's page
// keeps one (events.ts presence).
const here = new Map();
const arrive = (...users) => {
  for (const user of users) if (!here.has(user.id)) here.set(user.id, subscribe(world.campaignId, () => {}, user.id));
};
const leave = (...users) => {
  for (const user of users) {
    here.get(user.id)?.();
    here.delete(user.id);
  }
};

// One goblin (AC 13, 40 hp) at (5,7) on its own turn; the heroes far off
// until a test stands one somewhere.
let seenRolls = new Set();
async function stage({ hp = 40, present = [karaUser], count = 1 } = {}) {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  await kit.endFight();
  for (const hero of [kara, ana, orin]) {
    world.patch(hero.id, { currentHp: hero.maxHp, conditions: [], conditionMeta: {} });
    companion(hero, false);
    setMemberRealDice(world.campaignId, hero.userId, false);
  }
  leave(karaUser, anaUser, orinUser);
  arrive(...present);
  await kit.fight(count, { heroFaces: { [kara.id]: 20, [ana.id]: 18, [orin.id]: 16 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { stats: { ...DUMMY }, maxHp: 40, currentHp: hp });
  kit.place(kara.id, 19, 0);
  kit.place(ana.id, 19, 14);
  kit.place(orin.id, 19, 4);
  kit.place(goblin.id, 5, 7);
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === goblin.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
  world.clearDice();
  seenRolls = new Set(listRecentRolls(world.campaignId, 400).map((roll) => roll.id));
  return kit.enemy(goblin.id);
}

// The seat as a companion the party runs, written as companions.ts writes it.
const companion = (hero, on = true) => getDatabase().prepare("UPDATE character_sheets SET is_companion = ? WHERE id = ?").run(on ? 1 : 0, hero.id);
const asks = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "opportunity");
const reacted = (sheet) => world.encounter().reactionsUsed.some((key) => key.includes(sheet.id));
const at = (id) => {
  const token = kit.token(id);
  return token ? { x: token.x, y: token.y } : null;
};
// The character's attack rolls since the stage was set.
const swingsBy = (sheet) => listRecentRolls(world.campaignId, 400).filter((roll) => !seenRolls.has(roll.id) && roll.kind === "attack" && roll.characterId === sheet.id);
const walk = (goblin, x, y) => world.invoke("move_token", { token: goblin.id, x, y });

async function answer(ask, body, user) {
  world.signIn(user);
  const out = await call(route.ask, "POST", body, { campaignId: world.campaignId, pendingRollId: ask.id });
  await settleQueue(world.campaignId);
  return out;
}

// What the walk's call answered once it ran to its end.
const answered = (ask) => JSON.parse(getPendingRoll(ask.id)?.carry?.answer ?? "{}");

await test("A goblin walking off a present player's fighter stops and asks them: Strike, or Let it go, naming the weapon the swing would use.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.parked, true, `the walk took the swing for the player: ${JSON.stringify(out.result)}`);
  const [ask] = asks();
  assert.ok(ask, "no card asked Kara's player");
  assert.equal(ask.userId, karaUser.id);
  assert.equal(ask.characterId, kara.id);
  assert.equal(ask.carry?.ask?.walker, goblin.displayName);
  assert.match(String(ask.carry?.ask?.weapon), /longsword/i);
  assert.equal(ask.carry?.ask?.trigger, "leaves");
  assert.deepEqual(at(goblin.id), { x: 5, y: 7 }, "the goblin walked on before the player answered");
  assert.equal(reacted(kara), false, "the reaction was spent before the player answered");
  assert.equal(swingsBy(kara).length, 0, "the swing was rolled before the player answered");
});

await test("Strike: the swing is rolled, the reaction is spent, and the goblin finishes its walk.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  assert.ok(ask, "no card asked Kara's player");
  world.dice(15, 3);
  const out = await answer(ask, { strike: true }, karaUser);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(reacted(kara), true, "Strike spent no reaction");
  assert.equal(swingsBy(kara).length, 1, "Strike rolled no swing");
  assert.ok(kit.enemy(goblin.id).currentHp < 40, "the hit dealt nothing");
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 }, "the walk did not go on after the swing");
  assert.match(JSON.stringify(answered(ask).opportunityAttacks ?? []), /Kara/, JSON.stringify(answered(ask)));
  assert.equal(asks().length, 0, "the card stayed up");
});

await test("Let it go: nothing is rolled or spent, and the goblin walks on to where it was going.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  assert.ok(ask, "no card asked Kara's player");
  world.diceLog();
  const out = await answer(ask, { strike: false }, karaUser);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(reacted(kara), false, "letting it go spent the reaction");
  assert.equal(swingsBy(kara).length, 0, "letting it go rolled a swing");
  assert.equal(kit.enemy(goblin.id).currentHp, 40);
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 });
  assert.match(JSON.stringify(answered(ask).opportunityAttacks ?? []), /Kara lets .+ go/, JSON.stringify(answered(ask)));
});

await test("Only the player answers for their character: another player is refused.", async () => {
  const goblin = await stage({ present: [karaUser, anaUser] });
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  assert.ok(ask);
  const out = await answer(ask, { strike: false }, anaUser);
  assert.equal(out.status, 403, JSON.stringify(out.json));
  assert.equal(asks().length, 1);
});

// The walk meets Kara's reach first (she stands beside it), then Ana's (it
// passes her at (3,8) and leaves her side at (2,7)).
await test("Two characters along the walk are asked in walk order: Kara lets it go, then Ana is asked and strikes.", async () => {
  const goblin = await stage({ present: [karaUser, anaUser] });
  kit.place(kara.id, 6, 7);
  kit.place(ana.id, 3, 8);
  await walk(goblin, 0, 7);
  const [first] = asks();
  assert.equal(first?.characterId, kara.id, "Kara, whose reach the walk leaves first, was not asked first");
  await answer(first, { strike: false }, karaUser);
  const [second] = asks();
  assert.equal(second?.characterId, ana.id, "Ana was not asked once Kara let it go");
  world.dice(15, 2);
  await answer(second, { strike: true }, anaUser);
  assert.equal(reacted(kara), false);
  assert.equal(reacted(ana), true, "Ana's swing spent no reaction");
  assert.deepEqual(at(goblin.id), { x: 0, y: 7 });
  assert.equal(asks().length, 0);
});

await test("A Strike that drops the goblin ends the walk: the second character is never asked.", async () => {
  const goblin = await stage({ hp: 2, present: [karaUser, anaUser] });
  kit.place(kara.id, 6, 7);
  kit.place(ana.id, 3, 8);
  await walk(goblin, 0, 7);
  const [first] = asks();
  assert.equal(first?.characterId, kara.id);
  world.dice(15, 6);
  await answer(first, { strike: true }, karaUser);
  assert.notEqual(kit.enemy(goblin.id).status, "alive", "the goblin survived a hit for more than its hit points");
  assert.equal(asks().length, 0, "Ana was asked about a goblin already down");
  assert.equal(reacted(ana), false);
});

await test("With another player at the table the card has a clock, and when it runs out the swing is taken, saying the time ran out.", async () => {
  const { takeOpportunityWhenDue } = await import("../src/lib/dm/opportunity-ask-timer.ts");
  const goblin = await stage({ present: [karaUser, orinUser] });
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  assert.ok(ask?.carry?.ask?.deadline, `no deadline with another player online: ${JSON.stringify(ask?.carry)}`);
  assert.equal(await takeOpportunityWhenDue(ask.id), false, "the clock took the swing before its time");
  world.dice(15, 3);
  assert.equal(await takeOpportunityWhenDue(ask.id, Date.now() + 120_000), true);
  await settleQueue(world.campaignId);
  assert.equal(reacted(kara), true, "the clock let the goblin go");
  assert.equal(swingsBy(kara).length, 1);
  assert.match(JSON.stringify(answered(ask).opportunityAttacks ?? []), /did not answer in time/, JSON.stringify(answered(ask)));
});

await test("A player alone at the table is asked with no clock.", async () => {
  const goblin = await stage({ present: [karaUser] });
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  assert.ok(ask);
  assert.equal(ask.carry?.ask?.deadline, undefined, "a solo table got a clock");
});

await test("A player who has left the table is not asked: the swing is taken as before.", async () => {
  const goblin = await stage({ present: [orinUser] });
  kit.place(kara.id, 6, 7);
  world.dice(15, 3);
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.parked, undefined, JSON.stringify(out.result));
  assert.equal(asks().length, 0);
  assert.equal(reacted(kara), true);
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 });
});

await test("An AI-run companion is not asked: the swing is taken as before.", async () => {
  const goblin = await stage({ present: [karaUser] });
  companion(kara);
  assert.equal(world.sheet(kara.id).isCompanion, true, "the sheet would not be a companion");
  kit.place(kara.id, 6, 7);
  world.dice(15, 3);
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.equal(asks().length, 0);
  assert.equal(reacted(kara), true);
});

await test("A character whose reaction is already spent is not asked, and nothing is swung.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  saveEncounter({ ...world.encounter(), reactionsUsed: [kara.id] });
  const out = await walk(goblin, 2, 7);
  assert.equal(out.ok, true, out.error);
  assert.equal(asks().length, 0, "a card asked about a reaction already spent");
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 });
});

await test("A seat on real dice that strikes rolls the swing's own dice, as any attack of theirs.", async () => {
  const goblin = await stage();
  setMemberRealDice(world.campaignId, karaUser.id, true);
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  assert.ok(ask);
  await answer(ask, { strike: true }, karaUser);
  const dice = listOpenPendingRolls(world.campaignId).filter((pending) => pending.characterId === kara.id && pending.kind === "attack");
  assert.equal(dice.length, 1, "Strike threw the dice of a seat on real dice");
  assert.equal(dice[0].parkedFor, "real_dice");
});

await test("A screen that knows nothing of the card answers it as a roll: that is a Strike.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  await walk(goblin, 2, 7);
  const [ask] = asks();
  world.signIn(karaUser);
  world.dice(15, 3);
  const out = await call(route.submit, "POST", { fallback: "digital" }, { campaignId: world.campaignId, pendingRollId: ask.id });
  await settleQueue(world.campaignId);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(reacted(kara), true);
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 });
});

// ---- every door ----

await test("The AI's move_token asks as the console's does.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  ai.fresh();
  const out = await ai.invoke("move_token", { token: goblin.id, x: 2, y: 7 });
  assert.equal(out.ok, true, out.error);
  const [ask] = asks();
  assert.ok(ask, `the AI's walk took the swing for the player: ${JSON.stringify(out.result)}`);
  await answer(ask, { strike: false }, karaUser);
  assert.equal(reacted(kara), false);
  assert.deepEqual(at(goblin.id), { x: 2, y: 7 });
});

await test("A model turn's move_token waits on the card, and the turn goes on once the player answers.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 6, 7);
  model.script([reply({ calls: [modelCall("move_token", { token: goblin.id, x: 2, y: 7 })] }), reply({ text: "The goblin darts away." })]);
  world.say("system", "The goblin breaks off.");
  await startDmTurn(world.campaignId);
  const turnId = getLatestDmTurnId(world.campaignId);
  const [ask] = asks();
  assert.ok(ask, "the model turn's walk took the swing for the player");
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls");
  world.dice(15, 3);
  await answer(ask, { strike: true }, karaUser);
  assert.equal(reacted(kara), true);
  // Where the walk ended, as the call told the model: the goblin's turn,
  // still unplayed once the narration is in, is the server's to play after.
  assert.equal(answered(ask).at, "(2,7)", JSON.stringify(answered(ask)));
  assert.equal(getDmTurn(turnId).status, "done", "the turn never went on after the answer");
  assert.ok(model.requests.length >= 2, "the model was never asked to go on");
});

await test("enemy_attack's walk-up asks before the character beside it swings, then the goblin reaches its target.", async () => {
  const goblin = await stage({ present: [karaUser] });
  kit.place(kara.id, 6, 7);
  kit.place(ana.id, 1, 7);
  const out = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: ana.id });
  assert.equal(out.ok, true, out.error);
  const [ask] = asks();
  assert.ok(ask, `the walk-up took the swing for the player: ${JSON.stringify(out.result)}`);
  assert.deepEqual(at(goblin.id), { x: 5, y: 7 });
  world.dice(2, 10, 3);
  await answer(ask, { strike: true }, karaUser);
  assert.equal(reacted(kara), true);
  const now = at(goblin.id);
  assert.ok(Math.max(Math.abs(now.x - 1), Math.abs(now.y - 7)) === 1, `the goblin never reached Ana: (${now.x},${now.y})`);
});

await test("enemy_flees asks before the swing as it breaks away.", async () => {
  // A second goblin keeps the fight going once the first has fled.
  const goblin = await stage({ count: 2 });
  kit.place(kara.id, 6, 7);
  const out = await world.invoke("enemy_flees", { enemyId: goblin.id, reason: "its nerve breaks" });
  assert.equal(out.ok, true, out.error);
  const [ask] = asks();
  assert.ok(ask, `the flight took the swing for the player: ${JSON.stringify(out.result)}`);
  await answer(ask, { strike: false }, karaUser);
  assert.equal(reacted(kara), false);
  assert.equal(kit.enemy(goblin.id).status, "fled");
});

// The pass that hands a creature to a DM turn and plays it once the
// narration is in (encounter-tools.ts autoActSkippedEnemies), on its handoff
// as end_turn writes it.
await test("A creature's skipped turn the server plays (running in fear) asks too, and runs on once answered.", async () => {
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { autoActSkippedEnemies } = await import("../src/lib/dm/encounter-tools.ts");
  const { listSheets } = await import("../src/lib/db/sheets.ts");
  const goblin = await stage({ count: 2 });
  kit.setEnemy(goblin.id, { conditions: ["fleeing"] });
  kit.place(kara.id, 6, 7);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const encounter = world.encounter();
  saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [], handoff: { turnId: turn.id, enemyIds: [goblin.id] } } });
  const sheets = listSheets(world.campaignId);
  const rest = autoActSkippedEnemies(world.campaign(), getDmTurn(turn.id), world.encounter(), [goblin.id], sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
  const [ask] = asks();
  assert.ok(ask, `the server's play of the goblin's turn took the swing for the player: ${JSON.stringify(rest)}`);
  assert.deepEqual(at(goblin.id), { x: 5, y: 7 }, "it ran before the player answered");
  await answer(ask, { strike: false }, karaUser);
  assert.equal(reacted(kara), false);
  const now = at(goblin.id);
  assert.ok(now && Math.max(Math.abs(now.x - 6), Math.abs(now.y - 7)) > 1, `the goblin never ran from Kara: ${JSON.stringify(now)}`);
});

leave(karaUser, anaUser, orinUser);
await kit.endFight();
model.close();
world.close();
finish();
