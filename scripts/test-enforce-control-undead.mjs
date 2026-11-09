// Control Undead (Oath of the Oathbreaker, Channel Divinity) spent its use and
// did nothing: "one undead creature you can see within 30 feet of you ... must
// make a Wisdom saving throw. On a failed save, the target must obey your
// commands for the next 24 hours, or until you use this Channel Divinity
// option again. An undead whose challenge rating is equal to or greater than
// your paladin level is immune." Command Undead (School of Necromancy) laid a
// plain charm that left the undead fighting for its old side. Both now hand
// the creature to the one who used them, as a Dominate spell does.
//
// Dice forced; every check reads a sheet, a creature row, a side or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-control-undead");
const world = await openWorld({ campaign: { maxPlayers: 12 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { dominatorOf, dominationOrderOf } = await import("../src/lib/dm/combat-sides-logic.ts");
const { getActiveEncounter } = await import("../src/lib/db/encounters.ts");

const hero = (classId, subclass, level, abilities = {}) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 16, ...abilities }, portrait: { url: "/uploads/test.png" },
  });
const paladin = hero("paladin", "Oathbreaker", 5);
const devotion = hero("paladin", "Oath of Devotion", 5);
const necro = hero("wizard", "School of Necromancy", 14, { int: 16, cha: 10 });
const everyone = [paladin, devotion, necro];

const UNDEAD = { type: "undead", abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 } };
async function stage(who, types = ["undead", "undead"], cr = 0.25) {
  await kit.endFight();
  await kit.fight(2, { heroFaces: Object.fromEntries(everyone.map((entry) => [entry.id, entry.id === who.id ? 19 : 1])) });
  const foes = world.enemies();
  foes.forEach((foe, at) => kit.setEnemy(foe.id, { maxHp: 300, currentHp: 300, cr, stats: { ...foe.stats, ...UNDEAD, type: types[at], cr } }));
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(who.id, 5, 5);
  kit.place(foes[0].id, 5, 6);
  kit.place(foes[1].id, 6, 6);
  kit.giveTurn(who.id);
  for (const entry of everyone) {
    const { resources } = world.sheet(entry.id);
    world.patch(entry.id, {
      conditions: [], conditionMeta: {},
      resources: { ...resources, ...(resources.channel_divinity ? { channel_divinity: { ...resources.channel_divinity, used: 0 } } : {}) },
    });
  }
  return world.enemies();
}
const used = (who) => world.sheet(who.id).resources.channel_divinity.used;
const foe = (id) => world.enemies().find((entry) => entry.id === id);
const side = (id) => sideOf(getActiveEncounter(world.campaignId), "enemy", id);
const channel = async (who, more = {}, faces = []) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant: "control undead", ...more });
  world.clearDice();
  return out;
};

await test("A failed Wisdom save hands the undead to the paladin: it fights on their side, for 24 hours, and the use is spent.", async () => {
  const [zombie] = await stage(paladin);
  assert.equal(side(zombie.id), "foe");
  // WIS 6 (-2): a 2 makes 0 against DC 14 (8 + 3 + Charisma 3).
  const out = await channel(paladin, { targetEnemyId: zombie.id }, [2]);
  assert.equal(out.ok, true, out.error);
  assert.match(JSON.stringify(out.result), /obeys .* for 24 hours/);
  assert.match(JSON.stringify(out.result), /vs DC 14/);
  assert.equal(used(paladin), 1);
  const held = foe(zombie.id);
  assert.ok(held.conditions.includes("charmed"));
  assert.equal(held.conditionMeta.charmed.spell, "Control Undead");
  assert.equal(held.conditionMeta.charmed.source, paladin.id);
  assert.equal(held.conditionMeta.charmed.rounds, 14_400);
  assert.equal(side(zombie.id), "party", "it fights for the paladin now");
});

await test("Using it again lets the last one go: only one undead obeys at a time.", async () => {
  const [zombie, other] = await stage(paladin);
  await channel(paladin, { targetEnemyId: zombie.id }, [2]);
  const { resources } = world.sheet(paladin.id);
  world.patch(paladin.id, { resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
  kit.giveTurn(paladin.id);
  const out = await channel(paladin, { targetEnemyId: other.id }, [2]);
  assert.equal(out.ok, true, out.error);
  assert.match(JSON.stringify(out.result), /no longer obeys/);
  assert.equal(side(zombie.id), "foe", "the first goes back to its own side");
  assert.equal(foe(zombie.id).conditions.includes("charmed"), false);
  assert.equal(side(other.id), "party");
});

await test("A save that succeeds spends the use and changes nothing.", async () => {
  const [zombie] = await stage(paladin);
  const out = await channel(paladin, { targetEnemyId: zombie.id }, [19]);
  assert.equal(out.ok, true, out.error);
  assert.match(JSON.stringify(out.result), /resists/);
  assert.equal(used(paladin), 1);
  assert.equal(side(zombie.id), "foe");
});

await test("Refused with nothing spent: no creature named, not an undead, at or above the paladin's level, beyond 30 feet, unseen.", async () => {
  const [zombie, beast] = await stage(paladin, ["undead", "beast"]);
  const unnamed = await channel(paladin, {});
  assert.notEqual(unnamed.ok, true);
  assert.match(unnamed.error, /targetEnemyId/);
  const living = await channel(paladin, { targetEnemyId: beast.id });
  assert.match(living.error ?? "", /not an undead/);
  kit.setEnemy(zombie.id, { cr: 5, stats: { ...foe(zombie.id).stats, cr: 5 } });
  const mighty = await channel(paladin, { targetEnemyId: zombie.id });
  assert.match(mighty.error ?? "", /immune: its challenge rating \(5\) is not below .*paladin level \(5\)/);
  kit.setEnemy(zombie.id, { cr: 4, stats: { ...foe(zombie.id).stats, cr: 4 } });
  kit.place(zombie.id, 5, 12);
  const far = await channel(paladin, { targetEnemyId: zombie.id });
  assert.match(far.error ?? "", /beyond 30 feet/);
  kit.place(zombie.id, 5, 6);
  kit.setEnemy(zombie.id, { conditions: ["invisible"] });
  const unseen = await channel(paladin, { targetEnemyId: zombie.id });
  assert.match(unseen.error ?? "", /cannot see/);
  assert.equal(used(paladin), 0, "every refusal is free");
  assert.equal(side(zombie.id), "foe");
});

await test("A paladin of another oath does not hold it.", async () => {
  const [zombie] = await stage(devotion);
  const out = await channel(devotion, { targetEnemyId: zombie.id }, [2]);
  assert.match(out.error ?? "", /does not hold Control Undead/);
  assert.equal(used(devotion), 0);
});

await test("The Hand deals Control Undead aimed at a creature, and the card plays with no model.", async () => {
  const [zombie] = await stage(paladin);
  const hand = deriveHand(world.sheet(paladin.id), FRESH_TURN, {}).filter((card) => card.name === "Channel Divinity: Control Undead" || card.name === "Control Undead");
  assert.equal(hand.length, 1, JSON.stringify(deriveHand(world.sheet(paladin.id), FRESH_TURN, {}).map((card) => card.name)));
  assert.equal(hand[0].target, "enemy");
  assert.equal(hand[0].cost, "action");
  const played = directCardCall({ ...hand[0].intent, targetKind: "enemy", targetId: zombie.id }, paladin.id);
  assert.ok(played);
  world.dice(2);
  const out = await world.invoke(played.name, played.args);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(side(zombie.id), "party");
});

await test("A paladin's DC is read with Charisma even when another class's spellcasting leads the sheet.", async () => {
  const [zombie] = await stage(paladin);
  const sheet = world.sheet(paladin.id);
  // As a paladin 5 / wizard sheet whose first caster entry is the wizard's.
  world.patch(paladin.id, { abilities: { ...sheet.abilities, int: 20, cha: 10 }, spellcasting: { ...(sheet.spellcasting ?? {}), ability: "int" } });
  try {
    const out = await channel(paladin, { targetEnemyId: zombie.id }, [10]);
    assert.equal(out.ok, true, out.error);
    assert.match(JSON.stringify(out.result), /vs DC 11/, "8 + 3 + Charisma 0, not Intelligence");
  } finally {
    world.patch(paladin.id, { abilities: sheet.abilities, spellcasting: sheet.spellcasting });
  }
});

// ---- Command Undead (School of Necromancy 14) ----

const command = async (target, faces = []) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: necro.id, resource: "Command Undead", targetEnemyId: target });
  world.clearDice();
  return out;
};

await test("Command Undead takes an undead only; a failed Charisma save hands it to the wizard until they use it again.", async () => {
  const [ghoul, beast] = await stage(necro, ["undead", "beast"]);
  const living = await command(beast.id);
  assert.match(living.error ?? "", /not an undead/);
  // CHA 5 (-3), Intelligence 3: no advantage. A 4 makes 1 against DC 16.
  const out = await command(ghoul.id, [4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(side(ghoul.id), "party");
  assert.equal(foe(ghoul.id).conditionMeta.charmed.spell, "Command Undead");
  assert.equal(foe(ghoul.id).conditionMeta.charmed.rounds, undefined, "no clock: it lasts until used again");
});

await test("An undead of Intelligence 8 or more saves with advantage, and the next use lets the last one go.", async () => {
  const [first, second] = await stage(necro);
  await command(first.id, [4]);
  kit.setEnemy(second.id, { stats: { ...foe(second.id).stats, abilities: { ...UNDEAD.abilities, int: 12 } } });
  kit.giveTurn(necro.id);
  // Two d20s: a 3 and a 4, the higher kept, still a failure.
  const out = await command(second.id, [3, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(side(first.id), "foe", "the first is let go");
  assert.equal(side(second.id), "party");
});

// ---- the charm that commands, among other charms ----

await test("A commanding charm counts among other sources of the same charm, and its order rides it.", () => {
  const meta = { charmed: { spell: "Charm Person", source: "bard", others: [{ spell: "Dominate Monster", source: "wiz", order: "goblin-1" }] } };
  assert.equal(dominatorOf(["charmed"], meta), "wiz");
  assert.equal(dominationOrderOf(["charmed"], meta), "goblin-1");
  assert.equal(dominatorOf(["charmed"], { charmed: { spell: "Charm Person", source: "bard" } }), null);
  assert.equal(dominatorOf(["charmed"], { charmed: { spell: "Control Undead", source: "pal" } }), "pal");
});

finish();
world.close();
