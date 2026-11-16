// Time outside a fight (rules audit 2026-11-16, lens W): each test pins one
// finding, W01 onward, against SRD 5.1. Spell and item durations across
// rests, travel and waiting, uses that come back at dawn, lights burning
// down, rest lengths, and what is kept across a session.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-audit1116-time");
const world = await openWorld();
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

finish();
