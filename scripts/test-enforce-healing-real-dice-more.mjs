// The healing dice that came with the gap sweep's wave 2 (#916) are the
// roller's own too (issue 902).
//
// test-enforce-healing-real-dice.mjs holds the healing family #914 moved onto
// the door for a character's other dice (src/lib/dm/character-roll.ts
// rollOwnDice). The sweep wrote more healing at the same time, through
// roll-card.ts rollCard, which throws the dice where it stands: a seat on
// physical dice that had been told it rolls its own had them rolled for it.
// Held here:
//   - Hand of Healing and Hand of Ultimate Mercy (Way of Mercy), the
//     Chalice's second healing (Starry Form), and Empowered Healing's dice
//     rolled again (Divine Soul) wait for their roller on physical dice, heal
//     by the faces entered, and spend nothing while they wait;
//   - a healing spell's roll made through the door still leaves Empowered
//     Healing its record of the dice to roll again (ar-ws-empowered-healing.ts
//     noteHealingRoll), on the server's dice and the player's alike;
//   - Lunar Phenomenon's healing, Inspiring Smite's and Restorative Reagents'
//     temporary hit points wait for their roller on physical dice too;
//   - a card answered inside a held call is linked to the roll its own dice
//     made (held-call.ts runHeldAgain), not to an earlier roll of the same
//     character and kind the call threw first: an elixir's effect die, thrown
//     by the server before the drinker's temporary hit points, took the card
//     of the dice the player entered.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-healing-real-dice-more");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { entryDice } = await import("../src/lib/dice.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
const kit = await combatKit(world);

const SLOTS = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } };
const mercy = world.addHero({ name: "Moe", class: "monk", subclass: "Way of Mercy", level: 17, maxHp: 80, abilities: { dex: 16, wis: 16, con: 10 }, proficiencies: TRAINED });
const stars = world.addHero({
  name: "Sela", class: "druid", subclass: "Circle of Stars", level: 6, maxHp: 40, abilities: { wis: 16, con: 10 }, proficiencies: TRAINED,
  spellcasting: { ability: "wis", slots: SLOTS, prepared: ["Cure Wounds"], known: [], cantrips: [] },
});
const soul = world.addHero({
  name: "Ivo", class: "sorcerer", subclass: "Divine Soul", level: 6, maxHp: 40, abilities: { cha: 16, con: 10 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: SLOTS, prepared: [], known: ["Cure Wounds"], cantrips: [] },
});
const ward = world.addHero({ name: "Tam", class: "rogue", level: 3, maxHp: 30, abilities: { dex: 16, con: 10 }, proficiencies: TRAINED });
const other = world.addHero({ name: "Brakk", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16, con: 10 }, proficiencies: TRAINED });
const alchemist = world.addHero({ name: "Ada", class: "artificer", subclass: "Alchemist", level: 9, maxHp: 40, abilities: { int: 16, con: 10 }, proficiencies: TRAINED });
const lunar = world.addHero({ name: "Luna", class: "sorcerer", subclass: "Lunar Sorcery", level: 18, maxHp: 80, abilities: { cha: 16, con: 10 }, proficiencies: TRAINED });
const glory = world.addHero({
  name: "Gale", class: "paladin", subclass: "Oath of Glory", level: 3, maxHp: 40, abilities: { str: 16, cha: 16, con: 10 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  spellcasting: { ability: "cha", slots: { 1: { max: 3, used: 0 } }, prepared: [], known: [], cantrips: [] },
});
const HEROES = [mercy, stars, soul, ward, other, alchemist, lunar, glory];
const BASE = Object.fromEntries(HEROES.map((hero) => [hero.id, world.sheet(hero.id)]));

const pendingOf = (hero) => listOpenPendingRolls(world.campaignId).filter((entry) => entry.userId === hero.userId);
const rollMark = () => new Set(listRecentRolls(world.campaignId, 40).map((roll) => roll.id));
const rollsSince = (mark) => listRecentRolls(world.campaignId, 40).filter((roll) => !mark.has(roll.id));

// Everyone hurt or whole as asked, nobody on physical dice, nothing waiting.
function reset(hurt = [ward]) {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  const low = new Set(hurt.map((hero) => hero.id));
  for (const hero of HEROES) {
    setMemberRealDice(world.campaignId, hero.userId, false);
    const base = BASE[hero.id];
    world.patch(hero.id, {
      currentHp: low.has(hero.id) ? 5 : base.maxHp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null,
      resources: base.resources, spellcasting: base.spellcasting,
    });
  }
  world.clearDice();
}

async function enter(hero, pending, faces) {
  world.signIn({ id: hero.userId });
  assert.equal(entryDice(pending.expression).length, faces.length, `${pending.expression} asks for ${faces.length} dice`);
  const landed = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(landed.status, 200, `the dice were not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
}

function onlyCard(hero) {
  const [pending, ...more] = pendingOf(hero);
  assert.ok(pending, `no roll card went to ${hero.name}'s seat: the server threw the dice`);
  assert.equal(more.length, 0, "one card at a time");
  assert.equal(pending.kind, "custom");
  return pending;
}

await test("Hand of Healing waits for a monk on physical dice and heals by the die entered", async () => {
  reset();
  setMemberRealDice(world.campaignId, mercy.userId, true);
  const mark = rollMark();
  const out = await world.invoke("use_resource", { characterId: mercy.id, resource: "Hand of Healing", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const pending = onlyCard(mercy);
  assert.equal(pending.expression, "1d10+3", "the martial arts die and Wisdom's 3");
  assert.match(pending.detail, /Hand of Healing: healing on Tam/);
  assert.equal(world.sheet(ward.id).currentHp, 5, "healed before the die was in");
  assert.equal(world.sheet(mercy.id).resources.ki.used, 0, "the ki was spent before the die was in");
  assert.equal(rollsSince(mark).length, 0, "the server threw the die");

  await enter(mercy, pending, [6]);
  assert.equal(world.sheet(ward.id).currentHp, 14, "6 and 3");
  assert.equal(world.sheet(mercy.id).resources.ki.used, 1);
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
  assert.equal(rolls[0].characterId, mercy.id, "the roll is the monk's");
  assert.match(rolls[0].detail, /\(physical\)$/);
});

await test("Hand of Ultimate Mercy waits for the monk's 4d10 before any ki is spent", async () => {
  reset([]);
  world.patch(ward.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  setMemberRealDice(world.campaignId, mercy.userId, true);
  const out = await world.invoke("use_resource", { characterId: mercy.id, resource: "Hand of Ultimate Mercy", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const pending = onlyCard(mercy);
  assert.equal(pending.expression, "4d10+3");
  assert.equal(world.sheet(ward.id).deathSaves?.dead, true, "brought back before the dice were in");
  assert.equal(world.sheet(mercy.id).resources.ki.used, 0, "the ki was spent before the dice were in");

  await enter(mercy, pending, [5, 5, 5, 5]);
  assert.equal(world.sheet(ward.id).deathSaves?.dead ?? false, false, "back to life");
  assert.equal(world.sheet(ward.id).currentHp, 23, "four 5s and Wisdom's 3");
  assert.equal(world.sheet(mercy.id).resources.ki.used, 5, "5 ki, once");
});

await test("the Chalice's second healing is the druid's to roll too, after the spell's own", async () => {
  reset([ward, other]);
  world.patch(stars.id, { conditions: ["Starry Form: Chalice"] });
  setMemberRealDice(world.campaignId, stars.userId, true);
  const mark = rollMark();
  const out = await world.invoke("heal", { characterId: ward.id, casterId: stars.id, spell: "Cure Wounds", reason: "starlight on the wound" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const spell = onlyCard(stars);
  assert.match(spell.detail, /Cure Wounds on Tam/);
  await enter(stars, spell, [4]);

  const chalice = onlyCard(stars);
  assert.match(chalice.detail, /Starry Form \(Chalice\): healing on Brakk/);
  assert.equal(chalice.expression, "1d8+3");
  assert.equal(world.sheet(ward.id).currentHp, 5, "nobody is healed until the call can finish");
  assert.equal(world.sheet(stars.id).spellcasting.slots[1].used, 0, "the slot was spent before every die was in");

  await enter(stars, chalice, [2]);
  assert.equal(world.sheet(ward.id).currentHp, 12, "4 on the d8 and Wisdom's 3");
  assert.equal(world.sheet(other.id).currentHp, 10, "2 on the chalice's d8 and Wisdom's 3");
  assert.equal(world.sheet(stars.id).spellcasting.slots[1].used, 1, "one casting, one slot");
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 2, `each roll on record once: ${rolls.map((roll) => `${roll.detail} = ${roll.total}`).join("; ")}`);
  assert.ok(rolls.every((roll) => roll.characterId === stars.id), "the rolls are the druid's");
});

for (const caster of ["the server's dice", "physical dice"]) {
  await test(`a healing spell rolled on ${caster} leaves Empowered Healing its dice to roll again`, async () => {
    reset();
    if (caster === "physical dice") setMemberRealDice(world.campaignId, soul.userId, true);
    world.dice(1);
    const out = await world.invoke("heal", { characterId: ward.id, casterId: soul.id, spell: "Cure Wounds", reason: "a hand on the wound" });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    if (caster === "physical dice") {
      assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
      await enter(soul, onlyCard(soul), [1]);
    }
    assert.equal(world.sheet(ward.id).currentHp, 9, "1 on the d8 and Charisma's 3");
    setMemberRealDice(world.campaignId, soul.userId, false);
    world.clearDice();
    world.dice(8);
    const again = await world.invoke("use_resource", { characterId: soul.id, resource: "Empowered Healing" });
    assert.equal(again.ok, true, `the healing roll was not on record to roll again: ${again.error}`);
    assert.equal(world.sheet(ward.id).currentHp, 16, `the 1 rolled again as an 8: ${JSON.stringify(again.result).slice(0, 300)}`);
  });
}

await test("Empowered Healing's dice rolled again wait for the sorcerer on physical dice", async () => {
  reset();
  world.dice(1);
  const cast = await world.invoke("heal", { characterId: ward.id, casterId: soul.id, spell: "Cure Wounds", reason: "a hand on the wound" });
  assert.equal(cast.ok, true, `refused: ${cast.error}`);
  setMemberRealDice(world.campaignId, soul.userId, true);
  const out = await world.invoke("use_resource", { characterId: soul.id, resource: "Empowered Healing" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const pending = onlyCard(soul);
  assert.equal(pending.expression, "1d8");
  assert.equal(world.sheet(soul.id).resources.sorcery_points.used, 0, "the point was spent before the die was in");

  await enter(soul, pending, [7]);
  assert.equal(world.sheet(ward.id).currentHp, 15, "the 1 rolled again as the 7 entered");
  assert.equal(world.sheet(soul.id).resources.sorcery_points.used, 1);
});

await test("Restorative Reagents' temporary hit points wait for the artificer, and the card is linked to the roll its dice made", async () => {
  reset();
  setMemberRealDice(world.campaignId, alchemist.userId, true);
  const mark = rollMark();
  // No elixir named: the server throws its d6 for the effect (a 2 is
  // swiftness) before the drinker's temporary hit points are asked for.
  world.dice(2);
  const out = await world.invoke("use_resource", { characterId: alchemist.id, resource: "Experimental Elixir", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const pending = onlyCard(alchemist);
  assert.match(pending.detail, /Restorative Reagents: temporary hit points on Tam/);
  assert.equal(pending.expression, "2d6+3");
  assert.equal(world.sheet(ward.id).tempHp, 0, "the temporary hit points stood before the dice were in");

  await enter(alchemist, pending, [4, 5]);
  assert.equal(world.sheet(ward.id).tempHp, 12, "4 and 5 on the d6s and Intelligence's 3");
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 2, `the effect die and the temporary hit points, each once: ${rolls.map((roll) => `${roll.detail} = ${roll.total}`).join("; ")}`);
  const linked = getDatabase().prepare("SELECT roll_id FROM pending_rolls WHERE id = ?").get(pending.id)?.roll_id;
  const card = linked ? getRoll(linked) : null;
  assert.match(card?.detail ?? "", /Restorative Reagents/, `the card is linked to another roll of the artificer's: ${card?.detail ?? "none"}`);
  assert.equal(card?.total, 12);
});

await test("Lunar Phenomenon's Full Moon healing waits for the sorcerer on physical dice", async () => {
  reset();
  const phase = await world.invoke("use_resource", { characterId: lunar.id, resource: "Lunar Phase", variant: "Full Moon" });
  assert.ok(phase.ok || /already/.test(phase.error ?? ""), phase.error);
  setMemberRealDice(world.campaignId, lunar.userId, true);
  const out = await world.invoke("use_resource", { characterId: lunar.id, resource: "Lunar Phenomenon", variant: "full moon", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const pending = onlyCard(lunar);
  assert.match(pending.detail, /Lunar Phenomenon: healing on Tam/);
  assert.equal(pending.expression, "3d8");
  assert.equal(world.sheet(ward.id).currentHp, 5, "healed before the dice were in");

  await enter(lunar, pending, [4, 4, 4]);
  assert.equal(world.sheet(ward.id).currentHp, 17, "three 4s");
});

await test("Inspiring Smite's temporary hit points wait for the paladin on physical dice", async () => {
  reset();
  await kit.endFight();
  await kit.fight(1, { heroFaces: Object.fromEntries(world.sheets().map((sheet) => [sheet.id, sheet.id === glory.id ? 19 : 3])) });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(glory.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  kit.place(ward.id, 4, 5);
  kit.giveTurn(glory.id);
  kit.freshRound();
  const smite = await kit.swing(glory.id, enemy.id, [18, 4, 4, 4], { smite: 1 });
  assert.equal(smite.ok, true, `the smite was refused: ${smite.error}`);
  setMemberRealDice(world.campaignId, glory.userId, true);
  const out = await world.invoke("use_resource", { characterId: glory.id, resource: "Channel Divinity", variant: "inspiring smite", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const pending = onlyCard(glory);
  assert.match(pending.detail, /Inspiring Smite: temporary hit points/);
  assert.equal(pending.expression, "2d8+3");
  assert.equal(world.sheet(glory.id).resources.channel_divinity.used, 0, "the use was spent before the dice were in");

  await enter(glory, pending, [5, 5]);
  assert.equal(world.sheet(glory.id).tempHp + world.sheet(ward.id).tempHp, 13, "two 5s and the paladin's level, shared out");
  assert.equal(world.sheet(glory.id).resources.channel_divinity.used, 1);
  await kit.endFight();
});

world.close();
finish();
