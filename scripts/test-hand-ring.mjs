// Each spell in a worn, attuned Ring of Spell Storing is a card of its own
// (src/lib/battlemap/hand-ring.ts). use_item with a ring holding several asked
// which one, so a player had to type it; each spell's card now names it, says why
// it cannot be played when it cannot, and is played through the tools a typed
// release uses (use_item, then the spell's own), spending no slot. A fighter with
// no Spellcasting feature holds them as a wizard does.
import assert from "node:assert/strict";
import { clearDice, dice, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-hand-ring");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN, spellsToLookUp, handSpellsToLookUp } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards, withReactions } = await import("../src/lib/battlemap/hand-react.ts");
const { groupHand, groupKeysOf, isGroup } = await import("../src/lib/battlemap/hand-groups.ts");
const { composeSentence, intentBody, afterCommit } = await import("../src/lib/battlemap/hand-play.ts");
const { threeThingsToTry } = await import("../src/lib/characters/hero-tips.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");
const { directContextFor } = await import("../src/lib/dm/direct-context.ts");
const { describeIntent, directCardCalls, intentAnswered, intentCorrection, parseMessageIntent, unresolvedCards } = await import("../src/lib/dm/intent-logic.ts");
const { allocateSeq, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getCampaignMessage, insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { resolveAsPlayed } = await import("../src/lib/dm/resolve-card.ts");
const { takeItemCast } = await import("../src/lib/srd/item-cast-credit.ts");
const { CASTING_COMPLETE } = await import("../src/lib/dm/long-casting-logic.ts");

const RING = "Ring of Spell Storing";
const stored = (spell, level, extra = {}) => ({ spell, level, saveDc: 15, attackBonus: 7, abilityMod: 4, by: "Mage", ...extra });
const ring = (spells, extra = {}) => ({ name: RING, qty: 1, equipped: true, attuned: true, storedSpells: spells, ...extra });
const campaign = () => getCampaignById(world.campaignId);

const brute = world.addHero({ name: "Brute", class: "fighter", level: 5, maxHp: 40, ac: 12, acOverride: true, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [] });
const mage = world.addHero({
  name: "Mage",
  class: "wizard",
  level: 9,
  maxHp: 40,
  ac: 12,
  acOverride: true,
  abilities: { int: 18 },
  equipment: [],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 3: { max: 3, used: 0 } }, known: [], prepared: ["Shield", "Fireball"], cantrips: [], spellbook: ["Shield", "Fireball"] },
});

async function stage(who = brute, equipment = [ring([stored("Hold Person", 2), stored("Fireball", 3)])]) {
  await kit.endFight();
  world.patch(who.id, { equipment, currentHp: 40, conditions: [], conditionMeta: {}, concentratingOn: null });
  await kit.fight(1, { heroFaces: { [who.id]: 20 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 500 });
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 6, 6);
  kit.giveTurn(who.id);
  return enemy;
}

const turnOf = (who) => turnFromEncounter(activePublicEncounter(world.campaignId), world.sheet(who.id), { myTurn: true });
const handOf = (who, turn = turnOf(who)) => deriveHand(world.sheet(who.id), turn);
const ringCards = (who, turn) => handOf(who, turn).filter((card) => card.intent.item);
const cardFor = (who, spell, turn) => ringCards(who, turn).find((card) => card.intent.spell === spell);
const held = (who) => world.sheet(who.id).equipment.find((item) => item.name === RING)?.storedSpells ?? [];
const aimAt = (enemy) => ({ id: enemy.id, name: enemy.displayName, kind: "enemy" });

// A card played as the Hand and the route play it: the engine asked, then its calls
// run in order.
async function play(who, card, aim = null, choices = {}) {
  const intent = parseMessageIntent(intentBody(card, aim, [], choices));
  assert.ok(intent, "the card's intent passes the message schema");
  const refused = intentRefusal(campaign(), world.sheet(who.id), intent);
  assert.equal(refused, null, `refused: ${refused}`);
  const calls = directCardCalls(intent, who.id, directContextFor(world.campaignId, intent, [], who.id));
  assert.ok(calls, "the engine takes the card whole");
  const results = [];
  for (const call of calls) {
    results.push({ ...call, result: await world.invoke(call.name, call.args) });
  }
  return { intent, calls, results };
}

await test("A fighter with no Spellcasting feature is dealt one card per stored spell, naming it and its level, with the numbers it was stored with", async () => {
  await stage();
  const cards = ringCards(brute);
  assert.deepEqual(cards.map((card) => card.name), ["Ring: Hold Person", "Ring: Fireball"]);
  const hold = cards[0];
  assert.equal(hold.resource, "Level 2");
  assert.equal(hold.save.dc, 15, "the original caster's DC, not one a fighter does not have");
  assert.equal(hold.disabled, null, hold.disabled);
  assert.equal(hold.target, "enemy");
  assert.equal(cards[1].area?.pick, "point", "a blast is laid on the board, as Fireball's own card is");
  assert.ok(cards[1].dice.startsWith("8d6"), cards[1].dice);
});

await test("An upcast spell's card rolls the dice of the level it was stored at", async () => {
  await stage(brute, [ring([stored("Burning Hands", 3)])]);
  assert.ok(cardFor(brute, "Burning Hands").dice.startsWith("5d6"), cardFor(brute, "Burning Hands").dice);
});

await test("The card greys with the engine's own reason: not attuned, not worn, not their turn, no action left", async () => {
  await stage(brute, [ring([stored("Hold Person", 2)], { attuned: false })]);
  assert.match(cardFor(brute, "Hold Person").disabled, /works only for someone attuned/);
  await stage(brute, [ring([stored("Hold Person", 2)], { equipped: false }), { name: "Chain Mail", qty: 1, equipped: true }]);
  assert.match(cardFor(brute, "Hold Person").disabled, /only while it is worn/);
  await stage();
  const offTurn = { ...FRESH_TURN, myTurn: false, currentName: "Goblin", table: { round: 1, orderReady: true, acting: { id: "", name: "Goblin" }, surprised: { acting: [], reacting: [] } } };
  assert.match(cardFor(brute, "Hold Person", offTurn).disabled, /Goblin|turn/);
  assert.match(cardFor(brute, "Hold Person", { ...turnOf(brute), actionUsed: true }).disabled, /action/);
  assert.equal(cardFor(brute, "Hold Person", { ...turnOf(brute), actionUsed: true }).spent, true, "spent dims it rather than greys it");
});

await test("The route refuses what the card would grey, in the same words, and writes nothing", async () => {
  const enemy = await stage(brute, [ring([stored("Hold Person", 2)], { attuned: false })]);
  const intent = { card: "spell", spell: "Hold Person", slotLevel: 2, item: RING, targetId: enemy.id, targetKind: "enemy" };
  assert.match(intentRefusal(campaign(), world.sheet(brute.id), intent), /works only for someone attuned/);
  world.patch(brute.id, { equipment: [ring([stored("Fireball", 3)])] });
  assert.match(intentRefusal(campaign(), world.sheet(brute.id), intent), /holds Fireball, not Hold Person/);
  assert.match(intentRefusal(campaign(), world.sheet(brute.id), { ...intent, item: "Longsword" }), /holds no spell/);
  world.patch(brute.id, { equipment: [ring([stored("Hold Person", 2)])] });
  assert.equal(intentRefusal(campaign(), world.sheet(brute.id), intent), null);
  assert.equal(world.encounter().budget?.actionUsed ?? false, false, "asking spends nothing");
  assert.equal(takeItemCast(brute.id, "Hold Person", { dryRun: true }), null, "asking writes no credit");
});

await test("Played, the spell is drawn then cast by its own tool with no slot, leaves the ring, and its card goes", async () => {
  const enemy = await stage();
  const { calls, results } = await play(brute, cardFor(brute, "Hold Person"), aimAt(enemy));
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "cast_at_enemy"]);
  assert.deepEqual(calls[0].args, { characterId: brute.id, item: RING, spell: "Hold Person" });
  assert.equal(calls[1].args.level, 2);
  for (const { name, result } of results) assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result)}`);
  assert.deepEqual(held(brute).map((entry) => entry.spell), ["Fireball"]);
  assert.deepEqual(ringCards(brute).map((card) => card.name), ["Ring: Fireball"], "the card went with the spell");
});

await test("A wizard's own Fireball stays apart from the ring's: the ring's spends no slot and the card of their own is left", async () => {
  const enemy = await stage(mage, [ring([stored("Fireball", 3)])]);
  const cards = handOf(mage).filter((card) => card.intent.spell === "Fireball");
  assert.equal(cards.length, 2, "one from the slots, one from the ring");
  assert.notEqual(cards[0].id, cards[1].id);
  const { calls, results } = await play(mage, cardFor(mage, "Fireball"), null, { area: { at: { x: 6, y: 6 } } });
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "aoe_damage"]);
  for (const { name, result } of results) assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result)}`);
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 0, "no slot spent");
  assert.deepEqual(held(mage), []);
  assert.ok(enemy);
});

await test("A healing spell asks who, as Cure Wounds' own card does, and heals with the stored modifier", async () => {
  await stage(brute, [ring([stored("Cure Wounds", 1)])]);
  world.patch(brute.id, { currentHp: 1 });
  const card = cardFor(brute, "Cure Wounds");
  assert.equal(card.target, "ally");
  const { calls, results } = await play(brute, card, { id: brute.id, name: "Brute", kind: "self" });
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "heal"]);
  assert.notEqual(results[1].result.ok, false, JSON.stringify(results[1].result));
  assert.ok(world.sheet(brute.id).currentHp > 5, "1 + 1d8 + 4");
});

await test("A summoning asks its creature on the card, and needs none to begin with", async () => {
  await stage(brute, [ring([stored("Conjure Animals", 3)])]);
  const intent = { card: "spell", spell: "Conjure Animals", slotLevel: 3, item: RING };
  const context = directContextFor(world.campaignId, intent, [], brute.id);
  assert.equal(directCardCalls(intent, brute.id, context), null, "no creature named: the GM's to pick");
  const calls = directCardCalls({ ...intent, variant: "Wolf", count: 2 }, brute.id, context);
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "cast_buff"]);
  assert.match(intentRefusal(campaign(), world.sheet(brute.id), { ...intent, variant: "Wolf", count: 3 }) ?? "", /./, "a number the spell does not offer is refused before anything is drawn");
});

await test("A reaction spell's card stays grey in the hand and cannot fire with nothing to answer, and no credit is left to pay for a later Shield", async () => {
  await stage(mage, [ring([stored("Shield", 1)])]);
  const card = cardFor(mage, "Shield");
  assert.match(card.disabled, /cast as a reaction: its card comes up when an attack hits you/);
  const intent = parseMessageIntent(intentBody({ ...card, disabled: null }, null));
  assert.equal(intent.card, "reaction");
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), intent), /Shield is cast when Mage is hit by an attack/);
  assert.equal(takeItemCast(mage.id, "Shield", { dryRun: true }), null);
  assert.equal(held(mage).length, 1);
});

await test("Counterspell, which names the spell it answers, is asked for in words", async () => {
  await stage(brute, [ring([stored("Counterspell", 3)])]);
  assert.match(cardFor(brute, "Counterspell").disabled, /say so in your own words/);
  const intent = { card: "reaction", feature: "Counterspell", spell: "Counterspell", slotLevel: 3, item: RING };
  assert.match(intentRefusal(campaign(), world.sheet(brute.id), intent), /no card can name/);
});

await test("When an attack hits, the ring's Shield comes up, takes the place of its grey card, and casts with no slot", async () => {
  const enemy = await stage(mage, [ring([stored("Shield", 1)])]);
  world.dice(15, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: mage.id });
  world.clearDice();
  const view = activePublicEncounter(world.campaignId);
  const sheet = world.sheet(mage.id);
  const chips = reactionCards(sheet, FRESH_TURN, view.lastHits ?? [], []);
  const chip = chips.find((card) => card.name === "Ring: Shield");
  assert.ok(chip, `dealt: ${chips.map((card) => card.name).join(", ")}`);
  assert.ok(chips.some((card) => card.name === "Shield"), "their own card of it stands beside it: which pays is theirs to choose");
  assert.equal(chip.disabled, null, chip.disabled);
  assert.equal(chip.intent.item, RING);
  assert.equal(chip.resource, "Level 1");
  assert.equal(withReactions(chips, deriveHand(sheet, FRESH_TURN)).filter((card) => card.name === "Ring: Shield").length, 1, "the grey one gives way");
  assert.equal(composeSentence(chip, null), `I cast Shield from my ${RING} as a reaction.`);
  const before = world.sheet(mage.id).spellcasting.slots["1"].used;
  const { calls, results } = await play(mage, chip);
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "use_reaction"]);
  assert.equal(results[1].result.ok, true, JSON.stringify(results[1].result));
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, before, "no slot");
  assert.deepEqual(held(mage), []);
  assert.ok(world.sheet(mage.id).conditions.includes("shielded"));
});

await test("A fighter's ring answers too: Shield and Hellish Rebuke come up with no spell list behind them, and an unworn ring greys them", async () => {
  const enemy = await stage(brute, [ring([stored("Shield", 1), stored("Hellish Rebuke", 2)])]);
  world.dice(19, 4);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: brute.id });
  world.clearDice();
  const hits = activePublicEncounter(world.campaignId).lastHits ?? [];
  const names = reactionCards(world.sheet(brute.id), FRESH_TURN, hits, []).map((card) => card.name);
  assert.ok(names.includes("Ring: Shield") && names.includes("Ring: Hellish Rebuke"), names.join(", "));
  const rebuke = reactionCards(world.sheet(brute.id), FRESH_TURN, hits, []).find((card) => card.name === "Ring: Hellish Rebuke");
  const { results } = await play(brute, rebuke, aimAt(enemy));
  assert.notEqual(results[1].result.ok, false, JSON.stringify(results[1].result));
  assert.deepEqual(held(brute).map((entry) => entry.spell), ["Shield"]);
  world.patch(brute.id, { equipment: [ring([stored("Shield", 1)], { equipped: false }), { name: "Chain Mail", qty: 1, equipped: true }] });
  const unworn = reactionCards(world.sheet(brute.id), FRESH_TURN, hits, []).find((card) => card.name === "Ring: Shield");
  assert.match(unworn.disabled, /only while it is worn/);
});

await test("A fall brings up the ring's Feather Fall", async () => {
  await kit.endFight();
  world.patch(brute.id, { equipment: [ring([stored("Feather Fall", 1)])], currentHp: 40, conditions: [], conditionMeta: {} });
  await kit.fight(1, { heroFaces: { [brute.id]: 20 } });
  const before = world.sheet(brute.id).currentHp;
  world.dice(6, 6, 6, 6, 6, 6);
  await world.invoke("apply_hazard", { type: "falling", feet: 60, characterIds: [brute.id] });
  world.clearDice();
  const hits = activePublicEncounter(world.campaignId).lastHits ?? [];
  const chip = reactionCards(world.sheet(brute.id), FRESH_TURN, hits, []).find((card) => card.name === "Ring: Feather Fall");
  assert.ok(chip, JSON.stringify(hits));
  const { results } = await play(brute, chip);
  assert.equal(results[1].result.ok, true, JSON.stringify(results[1].result));
  assert.equal(world.sheet(brute.id).currentHp, before);
  assert.deepEqual(held(brute), []);
});

await test("A spell of a minute or more begins its held casting in a fight: it aims at nothing, spends the action, and greys while it runs", async () => {
  await stage(brute, [ring([stored("Alarm", 1)])]);
  const card = cardFor(brute, "Alarm");
  assert.equal(card.disabled, null, card.disabled);
  assert.equal(card.target, "none");
  assert.equal(card.cost, "action");
  assert.match(card.rules, /takes turns to cast/);
  const { calls, results, intent } = await play(brute, card);
  assert.deepEqual(calls.map((call) => call.name), ["use_item"], "nothing resolves it yet");
  assert.match(String((results[0].result.result ?? results[0].result).casting), /10 rounds/);
  assert.equal(held(brute).length, 1, "it stays in the ring until it takes effect");
  assert.match(cardFor(brute, "Alarm").disabled, /is casting Alarm/);
  const played = { intent, characterId: brute.id, name: "Brute", resolution: "utility" };
  assert.equal(intentAnswered(played, results.map(({ name, args, result }) => ({ name, args, result: result.result ?? result }))), true, "a casting begun is the card carried out, not one to send back");
});

await test("A summoning of a minute comes up free once its casting is done, and asks its creature", async () => {
  await stage(brute, [ring([stored("Conjure Elemental", 5)])]);
  world.patch(brute.id, { conditions: [CASTING_COMPLETE], conditionMeta: { [CASTING_COMPLETE]: { spell: "Conjure Elemental", source: brute.id } } });
  const card = cardFor(brute, "Conjure Elemental");
  assert.equal(card.cost, "free");
  assert.equal(card.disabled, null, card.disabled);
  const intent = { card: "spell", spell: "Conjure Elemental", slotLevel: 5, item: RING, variant: "Fire Elemental" };
  const calls = directCardCalls(intent, brute.id, directContextFor(world.campaignId, intent, [], brute.id));
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "cast_buff"], "the casting is done: this card resolves it");
  const before = world.encounter();
  const drawn = await world.invoke("use_item", calls[0].args);
  assert.notEqual(drawn.ok, false, JSON.stringify(drawn));
  assert.equal((drawn.result ?? drawn).casting, undefined, "it does not begin again");
  assert.deepEqual(world.encounter().budget, before.budget, "and pays nothing more");
});

await test("Out of a fight a spell of a minute is cast at once, its tool following the draw", async () => {
  await kit.endFight();
  world.patch(brute.id, { equipment: [ring([stored("Alarm", 1)])], conditions: [], conditionMeta: {} });
  const card = cardFor(brute, "Alarm", FRESH_TURN);
  const intent = parseMessageIntent(intentBody(card, null));
  assert.equal(intentRefusal(campaign(), world.sheet(brute.id), intent), null);
  // With no pack this table has no row for Alarm: the row says what the pack would.
  const context = { ...directContextFor(world.campaignId, intent, [], brute.id), resolution: "utility" };
  assert.equal(context.ringBegins, undefined, "no fight, nothing to hold across");
  const calls = directCardCalls(intent, brute.id, context);
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "use_spell_slot"]);
  for (const call of calls) {
    const result = await world.invoke(call.name, call.args);
    assert.notEqual(result.ok, false, `${call.name}: ${JSON.stringify(result)}`);
  }
  assert.deepEqual(held(brute), []);
});

await test("A draw nothing cast goes back as a card does, and played again it pays nothing more", async () => {
  const enemy = await stage();
  const card = cardFor(brute, "Hold Person");
  const intent = parseMessageIntent(intentBody(card, aimAt(enemy)));
  const played = { intent, characterId: brute.id, name: "Brute", resolution: "save" };
  const draw = { name: "use_item", args: { characterId: brute.id, item: RING, spell: "Hold Person" } };
  const out = await world.invoke(draw.name, draw.args);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(unresolvedCards([played], [{ ...draw, result: out }]), [played], "drawing casts nothing");
  assert.deepEqual(unresolvedCards([played], [{ ...draw, result: { error: "no", refused: "rules" } }]), [], "a refusal is an answer");
  assert.deepEqual(unresolvedCards([played], [{ ...draw, result: out }, { name: "cast_at_enemy", args: { characterId: brute.id, targetEnemyId: enemy.id, spell: "Hold Person" }, result: { error: "too far", retry: true } }]), [played], "a call sent back is no answer");
  assert.deepEqual(unresolvedCards([played], [{ ...draw, result: out }, { name: "cast_at_enemy", args: { characterId: brute.id, targetEnemyId: enemy.id, spell: "Hold Person" }, result: { ok: true } }]), []);
  assert.equal(held(brute).length, 2, "the spell waits in the ring");
  // The action is gone, but on this spell: the card stands open, and another does not.
  const again = cardFor(brute, "Hold Person");
  assert.equal(again.disabled, null, again.disabled);
  assert.match(cardFor(brute, "Fireball").disabled, /action/);
  assert.equal(intentRefusal(campaign(), world.sheet(brute.id), intent), null);
  const budget = world.encounter().budget;
  const replay = await world.invoke(draw.name, draw.args);
  assert.equal(replay.ok, true);
  assert.deepEqual(world.encounter().budget, budget, "no second action");
});

await test("At a table a person runs, a card whose cast is refused after the draw stays waiting, and the spell stays in the ring", async () => {
  const enemy = await stage();
  const post = (targetId) =>
    insertCampaignMessage({
      campaignId: world.campaignId,
      seq: allocateSeq(world.campaignId),
      authorType: "player",
      userId: world.owner.id,
      characterId: brute.id,
      content: "I cast Hold Person from my ring.",
      intent: { card: "spell", spell: "Hold Person", slotLevel: 2, item: RING, targetId, targetKind: "enemy" },
    });
  const lost = post("nobody-at-all");
  const refused = await resolveAsPlayed(campaign(), world.owner.id, lost.id);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(getCampaignMessage(lost.id).cardResolvedAt ?? null, null, "nothing was cast, so the card is still the GM's to resolve");
  assert.equal(held(brute).length, 2);
  const right = post(enemy.id);
  const resolved = await resolveAsPlayed(campaign(), world.owner.id, right.id);
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.deepEqual(held(brute).map((entry) => entry.spell), ["Fireball"]);
});

await test("The sentence and the model's line say it comes out of the ring, with use_item first", async () => {
  const enemy = await stage();
  const card = cardFor(brute, "Hold Person");
  assert.equal(composeSentence(card, aimAt(enemy)), `I cast Hold Person from my ${RING} at ${enemy.displayName}.`);
  const intent = parseMessageIntent(intentBody(card, aimAt(enemy)));
  const line = describeIntent(intent, brute.id);
  assert.match(line, new RegExp(`Hold Person out of ${RING}, at level 2 with no slot`));
  assert.match(line, new RegExp(`Resolve it with use_item with item=${RING} and spell=Hold Person, then the spell's tool`));
  assert.match(intentCorrection(intent, brute.id, "Brute", "save"), new RegExp(`Call use_item with item=${RING} and spell=Hold Person, then the spell's tool now`));
  assert.doesNotMatch(line, /from a level 2 slot/);
});

await test("A ring card spends the action and leaves no spell-rule mark, as use_item does", async () => {
  await stage();
  const next = afterCommit(FRESH_TURN, cardFor(brute, "Hold Person"));
  assert.equal(next.actionUsed, true);
  assert.deepEqual(next.marks ?? [], []);
});

await test("A mystery ring deals nothing until it is named, nor does a workshop ring of the name; two rings deal their own cards, a doubled spell deals one", async () => {
  await stage(brute, [ring([stored("Hold Person", 2)], { identified: false })]);
  assert.deepEqual(ringCards(brute), []);
  await stage(brute, [ring([stored("Hold Person", 2)], { slug: "homebrew:workshop-1" })]);
  assert.deepEqual(ringCards(brute), []);
  await stage(brute, [ring([stored("Magic Missile", 1), stored("Magic Missile", 3)]), ring([stored("Magic Missile", 1)], { name: `${RING} (2)`, srdName: RING, equipped: true, attuned: true })]);
  const cards = ringCards(brute);
  assert.equal(cards.length, 2, cards.map((card) => card.id).join(", "));
  assert.equal(new Set(cards.map((card) => card.id)).size, 2);
  assert.equal(cards[0].resource, "Level 1", "the one the engine casts first");
  assert.deepEqual(cards.map((card) => card.intent.item), [RING, `${RING} (2)`]);
});

await test("One card sits under both Spells and Items once both have folded, and stands loose once while neither has", async () => {
  const groupsOf = (who) => {
    const { units, groups } = groupHand(handOf(who), world.sheet(who.id));
    return { units, holding: (name) => groups.filter((group) => group.cards.some((card) => card.name === name)).map((group) => group.key) };
  };
  const armed = [{ name: "Longsword", qty: 1, equipped: true }];

  // Neither folded: the ring's one spell and a stow and a drop are three items.
  await stage(brute, [...armed, ring([stored("Knock", 2)])]);
  const loose = groupsOf(brute);
  assert.deepEqual(loose.holding("Ring: Knock"), []);
  assert.equal(loose.units.filter((unit) => !isGroup(unit) && unit.name === "Ring: Knock").length, 1, "dealt once");

  // A fighter's two spells fold Items and not Spells: inside it, and not loose too.
  await stage(brute, [...armed, ring([stored("Knock", 2), stored("Hold Person", 2)])]);
  const items = groupsOf(brute);
  assert.deepEqual(items.holding("Ring: Knock"), ["items"]);
  assert.equal(items.units.filter((unit) => !isGroup(unit) && unit.name === "Ring: Knock").length, 0);

  // A caster's own spells fold Spells too: the same card under both.
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, prepared: ["Shield", "Fireball", "Sleep", "Magic Missile"], spellbook: ["Shield", "Fireball", "Sleep", "Magic Missile"] } });
  await stage(mage, [...armed, ring([stored("Knock", 2), stored("Hold Person", 2)])]);
  const both = groupsOf(mage);
  assert.deepEqual(both.holding("Ring: Knock").sort(), ["items", "spells"]);
  assert.equal(both.units.filter((unit) => !isGroup(unit) && unit.name === "Ring: Knock").length, 0);
  assert.equal(both.units.filter(isGroup).filter((group) => group.key === "items" || group.key === "spells").length, 2, "each group once");
  const { groups } = groupHand(handOf(mage), world.sheet(mage.id));
  const [inSpells, inItems] = ["spells", "items"].map((key) => groups.find((group) => group.key === key).cards.find((card) => card.name === "Ring: Knock"));
  assert.equal(inSpells, inItems, "one card, not two copies");

  // Its spell gone, it goes from both.
  world.patch(mage.id, { equipment: [...armed, ring([stored("Hold Person", 2)])] });
  assert.deepEqual(groupsOf(mage).holding("Ring: Knock"), []);
});

await test("They belong to Spells and Items, take no Ready pick and are no first-turn tip; the summoning door still lists the sheet's own spells only", async () => {
  await stage(mage, [ring([stored("Hold Person", 2)])]);
  const sheet = world.sheet(mage.id);
  const card = cardFor(mage, "Hold Person");
  assert.deepEqual(groupKeysOf(card), ["spells", "items"]);
  const ready = handOf(mage).find((entry) => entry.id === "basic:ready");
  assert.ok(!ready.choice.options.some((option) => option.value === "Hold Person"), "readying it would ask for a spell the sheet does not hold");
  assert.ok(!threeThingsToTry(sheet).some((tip) => /Hold Person/.test(JSON.stringify(tip))));
  assert.ok(!spellsToLookUp(sheet).includes("Hold Person"));
  assert.ok(handSpellsToLookUp(sheet).includes("Hold Person"), "the card reads the pack's words");
});

await test("A ring's Witch Bolt is a new casting even at what the held beam is connected to, and the beam's own card still strikes", async () => {
  const goblin = await stage(brute, [ring([stored("Witch Bolt", 2)])]);
  kit.place(goblin.id, 8, 5);
  dice(15, 5);
  const first = await play(brute, cardFor(brute, "Witch Bolt"), aimAt(goblin));
  clearDice();
  assert.deepEqual(first.calls.map((call) => call.name), ["use_item", "pc_attack"]);
  assert.equal(world.sheet(brute.id).concentratingOn, "Witch Bolt", JSON.stringify(first.results));
  assert.ok(world.enemies().find((entry) => entry.id === goblin.id).conditions.includes("witch bolt"), "the hit connected it");

  // The same ring filled again, and a new turn with the beam still held.
  world.patch(brute.id, { equipment: [ring([stored("Witch Bolt", 1)])] });
  kit.giveTurn(brute.id);
  const card = cardFor(brute, "Witch Bolt");
  assert.equal(card.resource, "Level 1", "not the beam's No slot");
  assert.equal(card.toHit, 7, "it rolls, with the numbers it was stored with");
  const intent = parseMessageIntent(intentBody(card, aimAt(goblin), [], {}));
  const calls = directCardCalls(intent, brute.id, directContextFor(world.campaignId, intent, [], brute.id));
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "pc_attack"], "drawn and cast: no credit left waiting behind a strike");

  // The beam's own card, its spell on no list of a fighter's.
  const strike = handOf(brute).find((entry) => entry.name === "Witch Bolt");
  assert.equal(strike.resource, "No slot");
  const aimed = parseMessageIntent(intentBody(strike, aimAt(goblin), [], {}));
  const struck = directCardCalls(aimed, brute.id, directContextFor(world.campaignId, aimed, [], brute.id));
  assert.deepEqual(struck.map((call) => call.name), ["cast_at_enemy"]);
});

finish();
