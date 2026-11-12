// Each spell a magic item casts is a card of its own (src/lib/battlemap/hand-items.ts):
// a wand, a staff, a ring that casts, a spell scroll. Before, the only magic item
// ability the Hand dealt was Drink a potion, and these could only be typed. A card
// names the item and the spell, shows what is left, greys with the engine's reason,
// and is played through the tools a typed use takes (use_item, then the spell's
// own), spending no slot. A cast that does not happen gives back what the item spent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-hand-items");
const world = await openWorld({ campaign: { maxPlayers: 20 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { deriveHand, handSpellsToLookUp, spellsToLookUp } = await import("../src/lib/battlemap/hand.ts");
const { itemCastRows, itemSpellNames } = await import("../src/lib/battlemap/hand-items.ts");
const { groupHand, groupKeysOf, isGroup } = await import("../src/lib/battlemap/hand-groups.ts");
const { composeSentence, intentBody, afterCommit } = await import("../src/lib/battlemap/hand-play.ts");
const { threeThingsToTry } = await import("../src/lib/characters/hero-tips.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");
const { directContextFor } = await import("../src/lib/dm/direct-context.ts");
const { describeIntent, directCardCalls, drawStopsCast, intentAnswered, parseMessageIntent, unresolvedCards } = await import("../src/lib/dm/intent-logic.ts");
const { allocateSeq, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getCampaignMessage, insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { resolveAsPlayed } = await import("../src/lib/dm/resolve-card.ts");
const { dropItemCast, spellDrawnMark, takeItemCast } = await import("../src/lib/srd/item-cast-credit.ts");
const { chargedItemUse, paidItemCast, takeBackItemCast } = await import("../src/lib/dm/item-use.ts");
const { itemSpellsOf } = await import("../src/lib/srd/item-spells.ts");

const campaign = () => getCampaignById(world.campaignId);
const SCROLL_TAGS = ["consumable", "scroll", "carried"];
const scroll = (spell, extra = {}) => ({ name: `Spell Scroll (${spell})`, qty: 1, tags: SCROLL_TAGS, spell, ...extra });
const wand = (name, extra = {}) => ({ name, qty: 1, attuned: true, ...extra });

const brute = world.addHero({ name: "Brute", class: "fighter", level: 5, maxHp: 60, ac: 12, acOverride: true, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [] });
const OWN_SPELLS = { ability: "int", slots: { 1: { max: 4, used: 0 }, 3: { max: 3, used: 0 } }, known: [], prepared: ["Fireball"], cantrips: [], spellbook: ["Fireball"] };
const mage = world.addHero({ name: "Mage", class: "wizard", level: 9, maxHp: 60, ac: 12, acOverride: true, abilities: { int: 18 }, equipment: [], spellcasting: OWN_SPELLS });

async function stage(who, equipment) {
  await kit.endFight();
  for (const hero of [brute, mage]) {
    world.patch(hero.id, { equipment: hero.id === who.id ? equipment : [], currentHp: 60, conditions: [], conditionMeta: {}, concentratingOn: null });
    for (const { entry } of itemCastRows({ equipment })) dropItemCast(hero.id, entry.spell);
  }
  world.patch(mage.id, { spellcasting: OWN_SPELLS, abilities: { ...world.sheet(mage.id).abilities, int: 18 } });
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
const itemCards = (who, turn) => handOf(who, turn).filter((card) => card.fromItem);
const cardNamed = (who, name, turn) => itemCards(who, turn).find((card) => card.name === name);
const row = (who, name) => world.sheet(who.id).equipment.find((item) => item.name === name);
const aimAt = (enemy) => ({ id: enemy.id, name: enemy.displayName, kind: "enemy" });
// What the tool answered, without the engine door's own wrapping.
const run = async (name, args) => {
  const out = await world.invoke(name, args);
  return out.result ?? out;
};
const usedAction = () => world.encounter().budget?.actionUsed ?? world.encounter().turnBudget?.actionUsed ?? false;

// A card played as the Hand and the route play it: the engine asked, then its calls
// run in order, stopping where use_item did not pay for a cast.
async function play(who, card, aim = null, choices = {}) {
  const intent = parseMessageIntent(intentBody(card, aim, [], choices));
  assert.ok(intent, "the card's intent passes the message schema");
  const refused = intentRefusal(campaign(), world.sheet(who.id), intent);
  assert.equal(refused, null, `refused: ${refused}`);
  const calls = directCardCalls(intent, who.id, directContextFor(world.campaignId, intent, [], who.id));
  assert.ok(calls, "the engine takes the card whole");
  const results = [];
  for (const call of calls) {
    const result = await run(call.name, call.args);
    results.push({ ...call, result });
    if (drawStopsCast(call.name, result)) break;
  }
  return { intent, calls, results };
}

await test("A fighter holds a wand's spell as a card naming the item and the spell, with its charges and the spell's own numbers", async () => {
  await stage(brute, [wand("Wand of Magic Missiles", { attuned: undefined })]);
  const [card, ...rest] = itemCards(brute);
  assert.equal(rest.length, 0);
  assert.equal(card.name, "Wand of Magic Missiles: Magic Missile");
  assert.equal(card.resource, "Charges 7/7, costs 1");
  assert.equal(card.disabled, null, card.disabled);
  assert.equal(card.target, "enemy");
  assert.equal(card.shares?.count, 3, "darts as a level 1 Magic Missile's are shared out");
  assert.equal(card.cost, "action");
  assert.match(card.rules, /No slot: 1 charge/);
  assert.match(card.rules, /More charges cast it higher/);
});

await test("A staff deals one card per spell, each asking its own target and area, at the item's numbers", async () => {
  await stage(mage, [wand("Staff of Fire")]);
  const cards = itemCards(mage);
  assert.deepEqual(cards.map((card) => card.name), ["Staff of Fire: Burning Hands", "Staff of Fire: Fireball", "Staff of Fire: Wall of Fire"]);
  assert.equal(new Set(cards.map((card) => card.id)).size, 3);
  assert.deepEqual(cards.map((card) => card.area?.pick), ["direction", "point", "wall"]);
  assert.deepEqual(cards.map((card) => card.resource), ["Charges 10/10, costs 1", "Charges 10/10, costs 3", "Charges 10/10, costs 4"]);
  // Its own DC 15 on a wand; the wielder's on a staff, which says so.
  const dc = 8 + 4 + 4;
  assert.equal(cards[1].save.dc, dc, "the staff uses the wielder's spell save DC");
  await stage(mage, [wand("Wand of Fireballs")]);
  assert.equal(itemCards(mage)[0].save.dc, 15, "the wand its own");
});

await test("A spell a staff casts at will spends no charge, and its card says so", async () => {
  await stage(mage, [wand("Staff of the Magi")]);
  const light = cardNamed(mage, "Staff of the Magi: Light");
  assert.equal(light.resource, "At will");
  assert.match(light.rules, /at will/);
  assert.equal(itemCards(mage).length, itemSpellsOf("Staff of the Magi").length, "and every spell it casts is dealt");
  const out = await run("use_item", { characterId: mage.id, item: "Staff of the Magi", spell: "Light" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(row(mage, "Staff of the Magi").charges, 50, "no charge was spent");
});

await test("An item that casts as a bonus action costs one, whatever the spell's casting time", async () => {
  await stage(brute, [{ name: "Ring of Jumping", qty: 1, equipped: true, attuned: true }]);
  const jump = cardNamed(brute, "Ring of Jumping: Jump");
  assert.equal(jump.cost, "bonus");
  assert.equal(jump.disabled, null, jump.disabled);
  assert.equal(afterCommit(turnOf(brute), jump).bonusUsed, true);
  assert.equal(afterCommit(turnOf(brute), jump).actionUsed, false);
});

await test("The card greys with the engine's own reason: not attuned, barred from attuning, not worn, not held, no charges, no action, not their turn", async () => {
  await stage(mage, [wand("Staff of Fire", { attuned: false })]);
  assert.match(cardNamed(mage, "Staff of Fire: Fireball").disabled, /works only for someone attuned/);
  await stage(brute, [wand("Wand of Fireballs")]);
  assert.match(cardNamed(brute, "Wand of Fireballs: Fireball").disabled, /can be attuned only by a spellcaster/, "a rest would not help a fighter, and the card does not say it would");
  await stage(brute, [{ name: "Hat of Disguise", qty: 1, equipped: false, attuned: true }, { name: "Longsword", qty: 1, equipped: true }]);
  assert.match(cardNamed(brute, "Hat of Disguise: Disguise Self").disabled, /only while it is worn/);
  const out = await run("use_item", { characterId: brute.id, item: "Hat of Disguise" });
  assert.match(out.error, /only while it is worn/, "and use_item says the same");
  await stage(brute, [{ name: "Luck Blade (Longsword)", qty: 1, equipped: false, attuned: true, charges: 2 }, { name: "Dagger", qty: 1, equipped: true }]);
  assert.match(cardNamed(brute, "Luck Blade (Longsword): Wish").disabled, /only while it is held/);
  await stage(mage, [wand("Wand of Web", { charges: 0 })]);
  const empty = cardNamed(mage, "Wand of Web: Web");
  assert.match(empty.disabled, /has 0 charges left and this use needs 1/);
  assert.equal(empty.spent, true, "ran out: it dims rather than greys");
  assert.equal(empty.resource, "Charges 0/7, costs 1");
  await stage(mage, [wand("Wand of Web")]);
  assert.match(cardNamed(mage, "Wand of Web: Web", { ...turnOf(mage), actionUsed: true }).disabled, /action/);
  assert.equal(cardNamed(mage, "Wand of Web: Web", { ...turnOf(mage), actionUsed: true }).spent, true);
  const offTurn = { ...turnOf(mage), myTurn: false, currentName: "Goblin", table: { round: 1, orderReady: true, acting: { id: "", name: "Goblin" }, surprised: { acting: [], reacting: [] } } };
  assert.match(cardNamed(mage, "Wand of Web: Web", offTurn).disabled, /Goblin|turn/);
});

await test("A fighter with an item that casts with its user's own numbers greys rather than paying for a cast the spell's tool refuses", async () => {
  await stage(brute, [wand("Ring of Shooting Stars", { equipped: true })]);
  assert.match(cardNamed(brute, "Ring of Shooting Stars: Faerie Fire").disabled, /its user's own spell numbers, and Brute has none/);
  assert.equal(cardNamed(brute, "Ring of Shooting Stars: Light").disabled, null, "a spell with no numbers to read is open");
});

await test("Two lines under one name grey with the engine's reason, as use_item will not guess", async () => {
  await stage(mage, [wand("Wand of Web", { charges: 2 }), wand("Wand of Web", { charges: 5 })]);
  const cards = itemCards(mage).filter((card) => card.name === "Wand of Web: Web");
  assert.ok(cards.every((card) => /could mean Wand of Web or Wand of Web/.test(card.disabled)));
});

await test("The route refuses what the card would grey, in the same words, and writes nothing", async () => {
  const enemy = await stage(mage, [wand("Wand of Web", { charges: 0 })]);
  const intent = { card: "spell", spell: "Web", slotLevel: 2, item: "Wand of Web", targetId: enemy.id, targetKind: "enemy" };
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), intent), /has 0 charges left/);
  world.patch(mage.id, { equipment: [wand("Wand of Web", { attuned: false })] });
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), intent), /works only for someone attuned/);
  world.patch(mage.id, { equipment: [wand("Wand of Web")] });
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), { ...intent, spell: "Fireball" }), /casts Web/);
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), { ...intent, item: "Longsword" }), /holds no spell/);
  assert.equal(intentRefusal(campaign(), world.sheet(mage.id), intent), null);
  assert.equal(row(mage, "Wand of Web").charges, undefined, "asking spends nothing");
  assert.equal(usedAction(), false, "nor the action");
  assert.equal(takeItemCast(mage.id, "Web", { dryRun: true }), null, "and leaves no credit");
});

await test("A dry run of a wand rolls nothing and writes nothing", async () => {
  await stage(mage, [wand("Necklace of Fireballs")]);
  const before = world.encounter();
  // Its 1d6 + 3 beads are rolled as it is granted (item-charge-rules.ts
  // withStartingCharges), so the sheet and the Hand know the count; asking
  // neither rolls it again nor spends one.
  const count = world.sheet(mage.id).equipment[0].charges;
  assert.equal(typeof count, "number", "the count was rolled as the necklace was granted");
  const asked = chargedItemUse(campaign(), "", world.sheet(mage.id), "Necklace of Fireballs", undefined, "Fireball", { dryRun: true });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  assert.equal(world.sheet(mage.id).equipment[0].charges, count, "asking rolls nothing and spends nothing");
  assert.deepEqual(world.encounter().budget, before.budget);
});

await test("Played, the wand spends its charge once and its action, the spell's tool casts it with no slot at the item's numbers, and the count on the card falls", async () => {
  await stage(mage, [wand("Wand of Fireballs"), { name: "Dagger", qty: 1 }]);
  const card = cardNamed(mage, "Wand of Fireballs: Fireball");
  const { calls, results } = await play(mage, card, null, { area: { at: { x: 6, y: 6 } } });
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "aoe_damage"]);
  assert.deepEqual(calls[0].args, { characterId: mage.id, item: "Wand of Fireballs", spell: "Fireball" });
  for (const { name, result } of results) assert.notEqual(result.ok, false, `${name}: ${JSON.stringify(result)}`);
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 0, "no slot spent");
  assert.equal(row(mage, "Wand of Fireballs").charges, 6, "one charge");
  assert.equal(cardNamed(mage, "Wand of Fireballs: Fireball").resource, "Charges 6/7, costs 1");
  assert.equal(takeItemCast(mage.id, "Fireball", { dryRun: true }), null, "the credit went with the cast");
});

await test("A second card of the same wand this turn wants its own action: no action is left over from the first", async () => {
  await stage(mage, [wand("Wand of Web")]);
  await play(mage, cardNamed(mage, "Wand of Web: Web"), null, { area: { at: { x: 6, y: 6 } } });
  const again = cardNamed(mage, "Wand of Web: Web");
  assert.match(again.disabled ?? "", /action/, "the mark is for a cast that did not happen, not one that did");
});

await test("A wizard's own Fireball stays apart from the staff's: both are dealt, and which pays is theirs to choose", async () => {
  await stage(mage, [wand("Staff of Fire")]);
  const fireballs = handOf(mage).filter((card) => card.intent.spell === "Fireball");
  assert.equal(fireballs.length, 2);
  assert.notEqual(fireballs[0].id, fireballs[1].id);
  assert.equal(fireballs.filter((card) => card.intent.item).length, 1);
});

await test("A healing spell asks who, and a staff's level is the card's", async () => {
  // A wizard cannot attune to this one; a sheet that says otherwise is put right on write.
  await stage(mage, [wand("Staff of Healing")]);
  assert.match(cardNamed(mage, "Staff of Healing: Cure Wounds").disabled, /can be attuned only by/);
  await stage(mage, [wand("Orb of Dragonkind")]);
  const cure = cardNamed(mage, "Orb of Dragonkind: Cure Wounds");
  assert.equal(cure.target, "ally");
  world.patch(mage.id, { currentHp: 1 });
  const { calls, results } = await play(mage, cure, { id: mage.id, name: "Mage", kind: "self" });
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "heal"]);
  assert.equal(calls[1].args.level, 5);
  assert.notEqual(results[1].result.ok, false, JSON.stringify(results[1].result));
  assert.ok(world.sheet(mage.id).currentHp > 5, "1 + 5d8 + 4");
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 0);
});

await test("A summoning from an item asks its creature, and with none waits for the GM rather than spending the charge on nothing", async () => {
  await stage(brute, [{ name: "Bowl of Commanding Water Elementals", qty: 1 }]);
  const intent = { card: "spell", spell: "Conjure Elemental", slotLevel: 5, item: "Bowl of Commanding Water Elementals" };
  const context = directContextFor(world.campaignId, intent, [], brute.id);
  assert.equal(context.long, undefined, "an item casts at once: nothing is begun");
  assert.equal(directCardCalls(intent, brute.id, context), null);
  const calls = directCardCalls({ ...intent, variant: "Water Elemental" }, brute.id, context);
  assert.deepEqual(calls.map((call) => call.name), ["use_item", "cast_buff"]);
});

await test("An item whose text destroys it says so, and its card goes with it", async () => {
  await stage(brute, [{ name: "Elemental Gem (Blue Sapphire)", qty: 1 }]);
  const gem = itemCards(brute)[0];
  assert.equal(gem.resource, "One use");
  assert.match(gem.rules, /using it destroys it/);
  const out = await run("use_item", { characterId: brute.id, item: "Elemental Gem (Blue Sapphire)", spell: "Conjure Elemental" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(itemCards(brute), []);
});

await test("An item with a check before the cast says so, and when the check fails nothing else runs, however the wizard is prepared", async () => {
  await stage(mage, [{ name: "Amulet of the Planes", qty: 1, attuned: true, equipped: true }]);
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, slots: { 7: { max: 1, used: 0 } }, prepared: ["Plane Shift"], spellbook: ["Plane Shift"] }, abilities: { ...world.sheet(mage.id).abilities, int: 1 } });
  const card = itemCards(mage)[0];
  assert.match(card.rules, /A DC 15 Intelligence check first/);
  world.dice(1);
  const { results } = await play(mage, card, { id: world.enemies()[0].id, name: "Goblin", kind: "enemy" });
  world.clearDice();
  assert.equal(results.length, 1, "no spell's tool after a failed check");
  assert.equal(results[0].result.spellCast, false);
  assert.equal(world.sheet(mage.id).spellcasting.slots["7"].used, 0, "and no slot of their own paid for it");
  const played = { intent: parseMessageIntent(intentBody(card, null)), characterId: mage.id, name: "Mage", resolution: "utility" };
  assert.deepEqual(unresolvedCards([played], results.map(({ name, args, result }) => ({ name, args, result }))), [], "the card is answered: the engine said what happened");
});

await test("A scroll is a card: it names the spell, reads with the scroll's numbers, is used up, and takes its card with it", async () => {
  await stage(mage, [scroll("Magic Missile", { qty: 2 }), scroll("Web")]);
  const missile = cardNamed(mage, "Scroll: Magic Missile");
  assert.equal(missile.resource, "Scroll ×2");
  assert.match(missile.rules, /No slot: the scroll is used up/);
  assert.equal(missile.disabled, null, missile.disabled);
  const web = cardNamed(mage, "Scroll: Web");
  assert.equal(web.resource, "Scroll, one use");
  assert.equal(web.save.dc, 13, "SRD 5.1, Spell Scroll: a level 2 spell's DC");
  const enemy = world.enemies()[0];
  const { results } = await play(mage, missile, aimAt(enemy), { shares: [{ id: enemy.id, name: enemy.displayName, count: 3 }] });
  for (const { name, result } of results) assert.equal(result.error, undefined, `${name}: ${JSON.stringify(result)}`);
  assert.equal(row(mage, "Spell Scroll (Magic Missile)").qty, 1);
  assert.equal(cardNamed(mage, "Scroll: Magic Missile").resource, "Scroll, one use");
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 0);
  world.patch(mage.id, { equipment: [scroll("Magic Missile")] });
  kit.giveTurn(mage.id);
  const { results: last } = await play(mage, cardNamed(mage, "Scroll: Magic Missile"), aimAt(enemy), { shares: [{ id: enemy.id, name: enemy.displayName, count: 3 }] });
  assert.equal(last[1].result.error, undefined, JSON.stringify(last[1].result));
  assert.deepEqual(itemCards(mage), [], "the last of it takes its card");
});

await test("A scroll the reader cannot read greys with the reason use_item gives, and a fighter is dealt it all the same", async () => {
  await stage(brute, [scroll("Magic Missile")]);
  const card = cardNamed(brute, "Scroll: Magic Missile");
  assert.match(card.disabled, /not on Brute's class spell list, so the scroll is unintelligible/);
  const intent = parseMessageIntent(intentBody({ ...card, disabled: null }, null));
  assert.match(intentRefusal(campaign(), world.sheet(brute.id), intent), /unintelligible/);
  const typed = await run("use_item", { characterId: brute.id, item: "Spell Scroll (Magic Missile)" });
  assert.match(typed.error, /unintelligible/);
});

await test("A scroll above what they can cast says what the reading risks; a failed reading loses it, and casts nothing from their own slots", async () => {
  await stage(mage, [scroll("Disintegrate")]);
  world.patch(mage.id, { abilities: { ...world.sheet(mage.id).abilities, int: 1 }, spellcasting: { ...world.sheet(mage.id).spellcasting, prepared: ["Disintegrate"], spellbook: ["Disintegrate"] } });
  const card = cardNamed(mage, "Scroll: Disintegrate");
  assert.match(card.rules, /A DC 16 Intelligence check first: a failure loses the scroll/);
  world.dice(1);
  const out = await run("use_item", { characterId: mage.id, item: "Spell Scroll (Disintegrate)", spell: "Disintegrate" });
  world.clearDice();
  assert.equal(out.spellCast, false);
  assert.ok(drawStopsCast("use_item", out), "no spell's tool follows");
  assert.deepEqual(itemCards(mage), [], "the scroll is gone");
  assert.equal(takeItemCast(mage.id, "Disintegrate", { dryRun: true }), null);
});

await test("Two scrolls under one name deal the one the engine reads, and a card for the other spell is refused", async () => {
  await stage(mage, [{ ...scroll("Fireball"), name: "Pergamena" }, { ...scroll("Magic Missile"), name: "Pergamena" }]);
  assert.deepEqual(itemCards(mage).map((card) => card.name), ["Scroll: Fireball"]);
  const intent = { card: "spell", spell: "Magic Missile", slotLevel: 1, item: "Pergamena" };
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), intent), /holds Fireball, not Magic Missile/);
});

await test("A cast the spell's tool refuses gives the charge back: a table a person runs keeps the card waiting, and resolving it again charges once and asks no second action", async () => {
  const live = await stage(mage, [wand("Wand of Binding")]);
  const post = (targetId) =>
    insertCampaignMessage({
      campaignId: world.campaignId,
      seq: allocateSeq(world.campaignId),
      authorType: "player",
      userId: world.owner.id,
      characterId: mage.id,
      content: "I cast Hold Person from my Wand of Binding.",
      intent: { card: "spell", spell: "Hold Person", slotLevel: 2, item: "Wand of Binding", targetId, targetKind: "enemy" },
    });
  const lost = post("nobody-at-all");
  const refused = await resolveAsPlayed(campaign(), world.owner.id, lost.id);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(getCampaignMessage(lost.id).cardResolvedAt ?? null, null, "nothing was cast, so the card is still the GM's to resolve");
  assert.equal(row(mage, "Wand of Binding").charges, 7, "the two charges came back");
  assert.equal(takeItemCast(mage.id, "Hold Person", { dryRun: true }), null, "and the credit went, so nothing pays for a later cast");
  const turn = turnOf(mage);
  assert.ok(turn.marks?.includes(spellDrawnMark("Hold Person")), "the action stays on this spell");
  assert.equal(turn.actionUsed, true);
  assert.equal(cardNamed(mage, "Wand of Binding: Hold Person").disabled, null, "so its card stands open");
  assert.match(cardNamed(mage, "Wand of Binding: Hold Monster").disabled, /action/, "and another does not");
  const right = post(live.id);
  const resolved = await resolveAsPlayed(campaign(), world.owner.id, right.id);
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.equal(row(mage, "Wand of Binding").charges, 5, "charged once in all");
  assert.equal(turnOf(mage).marks?.includes(spellDrawnMark("Hold Person")) ?? false, false, "the mark is used up with the cast");
});

await test("A refused scroll comes back to the pack, its card with it, with the action still on the spell", async () => {
  await stage(mage, [scroll("Magic Missile")]);
  const message = insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType: "player",
    userId: world.owner.id,
    characterId: mage.id,
    content: "I cast Magic Missile from my scroll.",
    intent: { card: "spell", spell: "Magic Missile", slotLevel: 1, item: "Spell Scroll (Magic Missile)", targetId: "nobody-at-all", targetKind: "enemy" },
  });
  const refused = await resolveAsPlayed(campaign(), world.owner.id, message.id);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(row(mage, "Spell Scroll (Magic Missile)").qty, 1, "it came back");
  assert.equal(row(mage, "Spell Scroll (Magic Missile)").spell, "Magic Missile");
  const again = cardNamed(mage, "Scroll: Magic Missile");
  assert.equal(again.disabled, null, again.disabled);
  const enemy = world.enemies()[0];
  const { results } = await play(mage, again, aimAt(enemy), { shares: [{ id: enemy.id, name: enemy.displayName, count: 3 }] });
  for (const { name, result } of results) assert.equal(result.error, undefined, `${name}: ${JSON.stringify(result)}`);
  assert.deepEqual(itemCards(mage), []);
});

await test("A last charge whose die destroyed the wand stays destroyed: the die fell for all to see", async () => {
  await stage(mage, [wand("Wand of Web", { charges: 1 })]);
  world.dice(1);
  const out = await run("use_item", { characterId: mage.id, item: "Wand of Web", spell: "Web" });
  world.clearDice();
  assert.equal(out.destroyed, true, JSON.stringify(out));
  assert.equal(takeBackItemCast(campaign(), mage.id, "Web"), false, "nothing to give back");
  assert.equal(row(mage, "Wand of Web"), undefined);
  dropItemCast(mage.id, "Web");
});

await test("A spell the item's use never reached its tool for, a typed use of the same wand in a new turn, still pays: only the turn that paid asks again for free", async () => {
  await stage(mage, [wand("Wand of Web")]);
  const first = await run("use_item", { characterId: mage.id, item: "Wand of Web", spell: "Web" });
  assert.equal(first.ok, true);
  const sheet = world.sheet(mage.id);
  assert.equal(paidItemCast(sheet, "Wand of Web", "Web", "another-turn"), null);
  const { turnId } = takeItemCast(mage.id, "Web", { dryRun: true });
  const again = paidItemCast(sheet, "Wand of Web", "Web", turnId);
  assert.equal(again.ok, true, "the correction calling use_item again within the turn");
  assert.match(again.note, /paid for already/);
  assert.equal(row(mage, "Wand of Web").charges, 6);
  dropItemCast(mage.id, "Web");
});

await test("At an AI table a refused cast is settled with the turn: the charge comes back, the correction charges nothing more, and the card goes back", async () => {
  await stage(mage, [wand("Wand of Binding")]);
  const intent = { card: "spell", spell: "Hold Person", slotLevel: 2, item: "Wand of Binding", targetId: "nobody-at-all", targetKind: "enemy", targetName: "Nobody" };
  model.script([reply({ text: "The moment passes." }), reply({ text: "The moment passes." }), reply({ text: "The moment passes." })]);
  await model.turn(world, "I cast Hold Person from my Wand of Binding at Nobody.", mage.id, mage.userId, { intent });
  assert.equal(row(mage, "Wand of Binding").charges, 7, "both charges back");
  assert.equal(takeItemCast(mage.id, "Hold Person", { dryRun: true }), null);
  assert.ok(turnOf(mage).marks?.includes(spellDrawnMark("Hold Person")), "the action stays on the spell");
});

await test("An item the engine cannot carry out has no card: charges that do something other than cast a spell", async () => {
  await stage(mage, [wand("Wand of Paralysis"), wand("Wand of Wonder"), { name: "Javelin of Lightning", qty: 1 }, { name: "Cube of Force", qty: 1, attuned: true }]);
  assert.deepEqual(itemCards(mage), []);
});

await test("A mystery item deals nothing until it is named, and a scroll with no spell is no card", async () => {
  await stage(mage, [wand("Wand of Web", { identified: false }), { ...scroll("Web"), identified: false }, { name: "Scroll of Magic Missile", qty: 1, tags: SCROLL_TAGS }]);
  assert.deepEqual(itemCards(mage), []);
  assert.deepEqual(itemSpellNames(world.sheet(mage.id)), []);
});

await test("Each item is a section of Items with what it has left, and one card sits under both Spells and Items", async () => {
  const gear = [{ name: "Longsword", qty: 1, equipped: true }];
  const equipment = [...gear, wand("Staff of Fire", { charges: 6 }), wand("Wand of Web", { charges: 3 }), scroll("Magic Missile"), scroll("Web")];
  await stage(mage, equipment);
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, prepared: ["Fireball", "Sleep", "Shield", "Mage Armor"], spellbook: ["Fireball", "Sleep", "Shield", "Mage Armor"] } });
  const { units, groups } = groupHand(handOf(mage), world.sheet(mage.id));
  const items = groups.find((group) => group.key === "items");
  assert.deepEqual(items.sections.map((section) => [section.label, section.note, section.cards.length]), [
    ["Staff of Fire", "6 of 10 charges", 3],
    ["Wand of Web", "3 of 7 charges", 1],
    ["Scrolls", "", 2],
    ["Gear", "", items.cards.filter((card) => !card.fromItem).length],
  ]);
  const spells = groups.find((group) => group.key === "spells");
  const inSpells = spells.cards.find((card) => card.name === "Staff of Fire: Fireball");
  const inItems = items.cards.find((card) => card.name === "Staff of Fire: Fireball");
  assert.equal(inSpells, inItems, "one card, not two copies");
  assert.deepEqual(groupKeysOf(inSpells), ["spells", "items"]);
  assert.equal(units.filter((unit) => !isGroup(unit) && unit.fromItem).length, 0, "and not loose in the fan as well");
});

await test("With nothing cast from an item, Items is the one list it always was", async () => {
  await stage(brute, [{ name: "Longsword", qty: 1, equipped: true }, { name: "Dagger", qty: 1 }, { name: "Shield", qty: 1 }, { name: "Potion of Healing", qty: 1 }]);
  const { groups } = groupHand(handOf(brute), world.sheet(brute.id));
  const items = groups.find((group) => group.key === "items");
  assert.deepEqual(items.sections.map((section) => section.id), ["all"]);
});

await test("The sentence and the model's line say which item, with use_item first", async () => {
  const enemy = await stage(mage, [wand("Wand of Binding")]);
  const card = cardNamed(mage, "Wand of Binding: Hold Person");
  assert.equal(composeSentence(card, aimAt(enemy)), `I cast Hold Person from my Wand of Binding at ${enemy.displayName}.`);
  const line = describeIntent(parseMessageIntent(intentBody(card, aimAt(enemy))), mage.id);
  assert.match(line, /Hold Person out of Wand of Binding, at level 2 with no slot/);
  assert.match(line, /Resolve it with use_item with item=Wand of Binding and spell=Hold Person, then the spell's tool/);
  await stage(mage, [wand("Staff of the Magi")]);
  const light = describeIntent(parseMessageIntent(intentBody(cardNamed(mage, "Staff of the Magi: Light"), null)), mage.id);
  assert.match(light, /Light out of Staff of the Magi with no slot/, "a cantrip names no level");
  assert.deepEqual(afterCommit(turnOf(mage), cardNamed(mage, "Staff of the Magi: Light")).marks ?? [], [], "and leaves no spell-rule mark, as use_item does");
});

await test("A spell of a minute or more from an item is held across turns in a fight, as a ring's is, and spends the item only when done", async () => {
  if (!hasPack) return;
  const { finishCastingsAtFightEnd } = await import("../src/lib/dm/long-casting.ts");
  await stage(mage, [wand("Staff of the Magi")]);
  const intent = { card: "spell", spell: "Conjure Elemental", slotLevel: 5, item: "Staff of the Magi", variant: "Fire Elemental" };
  assert.equal(directContextFor(world.campaignId, intent, [], mage.id).ringBegins, true, "SRD 5.1: the spell uses its normal casting time");
  const card = cardNamed(mage, "Staff of the Magi: Conjure Elemental");
  assert.match(card.rules, /takes turns to cast/);
  const begun = await run("use_item", { characterId: mage.id, item: "Staff of the Magi", spell: "Conjure Elemental" });
  assert.match(String(begun.casting), /10 rounds/, JSON.stringify(begun));
  assert.equal(row(mage, "Staff of the Magi").charges, undefined, "nothing of the staff is spent while it is cast");
  assert.equal(usedAction(), true);
  assert.match(cardNamed(mage, "Staff of the Magi: Conjure Elemental").disabled, /is casting Conjure Elemental/);
  finishCastingsAtFightEnd(campaign());
  assert.equal(row(mage, "Staff of the Magi").charges, 43, "seven charges, spent as it takes effect");
  const done = cardNamed(mage, "Staff of the Magi: Conjure Elemental");
  assert.equal(done.cost, "free", "and the card that resolves it is free");
  const again = await run("use_item", { characterId: mage.id, item: "Staff of the Magi", spell: "Conjure Elemental" });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(row(mage, "Staff of the Magi").charges, 43, "resolving it charges nothing more");
  dropItemCast(mage.id, "Conjure Elemental");
  world.patch(mage.id, { conditions: [], conditionMeta: {} });
  await stage(brute, [{ name: "Bowl of Commanding Water Elementals", qty: 1 }]);
  const bowl = { card: "spell", spell: "Conjure Elemental", slotLevel: 5, item: "Bowl of Commanding Water Elementals" };
  assert.equal(directContextFor(world.campaignId, bowl, [], brute.id).ringBegins, undefined, "a bowl's text makes it an action");
});

await test("They take no Ready pick and are no first-turn tip; the lookups read an item's spells for its card alone", async () => {
  await stage(mage, [wand("Wand of Web")]);
  const sheet = world.sheet(mage.id);
  const ready = handOf(mage).find((entry) => entry.id === "basic:ready");
  assert.ok(!ready.choice.options.some((option) => option.value === "Web"));
  assert.ok(!threeThingsToTry(sheet).some((tip) => /Web/.test(JSON.stringify(tip))));
  assert.ok(!spellsToLookUp(sheet).includes("Web"));
  assert.ok(handSpellsToLookUp(sheet).includes("Web"));
});

await test("Every item the table says casts a spell deals its cards with no two alike, and asks use_item first of whatever it resolves", async () => {
  const names = ["Wand of Fear", "Wand of Magic Detection", "Staff of Frost", "Staff of Charming", "Staff of Swarming Insects", "Staff of Power", "Eyes of Charming", "Medallion of Thoughts", "Helm of Teleportation", "Cubic Gate", "Necklace of Prayer Beads (Blessing, Curing, Favor, Smiting, Summons, Wind Walking)", "Robe of Stars", "Cape of the Mountebank", "Rod of Alertness", "Boots of Levitation", "Helm of Comprehending Languages", "Ring of Telekinesis", "Crystal Ball of Telepathy", "Circlet of Blasting", "Cloak of Arachnida", "Wind Fan", "Trident of Fish Command", "Ring of Fire Elemental Command"];
  await stage(mage, []);
  for (const name of names) {
    world.patch(mage.id, { equipment: [wand(name, { equipped: true })] });
    const cards = itemCards(mage);
    assert.equal(cards.length, itemSpellsOf(name).length, name);
    assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, name);
    for (const card of cards) {
      const intent = parseMessageIntent(intentBody(card, null));
      assert.equal(intent.item, name);
      const calls = directCardCalls(intent, mage.id, directContextFor(world.campaignId, intent, [], mage.id));
      if (calls) assert.equal(calls[0].name, "use_item", `${card.name}: ${calls[0].name}`);
    }
  }
});

await test("A draw that casts nothing is no answer to the card, and a refused one is", async () => {
  await stage(mage, [wand("Wand of Web")]);
  const card = cardNamed(mage, "Wand of Web: Web");
  const played = { intent: parseMessageIntent(intentBody(card, null)), characterId: mage.id, name: "Mage", resolution: "save" };
  const draw = { name: "use_item", args: { characterId: mage.id, item: "Wand of Web", spell: "Web" } };
  assert.equal(intentAnswered(played, [{ ...draw, result: { ok: true, spellCast: "Web" } }]), false);
  assert.equal(intentAnswered(played, [{ ...draw, result: { ok: true, spellCast: false } }]), true);
  assert.equal(intentAnswered(played, [{ ...draw, result: { error: "no", refused: "rules" } }]), true);
  assert.deepEqual(drawStopsCast("cast_at_enemy", { error: "no", refused: "rules" }), null);
  assert.deepEqual(drawStopsCast("use_item", { error: "no", retry: true }), { error: "no", retry: true });
});


await test("A Trident of Fish Command casts while carried, as its text says, not only in hand", async () => {
  await stage(mage, [{ name: "Trident of Fish Command", qty: 1, equipped: false, attuned: true }, { name: "Dagger", qty: 1, equipped: true }]);
  const card = cardNamed(mage, "Trident of Fish Command: Dominate Beast");
  assert.equal(card.disabled, null, card.disabled);
  const out = await run("use_item", { characterId: mage.id, item: "Trident of Fish Command", spell: "Dominate Beast" });
  assert.equal(out.ok, true, JSON.stringify(out));
  dropItemCast(mage.id, "Dominate Beast");
});

await test("A Necklace of Prayer Beads deals the beads the GM named and no other, each once until dawn", async () => {
  const { rechargeAtDawn } = await import("../src/lib/dm/item-charges.ts");
  const necklace = (name, extra = {}) => ({ name, qty: 1, equipped: true, attuned: true, ...extra });
  await stage(mage, [necklace("Necklace of Prayer Beads")]);
  const asClass = (id) => world.patch(mage.id, { class: id, classes: (world.sheet(mage.id).classes ?? []).map((entry) => ({ ...entry, id })) });
  asClass("cleric");
  assert.deepEqual(itemCards(mage), [], "no bead named: no card lets the player pick one");
  const unnamed = { card: "spell", spell: "Planar Ally", slotLevel: 6, item: "Necklace of Prayer Beads" };
  assert.match(intentRefusal(campaign(), world.sheet(mage.id), unnamed), /GM's to say/, "and an older Hand's card is refused");
  world.patch(mage.id, { equipment: [necklace("Necklace of Prayer Beads (Blessing, Curing)")] });
  assert.deepEqual(itemCards(mage).map((card) => card.name).sort(), ["Necklace of Prayer Beads (Blessing, Curing): Bless", "Necklace of Prayer Beads (Blessing, Curing): Cure Wounds", "Necklace of Prayer Beads (Blessing, Curing): Lesser Restoration"]);
  const ally = await run("use_item", { characterId: mage.id, item: "Necklace of Prayer Beads (Blessing, Curing)", spell: "Planar Ally" });
  assert.match(ally.error ?? "", /not cast Planar Ally|casts Bless/, JSON.stringify(ally));
  const cure = await run("use_item", { characterId: mage.id, item: "Necklace of Prayer Beads (Blessing, Curing)", spell: "Cure Wounds" });
  assert.equal(cure.ok, true, JSON.stringify(cure));
  dropItemCast(mage.id, "Cure Wounds");
  const row1 = world.sheet(mage.id).equipment[0];
  assert.deepEqual(row1.beadsSpent, ["curing"]);
  assert.equal(row1.charges, 1, "two beads named, two charges");
  kit.giveTurn(mage.id);
  const again = await run("use_item", { characterId: mage.id, item: "Necklace of Prayer Beads (Blessing, Curing)", spell: "Lesser Restoration" });
  assert.match(again.error ?? "", /Every bead of curing/, "the one bead of curing is spent, whichever of its spells is asked");
  assert.match(cardNamed(mage, "Necklace of Prayer Beads (Blessing, Curing): Lesser Restoration").disabled, /Every bead of curing/);
  assert.equal(cardNamed(mage, "Necklace of Prayer Beads (Blessing, Curing): Bless").disabled, null);
  rechargeAtDawn(world.campaignId, 0, 2 * 24 * 60);
  assert.equal(world.sheet(mage.id).equipment[0].beadsSpent, undefined, "dawn makes the bead whole");
  asClass("wizard");
});

await test("A Wand of Polymorph's card names no beast, as no Polymorph card does: at a table a person runs, the spell's tool asks for one and the charge comes back", async () => {
  const enemy = await stage(mage, [wand("Wand of Polymorph")]);
  const message = insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType: "player",
    userId: world.owner.id,
    characterId: mage.id,
    content: "I cast Polymorph from my Wand of Polymorph.",
    intent: { card: "spell", spell: "Polymorph", slotLevel: 4, item: "Wand of Polymorph", targetId: enemy.id, targetKind: "enemy" },
  });
  const out = await resolveAsPlayed(campaign(), world.owner.id, message.id);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(row(mage, "Wand of Polymorph").charges, 7, "the charge came back");
  assert.equal(getCampaignMessage(message.id).cardResolvedAt ?? null, null, "and the card waits for the GM, who names the beast");
});

await test("A two-type spell from an item deals both of its types, at the item's numbers and with no slot", async () => {
  if (!hasPack) return;
  const enemy = await stage(mage, [wand("Staff of Frost")]);
  assert.ok(cardNamed(mage, "Staff of Frost: Ice Storm"), "the staff deals Ice Storm");
  const before = world.enemies().find((entry) => entry.id === enemy.id).currentHp;
  // Ice Storm's card with no square picked goes to the GM, from a slot as
  // from an item; the GM resolves it with these calls.
  const drawn = await run("use_item", { characterId: mage.id, item: "Staff of Frost", spell: "Ice Storm" });
  assert.equal(drawn.ok, true, JSON.stringify(drawn));
  const cast = await run("aoe_damage", { casterCharacterId: mage.id, spell: "Ice Storm", enemyIds: [enemy.id] });
  assert.equal(cast.error, undefined, JSON.stringify(cast));
  assert.match(JSON.stringify(cast), /bludgeoning/i);
  assert.match(JSON.stringify(cast), /cold/i);
  assert.ok(world.enemies().find((entry) => entry.id === enemy.id).currentHp < before);
  assert.equal(row(mage, "Staff of Frost").charges, 6, "four charges");
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 0, "no slot");
});

await test("A host that cannot resolve an item's spell says so, and the Hand then deals no item card", async () => {
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  assert.equal(SERVER_FEATURES.handItemCasts, true, "this host offers them");
  await stage(mage, [wand("Wand of Web")]);
  assert.equal(deriveHand(world.sheet(mage.id), turnOf(mage)).filter((card) => card.fromItem).length, 1);
  assert.equal(deriveHand(world.sheet(mage.id), turnOf(mage), { items: false }).filter((card) => card.fromItem).length, 0, "an older host's Hand leaves them typed");
});

// A fresh node process on the same database is the server after a restart: it
// has none of this process's memory.
function afterRestart(source) {
  const alias = path.join(import.meta.dirname, "lib", "register-alias.mjs");
  const script = `import { register } from "node:module"; import { pathToFileURL } from "node:url"; register(pathToFileURL(${JSON.stringify(alias)}).href, import.meta.url);\n${source}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: path.join(import.meta.dirname, ".."), env: process.env, encoding: "utf8" });
  const answer = child.stdout.trim().split("\n").at(-1);
  assert.ok(answer, child.stderr);
  return JSON.parse(answer);
}

await test("A restart between use_item and the spell's tool keeps the credit: the cast spends no slot, and one never cast still gives the charge back", async () => {
  await stage(mage, [wand("Wand of Binding")]);
  const drawn = await run("use_item", { characterId: mage.id, item: "Wand of Binding", spell: "Hold Person" });
  assert.equal(drawn.ok, true, JSON.stringify(drawn));
  assert.equal(row(mage, "Wand of Binding").charges, 5);
  const waiting = afterRestart(`const { takeItemCast } = await import("./src/lib/srd/item-cast-credit.ts"); await import("./src/lib/dm/item-use.ts"); console.log(JSON.stringify(takeItemCast(${JSON.stringify(mage.id)}, "Hold Person", { dryRun: true })));`);
  assert.equal(waiting?.item, "Wand of Binding", "the credit outlives the process that wrote it");
  const given = afterRestart(`const { takeBackItemCast } = await import("./src/lib/dm/item-use.ts"); const { getCampaignById } = await import("./src/lib/db/campaigns.ts"); console.log(JSON.stringify(takeBackItemCast(getCampaignById(${JSON.stringify(world.campaignId)}), ${JSON.stringify(mage.id)}, "Hold Person")));`);
  assert.equal(given, true, "and the settling after the restart finds what to give back");
  assert.equal(row(mage, "Wand of Binding").charges, 7);
  assert.equal(takeItemCast(mage.id, "Hold Person", { dryRun: true }), null);
});

await test("Reverting the turn that drew a wand's spell forgets its credit, and reverting the turn that cast it leaves it waiting again", async () => {
  const { forgetTurnItemCasts } = await import("../src/lib/db/item-cast-credits.ts");
  const { recordItemCast } = await import("../src/lib/srd/item-cast-credit.ts");
  await stage(mage, [wand("Wand of Web")]);
  recordItemCast(mage.id, { spell: "Web", level: 2, item: "Wand of Web", saveDc: 15, paid: { row: wand("Wand of Web"), charges: 1 }, turnId: "turn-drew" });
  forgetTurnItemCasts(world.campaignId, "turn-drew");
  assert.equal(takeItemCast(mage.id, "Web", { dryRun: true }), null, "a cast the revert undid pays for nothing later, and owes nothing back");
  assert.equal(takeBackItemCast(campaign(), mage.id, "Web"), false);
  recordItemCast(mage.id, { spell: "Web", level: 2, item: "Wand of Web", saveDc: 15, turnId: "turn-drew" });
  globalThis.__odmItemCastStore.turn = () => "turn-cast";
  try {
    assert.ok(takeItemCast(mage.id, "Web"), "the spell's tool takes it in a later turn");
  } finally {
    delete globalThis.__odmItemCastStore.turn;
  }
  assert.equal(takeItemCast(mage.id, "Web", { dryRun: true }), null);
  forgetTurnItemCasts(world.campaignId, "turn-cast");
  assert.equal(takeItemCast(mage.id, "Web", { dryRun: true })?.item, "Wand of Web", "the cast undone, the charge it took stays paid for it");
  dropItemCast(mage.id, "Web");
});

model.close();
await finish();
