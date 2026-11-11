// Three reaction gaps of issue 685 (the audit's 4.G):
//
// - A second hit replaced the first. The engine kept one record per
//   character, so when two enemies hit the same hero in one AI reply only
//   the second could be answered. Every hit still open is kept now, each with
//   its id; a reaction answers the one its player picks (use_reaction's
//   `hit`, the Hand's card, the console's "Attack answered"). SRD 5.1,
//   Shield: +5 AC "including against the triggering attack" until the start
//   of the caster's next turn, so Shield taken against the first hit also
//   re-checks every open hit after it; Uncanny Dodge halves one attack's
//   damage.
// - A companion had no reaction card. Its commander, or the GM seat for a
//   companion nobody commands at a table a person runs, is offered its
//   reactions now, and the actions route takes them off its turn; at a table
//   the AI runs, the narrator is told it may answer for one nobody commands.
// - A typed reaction spoke for the hero on turn. The composer's Speaking as
//   names another of the person's heroes with a hit to answer, and the
//   actions route takes the words as that hero's (`reaction`).
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { allocateSeq, listMembers, setDmMode } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { openHits, recordFall, snapshotVitals } = await import("../src/lib/dm/last-hit.ts");
const { describeIntent, directCardCall, intentNeedsTool } = await import("../src/lib/dm/intent-logic.ts");
const { characterAwaitingPlayer, declaredThisTurn } = await import("../src/lib/dm/player-word.ts");
const { holdSentReactions, offTurnReactionCards, reactionAim, reactionCards, reactionStrips } = await import("../src/lib/battlemap/hand-react.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { companionReactors, typedReactors } = await import("../src/lib/player-characters.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");
// Loaded before the waker below, which takes its place in the registry.
await import("../src/lib/dm/loop.ts");

const { test, finish } = suite("test-reaction-hits");

registerDmWaker(() => {});

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

async function route(world, name, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// One person's two heroes at a table the AI runs, AC 12 and 30 hit points
// each: Poppy (a rogue with Uncanny Dodge) at 20, Mira (a wizard with
// Shield) at 18, then two goblins (the harness's dummies: +4 to hit, 1d6+2).
// The turn is Mira's, in round 2; the goblins stand beside the hero they hit.
async function stage() {
  const world = await openWorld({ gameSettings: { multiCharacter: "all_active" }, campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const poppy = world.addHero({ name: "Poppy", class: "rogue", level: 5, maxHp: 30, proficiencies: TRAINED });
  const mira = world.addHero({
    name: "Mira", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED, user: world.owner,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] },
  });
  world.patch(poppy.id, { features: [{ name: "Uncanny Dodge", source: "class" }] });
  await kit.fight(2);
  const [g1, g2] = world.enemies();
  const entries = [
    { kind: "pc", characterId: poppy.id, userId: poppy.userId, name: "Poppy", initiative: 20 },
    { kind: "pc", characterId: mira.id, userId: mira.userId, name: "Mira", initiative: 18 },
    { kind: "enemy", enemyId: g1.id, name: g1.displayName, initiative: 11 },
    { kind: "enemy", enemyId: g2.id, name: g2.displayName, initiative: 10 },
  ];
  kit.saveEncounter({ ...world.encounter(), order: entries, turnIndex: 1, round: 2, surprisedIds: [], turnBudget: null, reactionsUsed: [] });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  for (const hero of [poppy, mira]) {
    world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0 });
  }
  return { world, kit, poppy: world.sheet(poppy.id), mira: world.sheet(mira.id), g1, g2 };
}

// The AI's reply ends Mira's turn and plays both goblins at `target`: one GM
// turn. Each pair of faces is a goblin's d20 and its d6.
async function oneReply(table, target, [first, second]) {
  const { world, kit, mira, g1, g2 } = table;
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(mira.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: mira.id } });
  assert.equal(ended.ok, true, ended.error);
  kit.place(target.id, 5, 5);
  kit.place(g1.id, 5, 6);
  kit.place(g2.id, 4, 5);
  for (const [enemy, faces] of [[g1, first], [g2, second]]) {
    world.dice(...faces);
    const out = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: enemy.id, targetCharacterId: target.id } });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  return turn;
}

const hp = (world, hero) => world.sheet(hero.id).currentHp;
const hitsOn = (world, hero) => (activePublicEncounter(world.campaignId).lastHits ?? []).filter((hit) => hit.characterId === hero.id);
const react = (world, hero, feature, args = {}) => world.invoke("use_reaction", { characterId: hero.id, feature, ...args });
// The same call from the AI GM's turn, not a person's.
const modelReacts = (world, hero, feature, args = {}) =>
  invokeEngine(world.campaign(), { kind: "ai", turnId: createDmTurn(world.campaignId, [], "ai").id }, { name: "use_reaction", args: { characterId: hero.id, feature, ...args } });

// ---- every open hit is kept ----

await test("Two goblins hitting one hero in one AI reply leave two open hits, each with its id, and the Hand offers a card for each", async () => {
  const table = await stage();
  const { world, poppy, g1, g2 } = table;
  // 15 + 4 and 16 + 4 against AC 12: 3 + 2 and 5 + 2.
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  assert.equal(hp(world, poppy), 18);
  const hits = hitsOn(world, poppy);
  assert.equal(hits.length, 2, "the second goblin's hit replaced the first");
  assert.deepEqual(hits.map((hit) => hit.attackerId), [g1.id, g2.id], "oldest first");
  assert.ok(hits[0].id && hits[1].id && hits[0].id !== hits[1].id, JSON.stringify(hits));
  assert.equal(openHits(world.campaignId, poppy.id).length, 2);

  const encounter = activePublicEncounter(world.campaignId);
  const cards = reactionCards(poppy, turnFromEncounter(encounter, poppy, { myTurn: false }), encounter.lastHits, world.sheets());
  const dodges = cards.filter((card) => card.name === "Uncanny Dodge");
  assert.equal(dodges.length, 2, "one Uncanny Dodge card per hit");
  assert.deepEqual(dodges.map((card) => card.intent.hit), [hits[0].id, hits[1].id], "each card sends the hit it answers");
  assert.notEqual(dodges[0].id, dodges[1].id);
  assert.match(dodges[0].prompt, new RegExp(`${g1.displayName}'s .* for 5`));
  assert.match(dodges[1].prompt, new RegExp(`${g2.displayName}'s .* for 7`));
  // A card that answers a hit sends it on as use_reaction's own `hit`.
  assert.equal(directCardCall(dodges[0].intent, poppy.id).args.hit, hits[0].id);

  // Each card sits under its own hit's words: a strip reads its first
  // card's prompt, and the browser pass (scenario 115) found Poppy's two
  // chips under the first goblin's words alone.
  const strips = reactionStrips(cards, []);
  assert.deepEqual(strips.map((strip) => strip.map((card) => card.intent.hit)), [[hits[0].id], [hits[1].id]], "one strip per hit");
  assert.notEqual(strips[0][0].prompt, strips[1][0].prompt);
  // Another hero's cards keep their own strips, after the hero's own.
  const others = offTurnReactionCards([{ sheet: poppy, turn: turnFromEncounter(encounter, poppy, { myTurn: false }) }], encounter.lastHits, world.sheets());
  assert.equal(reactionStrips([], others).length, 2);
  // The Hand renders the strips so, and each chip is a finger's height on a phone.
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HandReactPrompt } = await import("../src/app/campaigns/[campaignId]/HandReactPrompt.tsx");
  const hand = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/Hand.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(createElement(HandReactPrompt, { cards: strips[0], pickedId: null, onPick: () => {} }));
  assert.match(html, /hand-react-chip inline-flex min-h-10 /, "a 40px chip below the sm breakpoint");

  // A reaction sent and waiting for the GM holds that hero's cards, chips
  // and fan alike: the browser pass found Shield's chip live after it was
  // played, and another hero's card or typed words could go twice.
  const heldOwn = holdSentReactions(cards, [poppy.id], poppy.id);
  assert.ok(heldOwn.filter((card) => card.cost === "reaction").every((card) => card.disabled === "Sent. Waiting for the GM to resolve your reaction."), JSON.stringify(heldOwn.map((card) => card.disabled)));
  const heldOther = holdSentReactions(others, [poppy.id], "someone-else");
  assert.ok(heldOther.every((card) => card.disabled === `Sent. Waiting for the GM to resolve ${poppy.name}'s reaction.`));
  assert.deepEqual(holdSentReactions(others, [], "someone-else"), others, "nothing sent, nothing held");
  assert.match(hand, /reactionStrips\(holdPendingCards\(reactions, waiting\), othersReactions\)/, "a sent card holds the strip's chips as it holds the fan's");
  assert.match(hand, /if \(picked\.cost === "reaction"\) onReactionSent\?\.\(picked\.actor\?\.id \?\? sheet\.id\)/);
  const session = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/SessionView.tsx", import.meta.url), "utf8");
  assert.match(session, /if \(kind === "do" && speakingAs\) markReactionSent\(speakingAs\.id\)/, "typed words hold their hero too");
  assert.match(session, /\.filter\(\(entry\) => !reactionsSent\.includes\(entry\.id\)\)/, "and leave Speaking as");
});

await test("Uncanny Dodge answers the hit its player picked, and the other stays open", async () => {
  const table = await stage();
  const { world, poppy } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const [first, second] = hitsOn(world, poppy);
  const out = await react(world, poppy, "Uncanny Dodge", { hit: first.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, poppy), 21, "the first hit's 5 is halved to 2; the 7 was halved instead");
  const left = hitsOn(world, poppy);
  assert.deepEqual(left.find((hit) => hit.id === second.id)?.answered, [], "the second hit is untouched and still open");
  assert.deepEqual(left.find((hit) => hit.id === first.id)?.answered, ["uncanny dodge"]);
});

await test("The console names the attack answered by the creature that made it", async () => {
  const table = await stage();
  const { world, poppy, g1 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  // Unnamed, Uncanny Dodge takes the heaviest blow (the 7); named by the
  // first goblin's id, it takes that goblin's 5.
  const out = await react(world, poppy, "Uncanny Dodge", { hit: g1.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, poppy), 21);
});

await test("Unnamed, Uncanny Dodge halves the heaviest open blow", async () => {
  const table = await stage();
  const { world, poppy } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const out = await react(world, poppy, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, poppy), 22, "the 7 is halved to 3");
});

await test("Shield taken against the first hit re-checks every open hit after it (SRD 5.1: including against the triggering attack)", async () => {
  const table = await stage();
  const { world, mira } = table;
  // 10 + 4 = 14 and 12 + 4 = 16 hit AC 12; both miss AC 17.
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  assert.equal(hp(world, mira), 19);
  const encounter = activePublicEncounter(world.campaignId);
  const shields = reactionCards(mira, turnFromEncounter(encounter, mira, { myTurn: false }), encounter.lastHits, world.sheets()).filter((card) => card.name === "Shield");
  assert.equal(shields.length, 1, "Shield is offered once, against the first hit");
  assert.equal(shields[0].intent.hit, hitsOn(world, mira)[0].id);
  assert.match(shields[0].prompt, /, then /, "its prompt names the later hit it covers too");
  const out = await react(world, mira, "Shield", { hit: shields[0].intent.hit });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 30, "both hits now miss: the second stood before");
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 1, "one slot");
  assert.ok(hitsOn(world, mira).every((hit) => hit.answered.includes("shield")));
});

await test("Shield taken against the later hit leaves the earlier one standing", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const [, second] = hitsOn(world, mira);
  const out = await react(world, mira, "Shield", { hit: second.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 25, "the first goblin's 5 stands");
});

await test("A hit named that is no longer open is refused, and nothing is spent", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const out = await react(world, mira, "Shield", { hit: "hgone000" });
  assert.equal(out.ok, false);
  assert.match(out.error, /No attack still open to a reaction matches/, JSON.stringify(out));
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false);
});

await test("A hit named wrongly is sent back with the hits still open, and none is answered in its place", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const [open] = hitsOn(world, mira);
  const copied = open.id.slice(0, -1);
  const before = hp(world, mira);
  const out = await modelReacts(world, mira, "Shield", { hit: copied });
  assert.equal(out.ok, false);
  assert.equal(out.retry, true, JSON.stringify(out));
  assert.equal(out.refused, undefined);
  assert.ok(out.error.includes(`hit "${open.id}" on ${mira.name}`), out.error);
  assert.equal(hp(world, mira), before);
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false);
  const again = await react(world, mira, "Shield", { hit: open.id });
  assert.equal(again.ok, true, again.error);
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 1);
});

await test("A reaction for the reactor alone lists only their own hits, and with none open it stays a refusal", async () => {
  const table = await stage();
  const { world, mira, poppy } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const shield = await modelReacts(world, mira, "Shield", { hit: "hwrong000" });
  assert.equal(shield.ok, false);
  assert.equal(shield.refused, "rules", JSON.stringify(shield));
  assert.equal(shield.retry, undefined);
  assert.doesNotMatch(shield.error, /Open hits/);
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
});

await test("A person who names a wrong hit is told no, and is not handed the model's list", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const out = await react(world, mira, "Shield", { hit: "hwrong000" });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules", JSON.stringify(out));
  assert.doesNotMatch(out.error, /Open hits/);
});

await test("A reactor whose reaction is spent is told no, whatever hit the model names", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const [first] = hitsOn(world, mira);
  const answered = await react(world, mira, "Shield", { hit: first.id });
  assert.equal(answered.ok, true, answered.error);
  assert.ok(hitsOn(world, mira).length, "a hit is still open to list");
  const out = await modelReacts(world, mira, "Shield", { hit: "hwrong000" });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules", JSON.stringify(out));
  assert.doesNotMatch(out.error, /Open hits/);
});

await test("A played card whose hit has closed stays a refusal, and no other hit is offered in its place", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "player", userId: world.owner.id, characterId: mira.id, content: "Mira casts Shield.", intent: { card: "reaction", feature: "Shield", spell: "Shield", hit: "hgone000" } });
  const out = await modelReacts(world, mira, "Shield", { hit: "hgone000" });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules", JSON.stringify(out));
  assert.doesNotMatch(out.error, /Open hits/);
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
});

await test("The model naming a hit that has closed is told no, and is not offered the later hit open on the same hero", async () => {
  const table = await stage();
  const { world, kit, poppy, g1 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const [closing] = hitsOn(world, poppy);
  kit.freshRound();
  world.dice(15, 1);
  const later = await world.invoke("enemy_attack", { enemyId: g1.id, targetCharacterId: poppy.id });
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  const [open] = hitsOn(world, poppy);
  assert.notEqual(open.id, closing.id);
  const before = hp(world, poppy);
  const out = await modelReacts(world, poppy, "Uncanny Dodge", { hit: closing.id });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules", JSON.stringify(out));
  assert.equal(out.retry, undefined);
  assert.equal(out.error.includes(open.id), false, out.error);
  assert.equal(hp(world, poppy), before);
  assert.equal(world.encounter().reactionsUsed.includes(poppy.id), false);
});

await test("With two hits open, a slip of one id is sent back with that hit alone", async () => {
  const table = await stage();
  const { world, mira } = table;
  await oneReply(table, mira, [[10, 3], [12, 4]]);
  const [first, second] = hitsOn(world, mira);
  const out = await modelReacts(world, mira, "Shield", { hit: second.id.slice(0, -1) });
  assert.equal(out.retry, true, JSON.stringify(out));
  assert.ok(out.error.includes(`hit "${second.id}" on ${mira.name}`), out.error);
  assert.equal(out.error.includes(first.id), false, out.error);
});

await test("A slip of a fall's id names the fall as GAME STATE does", async () => {
  const table = await stage();
  const { world, poppy } = table;
  world.patch(poppy.id, { features: [{ name: "Slow Fall", source: "class" }] });
  recordFall(world.campaignId, poppy.id, snapshotVitals(world.campaignId, world.sheet(poppy.id)), 7, new Date().toISOString());
  const [fall] = hitsOn(world, poppy);
  const out = await modelReacts(world, poppy, "Slow Fall", { hit: fall.id.slice(1) });
  assert.equal(out.retry, true, JSON.stringify(out));
  assert.ok(out.error.includes(`hit "${fall.id}" on ${poppy.name} (a fall)`), out.error);
});

await test("A later GM turn's attack on the same hero closes the hits of the reply before it", async () => {
  const table = await stage();
  const { world, kit, poppy, g1 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  kit.freshRound();
  world.dice(15, 1);
  const later = await world.invoke("enemy_attack", { enemyId: g1.id, targetCharacterId: poppy.id });
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  const open = hitsOn(world, poppy);
  assert.equal(open.length, 1, "the console's attack is a later go: the reply's two hits are past answering");
  assert.equal(open[0].damage, 3);
});

await test("A row stored before hits had ids (one record) still reads, answers and is kept as a list", async () => {
  const table = await stage();
  const { world, mira, g1 } = table;
  const encounter = world.encounter();
  const before = snapshotVitals(world.campaignId, world.sheet(mira.id));
  world.patch(mira.id, { currentHp: 25 });
  const at = new Date().toISOString();
  const old = {
    characterId: mira.id,
    encounterId: encounter.id,
    turn: (await import("../src/lib/db/encounters.ts")).turnKey(encounter),
    attacker: { kind: "enemy", id: g1.id, name: g1.displayName },
    attack: "Club",
    type: "bludgeoning",
    ranged: false,
    source: "attack",
    swings: [{ total: 14, faces: [10], natural: 10, advantage: "none", vsAc: 12, hit: true, crit: false, raw: 5 }],
    before,
    after: { currentHp: 25, tempHp: 0, beastHp: null },
    answered: [],
    startedAt: at,
    at,
  };
  getDatabase()
    .prepare(`INSERT INTO last_hits (campaign_id, character_id, payload_json, created_at) VALUES (?, ?, ?, ?)`)
    .run(world.campaignId, mira.id, JSON.stringify(old), at);
  const [shown] = hitsOn(world, mira);
  assert.equal(shown?.id, at, "an old record's id is the moment it was recorded");
  const out = await react(world, mira, "Shield", { hit: at });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 30);
  const row = getDatabase().prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ? AND character_id = ?`).get(world.campaignId, mira.id);
  assert.ok(Array.isArray(JSON.parse(row.payload_json)), "written back as the list it now is");
});

await test("The narrator is told every open hit with the id use_reaction takes", async () => {
  const table = await stage();
  const { world, poppy, g1, g2 } = table;
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  const [first, second] = hitsOn(world, poppy);
  const block = buildGameStateBlock({
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    encounter: buildEncounterState(world.campaignId, world.sheets()),
  });
  assert.match(block, /Open hits a reaction may still answer/);
  // A line for the 16K profile too: it is there only while hits are open.
  const line = block.split("\n").find((entry) => entry.startsWith("Open hits a reaction may still answer")) ?? "";
  assert.ok(line.length < 800, `the open-hits line is ${line.length} characters`);
  assert.ok(block.includes(`hitId=${first.id} ${g1.displayName}'s Club, 5 bludgeoning`), block);
  assert.ok(block.includes(`hitId=${second.id} ${g2.displayName}'s Club, 7 bludgeoning`), block);
  assert.doesNotMatch(block, /Poppy \[characterId=[^\]]*yours to react for/, "a player's hero reacts when their player says so");
});

// ---- a companion's reactions ----

// Kara and a companion, Pip (a rogue with Uncanny Dodge), against a goblin.
async function withCompanion({ commandedBy = null, human = false } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", proficiencies: TRAINED });
  const bot = createCompanionUser("Pip");
  const made = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(kara.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  setCompanionCommander(made.id, commandedBy === "owner" ? world.owner.id : commandedBy);
  world.patch(made.id, { class: "rogue", level: 5, maxHp: 30, currentHp: 30, ac: 12, acOverride: true, features: [{ name: "Uncanny Dodge", source: "class" }] });
  if (human) {
    setDmMode(world.campaignId, "human", world.owner.id);
  }
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  return { world, kit, kara: world.sheet(kara.id), pip: world.sheet(made.id), goblin: world.enemies()[0] };
}

await test("A companion's commander is offered its reaction, and the actions route takes it off its turn", async () => {
  const { world, kara, pip, goblin } = await withCompanion({ commandedBy: "owner" });
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, kara.id, "Kara acts");
  await world.hitBy(pip.id, { enemyId: goblin.id, name: goblin.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const sheets = world.sheets();
  assert.deepEqual(companionReactors(sheets, world.owner.id, kara.id, false).map((sheet) => sheet.id), [pip.id]);
  const stranger = world.addUser("guest");
  assert.deepEqual(companionReactors(sheets, stranger.id, undefined, false), [], "nobody else's");
  const encounter = activePublicEncounter(world.campaignId);
  const [dodge] = offTurnReactionCards(
    companionReactors(sheets, world.owner.id, kara.id, false).map((sheet) => ({ sheet, turn: turnFromEncounter(encounter, sheet, { myTurn: false }) })),
    encounter.lastHits,
    sheets,
  );
  assert.equal(dodge?.name, "Uncanny Dodge");
  assert.deepEqual(dodge.actor, { id: pip.id, name: "Pip" });
  const posted = await route(world, "actions", { kind: "do", content: "Pip twists away.", characterId: pip.id, intent: dodge.intent }, world.owner);
  assert.equal(posted.status, 202, JSON.stringify(posted.body));
  assert.equal(listRecentMessages(world.campaignId, 1)[0].characterId, pip.id, "posted as Pip");
  // Only a reaction: its commander's plain move off its turn is refused.
  const move = await route(world, "actions", { kind: "do", content: "Pip runs.", characterId: pip.id }, world.owner);
  assert.equal(move.status, 409, JSON.stringify(move.body));
});

await test("At a table a person runs, the GM seat plays a companion nobody commands: its reaction card resolves at once", async () => {
  const { world, kit, pip, goblin } = await withCompanion({ human: true });
  assert.deepEqual(companionReactors(world.sheets(), world.owner.id, undefined, true).map((sheet) => sheet.id), [pip.id]);
  assert.deepEqual(companionReactors(world.sheets(), world.owner.id, undefined, false), [], "only from the seat that runs the table");
  kit.place(pip.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  world.dice(15, 4);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: pip.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(world.sheet(pip.id).currentHp, 24);
  const encounter = activePublicEncounter(world.campaignId, { enemyNumbers: true });
  const [dodge] = reactionCards(world.sheet(pip.id), turnFromEncounter(encounter, world.sheet(pip.id), { myTurn: false }), encounter.lastHits, world.sheets(), "Pip");
  assert.equal(dodge?.name, "Uncanny Dodge");
  // A player is not the GM seat.
  const player = world.addHero({ name: "Brom" });
  const refused = await route(world, "actions", { kind: "do", content: "Pip dodges.", characterId: pip.id, intent: dodge.intent }, { id: player.userId });
  assert.ok(refused.status >= 400, JSON.stringify(refused.body));
  assert.equal(world.encounter().reactionsUsed.includes(pip.id), false);
  const played = await route(world, "actions", { kind: "do", content: "Pip twists away.", characterId: pip.id, intent: dodge.intent }, world.owner);
  assert.equal(played.status, 200, JSON.stringify(played.body));
  assert.equal(played.body.resolved, true);
  assert.equal(world.sheet(pip.id).currentHp, 27, "the 6 is halved to 3");
});

await test("At a table the AI runs, the narrator is told a companion nobody commands is its to react for", async () => {
  const { world, pip, goblin } = await withCompanion();
  await world.hitBy(pip.id, { enemyId: goblin.id, name: goblin.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const block = buildGameStateBlock({
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    encounter: buildEncounterState(world.campaignId, world.sheets()),
  });
  assert.match(block, new RegExp(`Pip \\[characterId=${pip.id}, yours to react for\\]`), block);
  assert.match(block, /you may take it with use_reaction and its characterId/);
  setCompanionCommander(pip.id, world.owner.id);
  const commanded = buildGameStateBlock({
    campaign: world.campaign(),
    members: listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    encounter: buildEncounterState(world.campaignId, world.sheets()),
  });
  assert.doesNotMatch(commanded, /, yours to react for\]/, "a commanded companion reacts when its player says so");
});

// ---- typed words for another hero's reaction ----

await test("Words typed for another hero's reaction go out as that hero, only while they have a hit to answer", async () => {
  const table = await stage();
  const { world, poppy, mira, g1 } = table;
  // Before any hit, there is nothing to answer.
  const early = await route(world, "actions", { kind: "do", content: "Poppy rolls aside.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(early.status, 409, JSON.stringify(early.body));
  // Mira's turn; Poppy is hit (an opportunity attack, say).
  await world.hitBy(poppy.id, { enemyId: g1.id, name: g1.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const encounter = activePublicEncounter(world.campaignId);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", encounter), [{ id: poppy.id, name: "Poppy" }]);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "one_active", encounter), [], "one hero fielded at a time");
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, undefined, "all_active", encounter), [], "not on their turn: the box is shut");

  // Without Speaking as, the words are Mira's turn's or refused as Poppy's.
  const plain = await route(world, "actions", { kind: "do", content: "Poppy rolls aside.", characterId: poppy.id }, world.owner);
  assert.equal(plain.status, 409, JSON.stringify(plain.body));
  // A hero handed a card for an ally's hit (Protection) is offered too.
  const third = world.addHero({ name: "Bram", user: world.owner });
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", encounter, third.id).map((entry) => entry.name), ["Poppy", "Bram"]);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", encounter).map((entry) => entry.name), ["Poppy"], "but not unasked: Bram was not hit");

  const typed = await route(world, "actions", { kind: "do", content: "Poppy rolls aside.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(typed.status, 202, JSON.stringify(typed.body));
  assert.equal(listRecentMessages(world.campaignId, 1)[0].characterId, poppy.id, "posted as Poppy, not as Mira");
  assert.equal(declaredThisTurn(world.campaignId, mira.id), false, "and no word on Mira's turn");

  // Once Poppy's reaction is spent, the choice goes and the route refuses.
  const live = world.encounter();
  table.kit.saveEncounter({ ...live, reactionsUsed: [...live.reactionsUsed, poppy.id] });
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, mira.id, "all_active", activePublicEncounter(world.campaignId)), []);
  const spent = await route(world, "actions", { kind: "do", content: "Poppy rolls aside again.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(spent.status, 409, JSON.stringify(spent.body));
});

await test("A reaction typed by the hero up next, hit in the enemies' pass, is marked as one and leaves their own turn waiting on their word", async () => {
  const table = await stage();
  const { world, poppy } = table;
  // The reply ends Mira's turn and the goblins hit Poppy, who is up next.
  await oneReply(table, poppy, [[15, 3], [16, 5]]);
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, poppy.id, "Poppy's turn waits on her player");
  const encounter = activePublicEncounter(world.campaignId);
  assert.deepEqual(typedReactors(world.sheets(), world.owner.id, poppy.id, "all_active", encounter), [{ id: poppy.id, name: "Poppy" }], "her own reaction is offered beside her turn");

  const typed = await route(world, "actions", { kind: "do", content: "Poppy twists away from the second club.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(typed.status, 202, JSON.stringify(typed.body));
  const [line] = listRecentMessages(world.campaignId, 1);
  assert.equal(line.characterId, poppy.id);
  assert.deepEqual(line.intent, { card: "reaction" }, "marked as a reaction, as a card is");
  assert.equal(declaredThisTurn(world.campaignId, poppy.id), false, "a reaction is no word on her turn");
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, poppy.id, "the AI still waits on Poppy's player for her turn");
  // The narrator reads it as her words to answer with use_reaction; nothing
  // chases it as a card or hands it back.
  assert.match(describeIntent(line.intent, poppy.id), /A reaction for characterId=.*use_reaction.*no action on their own turn/);
  assert.equal(intentNeedsTool(line.intent), false);
  // Her next plain line is her turn's word, as before.
  const move = await route(world, "actions", { kind: "do", content: "Poppy stabs the nearer goblin.", characterId: poppy.id }, world.owner);
  assert.ok(move.status < 400, JSON.stringify(move.body));
  assert.equal(declaredThisTurn(world.campaignId, poppy.id), true);
});

// ---- Shield and a hit on a hero at 0 ----
// Mira at 6 of 30. The first goblin's club drops her; the second hits her at
// 0 from beside her, a critical hit (SRD 5.1: a hit within 5 feet of an
// unconscious creature), and two death-save failures. Shield, cast as the
// first hit lands, re-checks both with +5 AC.

async function downedTwice(table, first, second) {
  const { world, mira } = table;
  world.patch(mira.id, { currentHp: 6 });
  await oneReply(table, mira, [first, second]);
  const [h1, h2] = openHits(world.campaignId, mira.id);
  assert.equal(h1.swings[0].hit, true, JSON.stringify(h1.swings));
  assert.equal(h1.before.currentHp, 6);
  assert.equal(h2.before.currentHp, 0, "the second blow found her down");
  assert.equal(h2.swings[0].hit, true, JSON.stringify(h2.swings));
  assert.equal(h2.swings[0].crit, true, "a hit beside an unconscious creature is critical");
  assert.equal(world.sheet(mira.id).deathSaves?.failures, 2, "two failures on a critical hit");
  return { h1, h2 };
}

const track = (world, hero) => world.sheet(hero.id).deathSaves;
const down = (world, hero) => world.sheet(hero.id).conditions.map((entry) => entry.toLowerCase());

await test("Shield turning both hits into misses gives back the drop and the second hit's failures", async () => {
  const table = await stage();
  const { world, mira } = table;
  // 10 + 4 = 14 and 12 + 4 = 16: both miss AC 17.
  await downedTwice(table, [10, 5], [12, 12, 3, 3]);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 6);
  assert.equal(track(world, mira)?.failures ?? 0, 0);
  assert.ok(!down(world, mira).includes("unconscious"), down(world, mira).join(", "));
});

await test("Shield that leaves the first hit standing still takes back the later hit's failures", async () => {
  const table = await stage();
  const { world, mira } = table;
  // 15 + 4 = 19 still hits AC 17; the second's 16 now misses.
  await downedTwice(table, [15, 5], [12, 12, 3, 3]);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 0, "the first club still drops her");
  assert.equal(track(world, mira)?.failures, 0, "the second club's two failures are taken back");
  assert.equal(track(world, mira)?.dead, false);
  assert.ok(down(world, mira).includes("unconscious"));
});

await test("Shield that turns the first hit away makes the later hit land on her standing: its ordinary damage, no failures", async () => {
  const table = await stage();
  const { world, mira } = table;
  // The first's 14 now misses; the second's 19 still hits. It was critical
  // only because she lay at 0 beside the goblin: 2 + 5 + 2 = 9 as a
  // critical, 2 + 2 = 4 as the ordinary hit it is on her standing.
  const { h2 } = await downedTwice(table, [10, 5], [15, 15, 2, 5]);
  assert.equal(h2.swings[0].raw, 9);
  assert.deepEqual(h2.swings[0].ordinary, { raw: 4 }, "the ordinary blow is kept, from the same dice");
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 2, "the club's ordinary 4 comes off the 6 she kept; its critical 9 would have dropped her");
  assert.equal(track(world, mira)?.failures ?? 0, 0);
  assert.ok(!down(world, mira).includes("unconscious"), down(world, mira).join(", "));
});

await test("A critical's ordinary blow is read off its first set of dice and the modifier, whatever critical rules the table plays", async () => {
  const { critDamageExpression, ordinaryOfCritical } = await import("../src/lib/dm/encounter-logic.ts");
  const dice = (sides, ...faces) => ({ kind: "dice", sign: 1, count: faces.length, sides, dice: faces.map((value) => ({ value, sides, kept: true })), subtotal: faces.reduce((sum, face) => sum + face, 0) });
  const flat = (value) => ({ kind: "modifier", sign: 1, value });
  const roll = (expression, terms) => ({ expression, total: terms.reduce((sum, term) => sum + (term.kind === "dice" ? term.subtotal : term.value), 0), terms });
  // 1d6+2 doubled: the first d6 and the 2.
  assert.equal(critDamageExpression("1d6+2"), "1d6+1d6+2");
  assert.equal(ordinaryOfCritical(roll("1d6+1d6+2", [dice(6, 2), dice(6, 5), flat(2)]), "1d6+2").total, 4);
  // Powerful Critical: the copy is the dice's maximum, a flat 6.
  assert.equal(critDamageExpression("1d6+2", 0, { powerfulCritical: true }), "1d6+6+2");
  assert.equal(ordinaryOfCritical(roll("1d6+6+2", [dice(6, 3), flat(6), flat(2)]), "1d6+2").total, 5);
  // Critical Damage Modifiers: the 2 doubled too.
  assert.equal(critDamageExpression("1d6+2", 0, { multiplyNumeric: true }), "1d6+1d6+2+2");
  assert.equal(ordinaryOfCritical(roll("1d6+1d6+2+2", [dice(6, 1), dice(6, 6), flat(2), flat(2)]), "1d6+2", { multiplyNumeric: true }).total, 3);
  // Brutal Critical's extra die at the end.
  assert.equal(critDamageExpression("1d8+3", 1), "1d8+1d8+3+1d8");
  assert.equal(ordinaryOfCritical(roll("1d8+1d8+3+1d8", [dice(8, 4), dice(8, 8), flat(3), dice(8, 7)]), "1d8+3", { extraDice: 1 }).total, 7);
  // Terms that do not line up read nothing.
  assert.equal(ordinaryOfCritical(roll("1d6+2", [dice(6, 2), flat(2)]), "1d6+2"), null);
});

await test("A natural 20 stays a critical when the first hit is turned away", async () => {
  const table = await stage();
  const { world, mira } = table;
  // The second goblin rolls a natural 20: 2 + 5 + 2 = 9 whatever she was.
  const { h2 } = await downedTwice(table, [10, 5], [20, 20, 2, 5]);
  assert.equal(h2.swings[0].natural, 20);
  assert.equal(h2.swings[0].ordinary, undefined, "a natural 20 keeps no ordinary blow");
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).currentHp, 0, "the critical 9 drops her from the 6 she kept");
  assert.equal(track(world, mira)?.failures ?? 0, 0, "dropped by it, not hit while down");
  assert.equal(track(world, mira)?.dead ?? false, false);
  assert.ok(down(world, mira).includes("unconscious"));
});

await test("A hero at 0 when a hit lands cannot react to it, and nothing is spent", async () => {
  const table = await stage();
  const { world, mira } = table;
  const { h2 } = await downedTwice(table, [15, 5], [12, 12, 3, 3]);
  const out = await react(world, mira, "Shield", { hit: h2.id });
  assert.equal(out.ok, false, "Shield against the blow that found her down");
  assert.equal(world.sheet(mira.id).spellcasting.slots["1"].used, 0);
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false);
  assert.equal(track(world, mira)?.failures, 2);
});

await test("Her earlier Shield still counts against a later attack on her at 0", async () => {
  const table = await stage();
  const { world, mira, g2 } = table;
  world.patch(mira.id, { currentHp: 6 });
  // Only the first goblin swings in the reply: 19 still hits AC 17.
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(mira.id));
  assert.equal((await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: mira.id } })).ok, true);
  table.kit.place(mira.id, 5, 5);
  table.kit.place(table.g1.id, 5, 6);
  table.kit.place(g2.id, 4, 5);
  world.dice(15, 5);
  assert.equal((await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: table.g1.id, targetCharacterId: mira.id } })).ok, true);
  world.clearDice();
  const shield = await react(world, mira, "Shield");
  assert.equal(shield.ok, true, shield.error);
  assert.equal(world.sheet(mira.id).currentHp, 0, "the club still drops her");
  // The second goblin's 16 meets the shielded 17 and misses: no failure.
  world.dice(12, 12, 3, 3);
  const later = await world.invoke("enemy_attack", { enemyId: g2.id, targetCharacterId: mira.id });
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  assert.equal(track(world, mira)?.failures ?? 0, 0, JSON.stringify(later.result));
});

// ---- what else happened between the hits stays ----
// One AI reply ends Mira's turn and plays `plays` in order: a goblin's swing
// at `target`, or at the play's own ({ enemy, faces, target }), or any other
// call ({ call, faces }), each with the dice it rolls.
async function replyOf(table, target, plays) {
  const { world, kit, mira, g1, g2 } = table;
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(mira.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: mira.id } });
  assert.equal(ended.ok, true, ended.error);
  kit.place(target.id, 5, 5);
  kit.place(g1.id, 5, 6);
  kit.place(g2.id, 4, 5);
  for (const play of plays) {
    world.dice(...(play.faces ?? []));
    const call = play.call ?? { name: "enemy_attack", args: { enemyId: play.enemy.id, targetCharacterId: (play.target ?? target).id } };
    const out = await invokeEngine(world.campaign(), ai, call);
    world.clearDice();
    assert.equal(out.ok, true, `${call.name}: ${out.error}`);
  }
  return turn;
}

await test("Shield takes back only the clubs: fire that landed between the two hits stays (issue 685 review)", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  // 10 + 4 hits for 3 + 2; 2d6 fire for 10; 12 + 4 hits for 4 + 2: 30 - 5 - 10 - 6.
  await replyOf(table, mira, [
    { enemy: g1, faces: [10, 3] },
    { call: { name: "apply_damage", args: { characterId: mira.id, dice: "2d6", type: "fire", reason: "a fire bolt" } }, faces: [5, 5] },
    { enemy: g2, faces: [12, 4] },
  ]);
  assert.equal(hp(world, mira), 9);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 20, "both clubs miss AC 17; the fire stays");
  // The later hit is kept as the corrected fight has it: the fire found her
  // at 30 and left her at 20 before the second club.
  // The fire is a record of its own between the clubs now (last-hit.ts
  // openEffect: damage from no attack is kept for a reaction to damage taken).
  const [, second] = openHits(world.campaignId, mira.id).filter((hit) => hit.source === "attack");
  assert.equal(second.before.currentHp, 20, JSON.stringify(second.before));
  assert.equal(second.after.currentHp, 20);
  const fire = openHits(world.campaignId, mira.id).find((hit) => hit.source === "effect");
  assert.deepEqual([fire?.before.currentHp, fire?.after.currentHp], [30, 20], "the fire's own record is kept as the corrected fight has it");
});

await test("Shield takes back only the clubs: healing between the two hits stays", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  world.patch(mira.id, { currentHp: 20 });
  // 20 - 5 = 15, healed 2d4 + 2 = 10 to 25, then 25 - 6 = 19.
  await replyOf(table, mira, [
    { enemy: g1, faces: [10, 3] },
    { call: { name: "heal", args: { characterId: mira.id, dice: "2d4+2", reason: "a potion" } }, faces: [4, 4] },
    { enemy: g2, faces: [12, 4] },
  ]);
  assert.equal(hp(world, mira), 19);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 30, "20 healed 10, and neither club lands");
});

await test("Shield replays the healing and the fire between two hits in the order they landed: healing at her maximum does nothing (issue 685 review)", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  // 30 - 5 = 25; healed 2d4 + 2 = 10, to her maximum of 30; 2d6 fire for 6
  // to 24; the second club for 6 to 18. Without the clubs she is at 30
  // when the healing lands, which does nothing, and the fire leaves her at
  // 24. Read as one change (25 to 24) the gap was a point of damage, 29.
  await replyOf(table, mira, [
    { enemy: g1, faces: [10, 3] },
    { call: { name: "heal", args: { characterId: mira.id, dice: "2d4+2", reason: "a potion" } }, faces: [4, 4] },
    { call: { name: "apply_damage", args: { characterId: mira.id, dice: "2d6", type: "fire", reason: "a fire bolt" } }, faces: [3, 3] },
    { enemy: g2, faces: [12, 4] },
  ]);
  assert.equal(hp(world, mira), 18);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 24, "the clubs miss, the healing finds her whole, the fire lands");
  // The fire is a record of its own between the clubs now (last-hit.ts
  // openEffect: damage from no attack is kept for a reaction to damage taken).
  const [, second] = openHits(world.campaignId, mira.id).filter((hit) => hit.source === "attack");
  assert.equal(second.before.currentHp, 24, JSON.stringify(second.before));
});

await test("Shield replays what landed after the last hit in its order too: healing, then fire", async () => {
  const table = await stage();
  const { world, mira, g1 } = table;
  // 30 - 5 = 25; healed to 30; fire for 6 to 24. Without the club: 30,
  // healing does nothing, fire to 24.
  await replyOf(table, mira, [
    { enemy: g1, faces: [10, 3] },
    { call: { name: "heal", args: { characterId: mira.id, dice: "2d4+2", reason: "a potion" } }, faces: [4, 4] },
    { call: { name: "apply_damage", args: { characterId: mira.id, dice: "2d6", type: "fire", reason: "a fire bolt" } }, faces: [3, 3] },
  ]);
  assert.equal(hp(world, mira), 24);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 24, "the club misses; the healing found her whole, so nothing is given back");
});

await test("A concentration the damage between the hits broke stays broken when Shield turns the clubs away", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  world.patch(mira.id, { concentratingOn: "Bless" });
  // The first club's save is a 15 and holds; the fire's is a 2 and ends it;
  // the second club finds her concentrating on nothing.
  await replyOf(table, mira, [
    { enemy: g1, faces: [10, 3, 15] },
    { call: { name: "apply_damage", args: { characterId: mira.id, dice: "2d6", type: "fire", reason: "a fire bolt" } }, faces: [5, 5, 2] },
    { enemy: g2, faces: [12, 4] },
  ]);
  assert.equal(world.sheet(mira.id).concentratingOn, null);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).concentratingOn, null, "the fire broke it, and the fire stands");
  assert.equal(hp(world, mira), 20);
});

await test("A concentration save is judged by the one blow that broke it, not the attacks' total (SRD 5.1: a save for each source)", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  world.patch(mira.id, { concentratingOn: "Bless" });
  // 15 + 4 = 19 hits for 5 and its save (a 12) holds; 10 + 4 = 14 hits for
  // 6 and its save (a 9 against DC 10) ends Bless. Shield: the first still
  // hits AC 17, the second misses, so the blow that broke it is gone.
  await replyOf(table, mira, [
    { enemy: g1, faces: [15, 3, 12] },
    { enemy: g2, faces: [10, 4, 9] },
  ]);
  assert.equal(world.sheet(mira.id).concentratingOn, null);
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 25, "the first club's 5 stands");
  assert.equal(world.sheet(mira.id).concentratingOn, "Bless", JSON.stringify(out));
});

await test("A blow that now finds her standing loses the advantage it had only because she lay at 0 (SRD 5.1, Unconscious)", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  world.patch(mira.id, { currentHp: 6 });
  // The first club drops her (10 + 4 hits for 5 + 2). The second rolls 3
  // and 15 with advantage against her lying there: 19 hits even AC 17, a
  // critical. Standing, its roll is the first die: 3 + 4 = 7, a miss.
  await replyOf(table, mira, [
    { enemy: g1, faces: [10, 5] },
    { enemy: g2, faces: [3, 15, 2, 5] },
  ]);
  const [, h2] = openHits(world.campaignId, mira.id);
  assert.equal(h2.swings[0].advantage, "advantage");
  const out = await react(world, mira, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(world, mira), 6, "neither club lands on her standing");
  assert.equal(track(world, mira)?.failures ?? 0, 0);
  assert.equal(h2.swings[0].standingAdvantage, "none", "the roll against her standing is kept with the hit");
});

await test("A corrected blow lands through the defenses the damage path applies: a form's vulnerability", async () => {
  const table = await stage();
  const { world, poppy } = table;
  world.patch(poppy.id, { wildShape: { form: "Clay Ooze", beastHp: 20, beastMaxHp: 20, beastAc: 12, vulnerable: "bludgeoning" } });
  // 15 + 4 hits for 4 + 2 = 6, doubled to 12 on the form; the second misses.
  await oneReply(table, poppy, [[15, 4], [2]]);
  assert.equal(world.sheet(poppy.id).wildShape?.beastHp, 8);
  const out = await react(world, poppy, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(poppy.id).wildShape?.beastHp, 14, "the 6 halved to 3 still lands doubled: 6");
});

// ---- a reaction answers a hit it covers ----

await test("A reaction for the reactor alone, sent with another hero's hit, is sent back with the reactor's own hits, and nothing is spent", async () => {
  const table = await stage();
  const { world, poppy, mira, g1, g2 } = table;
  // One reply: the first goblin hits Poppy for 3 + 2, the second Mira (beside
  // it) for 4 + 2.
  table.kit.place(mira.id, 4, 4);
  await replyOf(table, poppy, [
    { enemy: g1, faces: [15, 3] },
    { enemy: g2, faces: [12, 4], target: mira },
  ]);
  const [poppys] = openHits(world.campaignId, poppy.id);
  const [miras] = openHits(world.campaignId, mira.id);
  assert.equal(hp(world, poppy), 25);
  const out = await react(world, poppy, "Uncanny Dodge", { hit: miras.id });
  assert.equal(out.ok, false, "Uncanny Dodge halved Poppy's own hit in place of Mira's");
  assert.equal(out.retry, true, JSON.stringify(out));
  assert.ok(out.error.includes(poppys.id), out.error);
  assert.equal(hp(world, poppy), 25, "nothing was halved");
  assert.equal(world.encounter().reactionsUsed.includes(poppy.id), false);
  // Sent with her own hit, it answers it.
  const again = await react(world, poppy, "Uncanny Dodge", { hit: poppys.id });
  assert.equal(again.ok, true, again.error);
  assert.equal(hp(world, poppy), 28, "the 5 is halved to 2");
});

await test("Words typed as a hero's reaction pass only for a hit on them or on an ally a reaction of theirs covers", async () => {
  const table = await stage();
  const { world, poppy, mira, g1 } = table;
  // Mira is hit; Poppy holds only Uncanny Dodge, which answers a hit on her.
  await world.hitBy(mira.id, { enemyId: g1.id, name: g1.displayName, total: 18, vsAc: 12, raw: 6, attack: "Club" });
  const refused = await route(world, "actions", { kind: "do", content: "Poppy leaps in.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  // With Protection, Mira's hit is one she can answer.
  world.patch(poppy.id, { features: [{ name: "Uncanny Dodge", source: "class" }, { name: "Protection", source: "class" }] });
  const covered = await route(world, "actions", { kind: "do", content: "Poppy throws up her shield.", characterId: poppy.id, reaction: true }, world.owner);
  assert.equal(covered.status, 202, JSON.stringify(covered.body));
});

// ---- a reaction comes back as the hero's turn starts ----
// The pointer lands on Mira as Poppy's turn ends, with the goblins before her
// still to act. SRD 5.1: her reaction comes back, and Shield ends, at the
// start of her turn, which comes after theirs.

// The order, from Poppy's turn: `before` goblins between Poppy and Mira, the
// rest after her.
async function passOrder(table, before, after, { human = false } = {}) {
  const { world, kit, poppy, mira } = table;
  if (human) {
    setDmMode(world.campaignId, "human", world.owner.id);
  }
  const enemy = (goblin, initiative) => ({ kind: "enemy", enemyId: goblin.id, name: goblin.displayName, initiative });
  const entries = [
    { kind: "pc", characterId: poppy.id, userId: poppy.userId, name: "Poppy", initiative: 20 },
    ...before.map((goblin, at) => enemy(goblin, 15 - at)),
    { kind: "pc", characterId: mira.id, userId: mira.userId, name: "Mira", initiative: 10 },
    ...after.map((goblin, at) => enemy(goblin, 5 - at)),
  ];
  kit.saveEncounter({ ...world.encounter(), order: entries, turnIndex: 0, round: 2, surprisedIds: [], turnBudget: null, reactionsUsed: [] });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  kit.place(mira.id, 5, 5);
  kit.place(table.g1.id, 5, 6);
  kit.place(table.g2.id, 4, 5);
  kit.place(poppy.id, 9, 9);
}

const shielded = (world, hero) => world.sheet(hero.id).conditions.some((entry) => entry.toLowerCase() === "shielded");

await test("A Shield cast against the goblin before Mira's turn ends as her turn starts, and her reaction is back for the goblin after it", async () => {
  const table = await stage();
  const { world, kit, poppy, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2], { human: true });
  assert.equal(tools.endOwnTurn(world.campaignId, poppy.userId), true, "Poppy ends her turn");
  // The first goblin, due before Mira: 10 + 4 hits her AC 12 for 3 + 2.
  world.dice(10, 3);
  const swing = await world.invoke("enemy_attack", { enemyId: g1.id, targetCharacterId: mira.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  const shield = await react(world, mira, "Shield");
  assert.equal(shield.ok, true, shield.error);
  assert.equal(hp(world, mira), 30);
  assert.ok(shielded(world, mira));
  // The GM hands the turn on: Mira's turn starts.
  kit.handOnEnemies();
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false, "her reaction is back as her turn starts");
  assert.equal(shielded(world, mira), false, "Shield lasts until the start of her turn");
  assert.equal(tools.endOwnTurn(world.campaignId, mira.userId), true, "Mira ends her turn");
  // The second goblin's 12 + 4 hits her AC 12 again for 4 + 2.
  world.dice(12, 4);
  const later = await world.invoke("enemy_attack", { enemyId: g2.id, targetCharacterId: mira.id });
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  assert.equal(hp(world, mira), 24, JSON.stringify(later.result ?? later));
});

await test("A Shield from the round before still holds against the goblin before Mira's turn, and her reaction comes back only with that turn", async () => {
  const table = await stage();
  const { world, kit, poppy, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2], { human: true });
  // After her turn last round she cast Shield, spending her reaction.
  world.patch(mira.id, { conditions: ["shielded"], conditionMeta: { shielded: { untilTurnOf: mira.id } } });
  kit.saveEncounter({ ...world.encounter(), reactionsUsed: [mira.id] });
  assert.equal(tools.endOwnTurn(world.campaignId, poppy.userId), true, "Poppy ends her turn");
  assert.ok(shielded(world, mira), "Mira's turn has not started");
  assert.ok(world.encounter().reactionsUsed.includes(mira.id), "nor has her reaction come back");
  // 12 + 4 = 16 misses the shielded 17.
  world.dice(12, 4);
  const swing = await world.invoke("enemy_attack", { enemyId: g1.id, targetCharacterId: mira.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(hp(world, mira), 30, JSON.stringify(swing.result ?? swing));
  kit.handOnEnemies();
  assert.equal(shielded(world, mira), false);
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false);
});

await test("A reaction to the goblins before Mira, answered after the AI's reply began her turn, comes back with that turn, and it is her one reaction for them", async () => {
  const table = await stage();
  const { world, poppy, mira, g1, g2 } = table;
  world.patch(mira.id, { features: [{ name: "Uncanny Dodge", source: "class" }] });
  await passOrder(table, [g1, g2], []);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "Poppy is done.", world.sheet(poppy.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: poppy.id } });
  assert.equal(ended.ok, true, ended.error);
  // 10 + 4 hits for 3 + 2; 16 + 4 = 20 hits even the shielded 17, for 4 + 2.
  for (const [goblin, faces] of [[g1, [10, 3]], [g2, [16, 4]]]) {
    world.dice(...faces);
    const out = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: goblin.id, targetCharacterId: mira.id } });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  // The reply is narrated: the goblins have acted, and Mira's turn begins.
  tools.advanceAfterTurn(world.campaign(), turn);
  const shield = await react(world, mira, "Shield");
  assert.equal(shield.ok, true, shield.error);
  assert.equal(hp(world, mira), 24, "the first goblin's 5 comes back; the second still hits");
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false, "her turn has given it back");
  assert.equal(shielded(world, mira), false, "her turn has started: Shield is over");
  // The Hand reads the same rule the engine applies: no second card for the pass.
  const view = activePublicEncounter(world.campaignId);
  const miraNow = world.sheet(mira.id);
  const offered = reactionCards(miraNow, turnFromEncounter(view, miraNow, { myTurn: true }), view.lastHits, world.sheets()).find((card) => card.name === "Uncanny Dodge");
  assert.ok(offered, "the second goblin's hit is still open");
  assert.ok(offered.disabled, "the Hand offers no second reaction against the same goblins");
  const dodge = await react(world, mira, "Uncanny Dodge");
  assert.equal(dodge.ok, false, "a second reaction against the same goblins");
  assert.equal(hp(world, mira), 24);
});

await test("The screens wire it: Speaking as on its host flag, Edit in chat names the card's hero, and the companions' reactions in the Hand", () => {
  const view = read("app/campaigns/[campaignId]/SessionView.tsx");
  assert.match(view, /hostOffers\(capabilities, "typedReactions"\)/);
  assert.match(view, /kind === "do" && speakingAs/);
  assert.match(view, /characterId: speakingAs\.id, reaction: true/);
  assert.match(view, /setReactAs\(null\)/, "back on the hero whose turn it is after a send");
  const composer = read("app/campaigns/[campaignId]/Composer.tsx");
  assert.match(composer, /<ReactAsPicker /);
  assert.match(composer, /kind === "do" && speakingAs\?\.reactors\.length/, "in Do: a reaction is something done");
  assert.match(composer, /onComposeAs=\{speakingAs\?\.onChange\}/);
  const picker = read("app/campaigns/[campaignId]/ReactAsPicker.tsx");
  assert.match(picker, /label="Speaking as"/, "named for screen readers");
  assert.match(picker, /size="sm"/, "the kit's small select: 40 px on a touch screen");
  const hand = read("app/campaigns/[campaignId]/Hand.tsx");
  assert.match(hand, /hostOffers\(capabilities, "companionReactions"\)/);
  assert.match(hand, /companionReactors\(sheets, meUserId, sheet\.id, runsTable\)/);
  assert.match(hand, /onComposeAs\?\.\(picked\?\.actor\?\.id \?\? null\)/);
  assert.match(hand, /hostOffers\(capabilities, "reactionHits"\)/);
});

await test("A card from another hero aims at its own hit's attacker", () => {
  const card = { id: "reaction:hellish-rebuke~h2@m", target: "enemy", answers: { characterId: "m", hitId: "h2", attackerId: "g2", attacker: "Goblin 2" } };
  const hits = [
    { characterId: "m", attackerId: "g1", attacker: "Goblin 1" },
    { characterId: "m", attackerId: "g2", attacker: "Goblin 2" },
  ];
  assert.deepEqual(reactionAim(card, hits, "m", []), { id: "g2", name: "Goblin 2", kind: "enemy" }, "the first hit's attacker was every card's aim");
});

// ---- a held turn is not walked before it begins ----
//
// SRD 5.1, Your Turn: "On your turn, you can move a distance up to your
// speed and take one action." The goblin before Mira in the order takes its
// turn before hers begins, so her walk waits for it as her action does: the
// move route refuses it, naming who acts first, and the board lights no
// square; once nothing waits, the walk begins her turn (held-turn.ts).

const tokenAt = (world, hero) => {
  const tile = buildPlayerMapView(world.campaignId, world.owner.id).tokens.find((token) => token.refId === hero.id);
  return tile ? { x: tile.x, y: tile.y } : null;
};

await test("Mira does not walk while the goblin before her is still to act in the AI's reply, and the board lights no square for her", async () => {
  const table = await stage();
  const { world, poppy, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2]);
  const turn = createDmTurn(world.campaignId, [], "ai");
  world.say("player", "That's my turn.", world.sheet(poppy.id));
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: poppy.id } });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(world.encounter().legendary.turnStart, mira.id, "her turn is held for the goblin");
  assert.equal(buildPlayerMapView(world.campaignId, world.owner.id).reachable.length, 0, "the board lights nothing for her yet");
  // (4,6) keeps her beside both goblins: no opportunity attack either way.
  const early = await route(world, "battle-map/move", { x: 4, y: 6 }, world.owner);
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.ok(early.body.error.includes(g1.displayName), early.body.error);
  assert.deepEqual(tokenAt(world, mira), { x: 5, y: 5 }, "she has not moved");
  // The reply is narrated: the goblin the model left takes its turn (a 1
  // misses), and hers begins.
  world.dice(1, 1, 1);
  tools.advanceAfterTurn(world.campaign(), turn);
  world.clearDice();
  assert.equal(world.encounter().legendary.turnStart, undefined, "her turn has begun");
  assert.ok(buildPlayerMapView(world.campaignId, world.owner.id).reachable.length > 0, "the board lights her squares");
  const walked = await route(world, "battle-map/move", { x: 4, y: 6 }, world.owner);
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  assert.deepEqual(tokenAt(world, mira), { x: 4, y: 6 });
});

await test("At a table a person runs, Mira's walk while the goblin before her is due says who acts first", async () => {
  const table = await stage();
  const { world, poppy, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2], { human: true });
  assert.equal(tools.endOwnTurn(world.campaignId, poppy.userId), true, "Poppy ends her turn");
  const early = await route(world, "battle-map/move", { x: 4, y: 6 }, world.owner);
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.ok(early.body.error.includes(g1.displayName), early.body.error);
  assert.deepEqual(tokenAt(world, mira), { x: 5, y: 5 });
});

await test("A held turn nothing still waits on begins with Mira's walk: her reaction is back and the Shield she cast before it ends", async () => {
  const table = await stage();
  const { world, poppy, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2]);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(poppy.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: poppy.id } });
  assert.equal(ended.ok, true, ended.error);
  // The model plays the goblin (10 + 4 hits AC 12 for 3 + 2) and Mira
  // answers with Shield; then the reply fails before its narration.
  world.dice(10, 3);
  const swing = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: g1.id, targetCharacterId: mira.id } });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  const shield = await react(world, mira, "Shield");
  assert.equal(shield.ok, true, shield.error);
  getDatabase().prepare("UPDATE dm_turns SET status = 'failed' WHERE id = ?").run(turn.id);
  assert.equal(world.encounter().legendary.turnStart, mira.id);
  const walked = await route(world, "battle-map/move", { x: 4, y: 6 }, world.owner);
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  assert.equal(world.encounter().legendary.turnStart, undefined, "the walk began her turn");
  assert.equal(world.encounter().reactionsUsed.includes(mira.id), false, "her reaction is back with her turn");
  assert.equal(shielded(world, mira), false, "Shield lasts until the start of her turn");
});

// ---- a held turn's own actions wait for the enemies before it ----
//
// SRD 5.1, Initiative: the order is fixed. A character whose turn is held
// while a goblin before them is still to act takes no action of their own
// turn until it has acted (a reaction, an opportunity attack and a readied
// release are not their turn's). The engine began the turn on the first
// action the AI or the GM's console made for them, and the goblin was skipped
// or played after them.

const heldLine = (goblin) =>
  `${goblin.displayName} acts before Mira: play its turn (enemy_attack / take_action with its enemyId) first, then resolve Mira's action. Nothing was spent.`;

async function aiHandsOn(table) {
  const { world, poppy } = table;
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(poppy.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: poppy.id } });
  assert.equal(ended.ok, true, ended.error);
  // Mira's player says what she does, as the AI's rails ask before it acts
  // for her.
  world.say("player", "Mira raises her guard and strikes at the goblin.", world.sheet(table.mira.id));
  return { turn, ai };
}

await test("At an AI table, Mira's own action while the goblin before her is still to act is refused with who acts first and how, spending nothing; once the model plays it, her action begins her turn", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2]);
  const { ai } = await aiHandsOn(table);
  for (const call of [
    { name: "take_action", args: { characterId: mira.id, action: "dodge" } },
    { name: "pc_attack", args: { characterId: mira.id, targetEnemyId: g1.id } },
  ]) {
    const out = await invokeEngine(world.campaign(), ai, call);
    assert.equal(out.ok, false, `${call.name}: ${JSON.stringify(out)}`);
    assert.equal(out.error, heldLine(g1), call.name);
    assert.equal(out.retry, true, call.name);
  }
  assert.equal(world.encounter().legendary.turnStart, mira.id, "her turn has not begun");
  assert.equal(world.encounter().turnBudget, null, "nothing of her turn was spent");
  assert.ok(!world.sheet(mira.id).conditions.some((entry) => entry.toLowerCase() === "dodging"), "no Dodge");
  // The model plays the goblin (a 1 misses), then her Dodge is her turn's.
  world.dice(1);
  const goblin = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: g1.id, targetCharacterId: mira.id } });
  world.clearDice();
  assert.equal(goblin.ok, true, goblin.error);
  const dodge = await invokeEngine(world.campaign(), ai, { name: "take_action", args: { characterId: mira.id, action: "dodge" } });
  assert.equal(dodge.ok, true, dodge.error);
  assert.equal(world.encounter().legendary.turnStart, undefined, "her action began her turn");
});

await test("At a table a person runs, the console's action for Mira while the goblin before her is due is refused the same way and spends nothing; played from the monsters' Hand, the goblin lets her act", async () => {
  const table = await stage();
  const { world, poppy, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2], { human: true });
  assert.equal(tools.endOwnTurn(world.campaignId, poppy.userId), true, "Poppy ends her turn");
  // The engine's answer, and what the console's route shows the GM.
  for (const [name, args] of [
    ["take_action", { characterId: mira.id, action: "dodge" }],
    ["pc_attack", { characterId: mira.id, targetEnemyId: g1.id }],
  ]) {
    const out = await world.invoke(name, args);
    assert.equal(out.ok, false, `${name}: ${JSON.stringify(out)}`);
    assert.equal(out.error, heldLine(g1), name);
    assert.equal(out.retry, true, name);
    const shown = await route(world, "dm/invoke", { name, args }, world.owner);
    assert.equal(shown.status, 409, JSON.stringify(shown.body));
    assert.equal(shown.body.error, heldLine(g1), `${name} on the console`);
  }
  assert.equal(world.encounter().legendary.turnStart, mira.id, "her turn has not begun");
  assert.equal(world.encounter().turnBudget, null, "nothing of her turn was spent");
  assert.ok(!world.sheet(mira.id).conditions.some((entry) => entry.toLowerCase() === "dodging"), "no Dodge");
  // The GM plays the goblin from the monsters' Hand (a 1 misses).
  world.dice(1);
  const goblin = await route(world, "dm/invoke", { name: "enemy_attack", args: { enemyId: g1.id, targetCharacterId: mira.id }, hand: true }, world.owner);
  world.clearDice();
  assert.equal(goblin.status, 200, JSON.stringify(goblin.body));
  const dodge = await route(world, "dm/invoke", { name: "take_action", args: { characterId: mira.id, action: "dodge" } }, world.owner);
  assert.equal(dodge.status, 200, JSON.stringify(dodge.body));
  assert.equal(world.encounter().legendary.turnStart, undefined, "her action began her turn");
});

await test("A goblin before Mira that cannot act holds nothing up: stunned after the pass, or fled, it is not due and her action is hers at once", async () => {
  for (const unable of ["stunned", "fled"]) {
    const table = await stage();
    const { world, mira, g1, g2 } = table;
    await passOrder(table, [g1], [g2]);
    const { ai } = await aiHandsOn(table);
    if (unable === "stunned") {
      patchEnemyConditions(g1.id, ["stunned"], { stunned: {} });
    } else {
      const fled = await invokeEngine(world.campaign(), ai, { name: "enemy_flees", args: { enemyId: g1.id, reason: "it runs" } });
      assert.equal(fled.ok, true, fled.error);
    }
    const dodge = await invokeEngine(world.campaign(), ai, { name: "take_action", args: { characterId: mira.id, action: "dodge" } });
    assert.equal(dodge.ok, true, `${unable}: ${dodge.error}`);
    assert.equal(world.encounter().legendary.turnStart, undefined, `${unable}: her action began her turn`);
  }
});

await test("The AI table's backstop still plays the goblin the reply left, and Mira's turn begins after it", async () => {
  const table = await stage();
  const { world, mira, g1, g2 } = table;
  await passOrder(table, [g1], [g2]);
  const { turn, ai } = await aiHandsOn(table);
  const early = await invokeEngine(world.campaign(), ai, { name: "take_action", args: { characterId: mira.id, action: "dodge" } });
  assert.equal(early.ok, false, "refused while the goblin is due");
  // The reply is narrated: the backstop plays the goblin (a 1 misses).
  world.dice(1, 1, 1);
  tools.advanceAfterTurn(world.campaign(), turn);
  world.clearDice();
  assert.ok(world.encounter().legendary.acted?.ids.includes(g1.id), "the goblin took its turn");
  assert.equal(world.encounter().legendary.turnStart, undefined, "her turn has begun");
  const later = createDmTurn(world.campaignId, [], "ai");
  world.say("player", "Mira raises her guard.", world.sheet(mira.id));
  const dodge = await invokeEngine(world.campaign(), { kind: "ai", turnId: later.id }, { name: "take_action", args: { characterId: mira.id, action: "dodge" } });
  assert.equal(dodge.ok, true, dodge.error);
});

finish();
