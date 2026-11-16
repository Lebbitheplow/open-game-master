// Time outside a fight (rules audit 2026-11-16, lens W): each test pins one
// finding, W01 onward, against SRD 5.1. Spell and item durations across
// rests, travel and waiting, uses that come back at dawn, lights burning
// down, rest lengths, and what is kept across a session.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-audit1116-time");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const { getClock } = await import("../src/lib/db/clock.ts");
const { setLocationLinks, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getTokenByRef, getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");

const now = () => getClock(world.campaignId).instant;
const place = (name, scene) => {
  const at = upsertCurrentLocation({ campaignId: world.campaignId, name });
  setLocationLinks(at.id, { ambience: { bed: scene, music: "" } });
};
const torchesOf = (id) => world.sheet(id).equipment.find((item) => /torch/i.test(item.name));
// A test that failed mid-fight leaves its fight open; the next starts at peace.
const peace = async () => {
  if (world.encounter()) {
    await world.invoke("end_encounter", { outcome: "truce" });
  }
};

await test("W01 a carried torch burns on the game clock on and off the board, a new board carries what is left, and a burnt-out one is used up", async () => {
  // SRD 5.1, Adventuring Gear, Torch: "A torch burns for 1 hour, providing
  // bright light in a 20-foot radius and dim light for an additional 20
  // feet." Lantern: it "burns for 6 hours on a flask (1 pint) of oil".
  place("The Sunken Galleries", "cave");
  const bearer = world.addHero({ class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Torch", qty: 2 }] });
  const first = await world.beginFight([{ monster: "goblin", count: 1 }]);
  const lit = now();
  assert.equal(getTokenByRef(getBattleMapForEncounter(first.id).id, bearer.id).burnsUntil, lit + 60, "the torch was lit as the board was laid");
  await world.invoke("end_encounter", { outcome: "truce" });
  // Half an hour of the cave off the board burns half the torch.
  const waited = await world.invoke("pass_time", { amount: 30, unit: "minutes" });
  assert.equal(waited.ok, true, waited.error);
  const second = await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.equal(getTokenByRef(getBattleMapForEncounter(second.id).id, bearer.id).burnsUntil, lit + 60, "the next board carries the torch as it stands, not a fresh hour");
  await world.invoke("end_encounter", { outcome: "truce" });
  // The hour runs out off the board: that torch is gone, and in the dark the
  // next one is lit as it gutters.
  const later = await world.invoke("pass_time", { amount: 40, unit: "minutes" });
  assert.equal(later.ok, true, later.error);
  assert.equal(torchesOf(bearer.id)?.qty, 1, "the burnt-out torch was used up");
  assert.equal(torchesOf(bearer.id)?.litAt, lit + 60, "the next torch was lit as the first guttered");
});

await test("W01 use_item lights a torch rather than using it up, the daylight puts it out with its burn kept, and a rest lights none new", async () => {
  await peace();
  place("The Lamplit Inn", "tavern");
  const bearer = world.addHero({ class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Torch", qty: 3 }] });
  const used = await world.invoke("use_item", { characterId: bearer.id, item: "Torch" });
  assert.equal(used.ok, true, used.error);
  assert.equal(torchesOf(bearer.id)?.qty, 3, "lighting a torch does not use it up on the spot");
  assert.equal(torchesOf(bearer.id)?.litAt, now());
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  assert.equal(torchesOf(bearer.id)?.litAt, undefined, "put out in a lit room");
  assert.equal(torchesOf(bearer.id)?.qty, 3);
  // Down into the dark: lit again with its hour, then a long rest burns it
  // out and no torch is lit for the sleepers.
  place("The Sunken Galleries", "cave");
  await world.invoke("use_item", { characterId: bearer.id, item: "Torch" });
  const rested = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rested.ok, true, rested.error);
  assert.equal(torchesOf(bearer.id)?.qty, 2, "the lit torch burned out in the night");
  assert.equal(torchesOf(bearer.id)?.litAt, undefined, "nobody lit another while they slept");
});

await test("W02 Pale Tincture cured of its poisoning stops its daily save and lets the healing in", async () => {
  // SRD 5.1, Poisons, Pale Tincture: "A creature subjected to this poison
  // must succeed on a DC 16 Constitution saving throw or take 3 (1d6) poison
  // damage and become poisoned. The poisoned creature must repeat the saving
  // throw every 24 hours, taking 3 (1d6) poison damage on a failed save.
  // Until this poison ends, the damage the poison deals can't be healed by
  // any means." Lesser Restoration: "end either one disease or one condition
  // afflicting it. The condition can be blinded, deafened, paralyzed, or
  // poisoned."
  await peace();
  const victim = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(victim.id, { currentHp: 44 });
  world.clearDice();
  world.dice(5);
  const out = await world.invoke("afflict", { characterId: victim.id, kind: "poison", name: "Pale Tincture", save: false });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(victim.id).currentHp, 39);
  const cured = await world.invoke("clear_condition", { characterId: victim.id, condition: "poisoned", reason: "Lesser Restoration" });
  assert.equal(cured.ok, true, cured.error);
  const healed = await world.invoke("heal", { characterId: victim.id, amount: 10, reason: "cure wounds" });
  assert.equal(healed.ok, true, healed.error);
  assert.equal(world.sheet(victim.id).currentHp, 44, "the poison has ended, so its damage heals");
  world.patch(victim.id, { currentHp: 30 });
  world.diceLog();
  world.dice(1, 6, 1, 6);
  await world.invoke("pass_time", { amount: 25, unit: "hours" });
  const rolled = world.diceLog();
  world.clearDice();
  assert.equal(rolled.filter((die) => die.sides === 20).length, 0, "no daily save for a poison already ended");
  assert.ok(!world.sheet(victim.id).conditions.includes("poisoned"), "and no poisoning back");
});

await test("W03 pass_time sends a night's sleep to take_rest, in the full description and in the compact one small models read", async () => {
  // SRD 5.1, Resting, Long Rest: "a period of extended downtime, at least 8
  // hours long, during which a character sleeps". pass_time moves the clock
  // and rests nobody, so a night at an inn sent to it restored no hit point,
  // slot or hit die. The compact profile keeps only the first sentence,
  // which offered "a night at an inn" and "a week of downtime".
  const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
  const { compactTool } = await import("../src/lib/dm/tool-profiles.ts");
  const tool = dmTurnTools(world.campaign(), false, true, false).find((entry) => entry.function.name === "pass_time");
  assert.ok(tool, "pass_time is offered out of a fight");
  for (const description of [tool.function.description, compactTool(tool).function.description]) {
    assert.doesNotMatch(description, /night at an inn|week of downtime/i, description);
    assert.match(description, /sleep is take_rest/, description);
  }
});

await test("W04 Protection from Poison neutralizes the poison its target holds, ending a day's poisoning", async () => {
  // SRD 5.1, Protection from Poison: "You touch a creature. If it is
  // poisoned, you neutralize the poison. If more than one poison afflicts the
  // target, you neutralize one poison that you know is present, or you
  // neutralize one at random." Assassin's Blood: "poisoned for 24 hours".
  await peace();
  const { cleric } = await import("./lib/enforce-spells.mjs");
  const priest = world.addHero({ name: "Sera", ...cleric(5, { spellcasting: { prepared: ["Protection from Poison"] } }), equipment: [{ name: "Holy Symbol", qty: 1 }] });
  const victim = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.clearDice();
  world.dice(1, 3);
  const poisoned = await world.invoke("afflict", { characterId: victim.id, kind: "poison", name: "Assassin's Blood" });
  world.clearDice();
  assert.equal(poisoned.ok, true, poisoned.error);
  assert.ok(world.sheet(victim.id).conditions.includes("poisoned"), "poisoned for 24 hours");
  const cast = await world.invoke("cast_buff", { characterId: priest.id, spell: "Protection from Poison", targetCharacterIds: [victim.id] });
  assert.equal(cast.ok, true, cast.error);
  const after = world.sheet(victim.id).conditions;
  assert.ok(!after.includes("poisoned"), `the poison is neutralized: ${after.join(", ")}`);
  assert.ok(after.some((name) => /protected from poison/i.test(name)), "and the hour's protection is on");
  // Midnight Tears: "doesn't suffer any effect until the stroke of midnight.
  // If the poison has not been neutralized before then, the creature must
  // succeed on a DC 17 Constitution saving throw".
  const drinker = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(drinker.id, { currentHp: 44 });
  const tears = await world.invoke("afflict", { characterId: drinker.id, kind: "poison", name: "Midnight Tears" });
  assert.equal(tears.ok, true, tears.error);
  const second = await world.invoke("cast_buff", { characterId: priest.id, spell: "Protection from Poison", targetCharacterIds: [drinker.id] });
  assert.equal(second.ok, true, second.error);
  world.diceLog();
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  const rolled = world.diceLog();
  assert.equal(rolled.filter((die) => die.sides === 6).length, 0, "no 9d6 at midnight for a neutralized poison");
  assert.equal(world.sheet(drinker.id).currentHp, 44);
});

await test("W05 a poison that runs its course ends its own poisoning and leaves another poison's alone", async () => {
  // SRD 5.1, Conditions: "If multiple effects impose the same condition on
  // a creature, each instance of the condition has its own duration, and
  // the condition's effects don't get worse." Pale Tincture: "After seven
  // successful saving throws, the effect ends".
  await peace();
  const victim = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(victim.id, { currentHp: 44 });
  world.clearDice();
  world.dice(2);
  const tincture = await world.invoke("afflict", { characterId: victim.id, kind: "poison", name: "Pale Tincture", save: false });
  world.clearDice();
  assert.equal(tincture.ok, true, tincture.error);
  const venom = await world.invoke("set_condition", { characterId: victim.id, condition: "poisoned", days: 10, reason: "a basilisk-gut stew that sours for ten days" });
  assert.equal(venom.ok, true, venom.error);
  world.dice(20, 20, 20, 20, 20, 20, 20);
  const week = await world.invoke("pass_time", { amount: 7, unit: "days" });
  world.clearDice();
  assert.equal(week.ok, true, week.error);
  assert.ok(world.sheet(victim.id).conditions.includes("poisoned"), "the ten days' poisoning outlasts the tincture's");
});

await test("W06 downtime and a pass_time of whole days give a long rest for each day as the days pass, with no more time and no second lifestyle", async () => {
  // SRD 5.1, Resting, Long Rest: "A long rest is a period of extended
  // downtime, at least 8 hours long, during which a character sleeps or
  // performs light activity" and "A character can't benefit from more than
  // one long rest in a 24-hour period, and a character must have at least 1
  // hit point at the start of the rest to gain its benefits." A day of
  // downtime or of waiting is a day the hero sleeps through, so each one
  // gives its night's benefits: a level of exhaustion a night, half the hit
  // dice a night.
  await peace();
  const { listRecentMessages } = await import("../src/lib/db/messages.ts");
  const { dawnsBetween } = await import("../src/lib/dm/item-charges.ts");
  const said = () => listRecentMessages(world.campaignId, 4).map((message) => message.content).join(" ");
  const scholar = world.addHero({ class: "fighter", level: 6, maxHp: 52, hitDice: { die: "d10", total: 6, spent: 6 }, gold: 20 });
  world.patch(scholar.id, { currentHp: 9, exhaustion: 3 });
  const began = now();
  const studied = await world.invoke("downtime", { days: 3, characterId: scholar.id, activity: "research", topic: "the toll-keeper's ledger" });
  assert.equal(studied.ok, true, studied.error);
  assert.equal(now() - began, 3 * 1440, "three days pass, and no rest's eight hours on top");
  const after = world.sheet(scholar.id);
  assert.equal(after.exhaustion, 0, "three nights lift three levels, one a night");
  assert.equal(after.hitDice.spent, 0, "half the hit dice a night: all six back by the second");
  assert.equal(after.currentHp, 52);
  assert.match(said(), /long rest/i, "the chronicle says they rested");

  // Waiting: twenty hours is no whole day; forty-seven hold one night; two
  // days hold two. The lifestyle is paid for the dawns once, as before.
  const waiter = world.addHero({ class: "fighter", level: 4, maxHp: 40, gold: 10 });
  world.patch(waiter.id, { currentHp: 5, exhaustion: 3 });
  const lived = await world.invoke("set_lifestyle", { characterIds: [waiter.id], lifestyle: "modest" });
  assert.equal(lived.ok, true, lived.error);
  const from = now();
  const purse = (id) => world.sheet(id).gold * 100 + (world.sheet(id).copper ?? 0);
  await world.invoke("pass_time", { amount: 20, unit: "hours" });
  assert.equal(world.sheet(waiter.id).currentHp, 5, "twenty hours hold no whole day, so no rest");
  const storm = await world.invoke("pass_time", { amount: 47, unit: "hours", reason: "the snow closes the pass" });
  assert.equal(storm.ok, true, storm.error);
  assert.equal(world.sheet(waiter.id).exhaustion, 2, "forty-seven hours hold one night's rest");
  assert.equal(world.sheet(waiter.id).currentHp, 40);
  assert.match(said(), /long rest/i, "and the chronicle says so");
  await world.invoke("pass_time", { amount: 2, unit: "days" });
  assert.equal(world.sheet(waiter.id).exhaustion, 0, "two more days, two more nights");
  assert.equal(now() - from, (20 + 47 + 48) * 60, "the clock moved only by the time asked");
  assert.equal(purse(waiter.id), 1000 - 100 * dawnsBetween(from, now()), "the modest life paid once for each dawn");

  // A day waited out in the middle of a fight is no rest.
  const guard = world.addHero({ class: "fighter", level: 4, maxHp: 40 });
  world.patch(guard.id, { currentHp: 12 });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(world.sheet(guard.id).currentHp, 12, "no rest in a fight");
  await peace();
});

finish();
