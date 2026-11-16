// GM rules audit 2026-11-16, conditions lens follow-up (D11 and on): the
// leftovers the first pass named, with the lead's rulings. Each test failed
// before its fix.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-conditions2");
const encounters = await import("../src/lib/db/encounters.ts");
const dropped = await import("../src/lib/db/dropped-items.ts");

// A board: dummies (AC 13, 40 hp) and Kara with an attuned Frost Brand and a
// shield.
const field = await openWorld();
const board = await combatKit(field);
const KARA_GEAR = [
  { name: "Frost Brand", qty: 1, equipped: true, attuned: true },
  { name: "Shield", qty: 1, equipped: true },
  { name: "Dagger", qty: 2, equipped: false },
];
const kara = field.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 40, proficiencies: TRAINED, acOverride: false,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: KARA_GEAR,
});
async function stage(count = 1) {
  await board.endFight();
  field.patch(kara.id, { equipment: KARA_GEAR });
  await board.fight(count, { heroFaces: { [kara.id]: 20 } });
  const foes = field.enemies();
  for (const foe of foes) {
    board.setEnemy(foe.id, { stats: { ...DUMMY }, maxHp: 40 });
  }
  board.place(kara.id, 6, 7);
  board.place(foes[0].id, 5, 7);
  return foes;
}
const ground = () => dropped.listDroppedItems(field.campaignId);
const row = (sheet, name) => sheet.equipment.find((item) => item.name === name);

// D11. SRD 5.1, Unconscious: "The creature drops whatever it's holding and
// falls prone." A hero dropped to 0 hit points kept the sword and the shield
// in hand: GAME STATE and the Hand showed them held, the shield still counted
// in the armor class, and nothing lay on the board. The ruling: what is held
// lies in the creature's square, attunement kept; picking it back up is the
// free object interaction; what still lies there when the fight ends goes
// back into its owner's pack.
await test("D11: a hero who falls unconscious drops the sword and the shield in their square, attunement kept", async () => {
  const [foe] = await stage();
  field.patch(kara.id, { currentHp: 3 });
  const ac = field.sheet(kara.id).ac;
  board.enemyTurn(foe.id);
  // The club's d20 and its 1d6.
  field.dice(19, 6);
  const club = await field.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: kara.id });
  field.clearDice();
  assert.equal(club.ok, true, club.error);
  const down = field.sheet(kara.id);
  assert.ok(down.conditions.includes("unconscious"), JSON.stringify(club.result));
  assert.equal(row(down, "Frost Brand"), undefined, `the sword is still on the sheet: ${JSON.stringify(down.equipment)}`);
  assert.equal(row(down, "Shield"), undefined, "the shield is still on the sheet");
  assert.equal(row(down, "Dagger")?.qty, 2, "the packed daggers fell too");
  assert.equal(down.ac, ac - 2, "the shield still counts in the armor class");
  const lying = ground();
  const sword = lying.find((entry) => entry.item.name === "Frost Brand");
  assert.ok(sword, `nothing lies on the board: ${JSON.stringify(lying)}`);
  assert.deepEqual([sword.x, sword.y], [6, 7], "the sword is not in Kara's square");
  assert.equal(sword.item.attuned, true, "the sword on the ground lost its attunement");
  assert.equal(sword.item.equipped, undefined);
  assert.ok(lying.some((entry) => entry.item.name === "Shield"), "the shield is not on the ground");
});

await test("D11: the hero picks the sword back up with the free object interaction, still attuned", async () => {
  // Woken by healing on the same board.
  const healed = await field.invoke("heal", { characterId: kara.id, amount: 5 });
  assert.equal(healed.ok, true, healed.error);
  board.giveTurn(kara.id);
  const pick = await field.invoke("handle_item", { characterId: kara.id, action: "pick_up", item: "Frost Brand" });
  assert.equal(pick.ok, true, pick.error);
  assert.match(String(pick.result.cost ?? ""), /free object interaction/, JSON.stringify(pick.result));
  const sword = row(field.sheet(kara.id), "Frost Brand");
  assert.ok(sword, "the sword is not back on the sheet");
  assert.equal(sword.equipped, true, "the sword is not in hand");
  assert.equal(sword.attuned, true, "picking it back up cost the attunement");
});

await test("D11: what still lies there when the fight ends goes back into its owner's pack", async () => {
  // The shield was left lying from the last test.
  assert.ok(ground().some((entry) => entry.item.name === "Shield"), "the shield is not lying there");
  const ended = await field.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(ground().length, 0, `still on the ground: ${JSON.stringify(ground())}`);
  const shield = row(field.sheet(kara.id), "Shield");
  assert.ok(shield, "the shield did not go back to Kara");
  assert.equal(shield.equipped, false, "the shield went back on the arm, not into the pack");
});

await test("D11: a hero put to sleep off the board lets go too, and draws the sword again", async () => {
  await board.endFight();
  field.patch(kara.id, { equipment: KARA_GEAR });
  await field.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 20 } });
  // No token on the board: Kara has no square for it to lie in.
  const maps = await import("../src/lib/db/battle-maps.ts");
  for (const token of maps.listTokens(board.map().id)) {
    maps.deleteToken(token.id);
  }
  const slept = await field.invoke("set_condition", { characterId: kara.id, condition: "unconscious", reason: "Sleep", rounds: 10 });
  assert.equal(slept.ok, true, slept.error);
  const asleep = field.sheet(kara.id);
  assert.equal(row(asleep, "Frost Brand")?.equipped, false, `the sleeper still holds the sword: ${JSON.stringify(asleep.equipment)}`);
  assert.equal(row(asleep, "Frost Brand")?.attuned, true);
  assert.equal(ground().length, 0, "a board-less fall left something on a board");
});

// An enemy holds only what the engine knows it took up (handle_item pick_up
// for an enemy): that falls with it as it falls asleep.
await test("D11: a creature that falls asleep drops what it picked up", async () => {
  const [foe] = await stage();
  const theirs = dropped.insertDroppedItem({ campaignId: field.campaignId, mapId: board.map().id, x: 5, y: 7, place: "", item: { name: "Lantern key", qty: 1 }, droppedBy: "", heldByEnemy: foe.id });
  const laid = await field.invoke("set_condition", { enemyId: foe.id, condition: "unconscious", reason: "Sleep", rounds: 10 });
  assert.equal(laid.ok, true, laid.error);
  const key = dropped.getDroppedItem(theirs.id);
  assert.equal(key.heldByEnemy, null, "the sleeping creature still holds the key");
  assert.deepEqual([key.x, key.y], [5, 7]);
  void encounters;
});

// D12. SRD 5.1, Frightened: "The creature can't willingly move closer to the
// source of its fear." Two fears are two instances, each with its own source
// (condition-logic.ts); every walk read the first source only, so a hero
// frightened by two goblins walked straight at the second one.
const sources = (entry) => (entry ? [entry, ...(entry.others ?? [])].map((instance) => instance.source) : []);
async function twoFears() {
  const foes = await stage(2);
  board.place(foes[0].id, 2, 7);
  board.place(foes[1].id, 12, 7);
  board.place(kara.id, 7, 7);
  for (const foe of foes) {
    const scared = await field.invoke("set_condition", { characterId: kara.id, condition: "frightened", reason: "a dreadful howl", rounds: 10, sourceEnemyId: foe.id });
    assert.equal(scared.ok, true, scared.error);
  }
  assert.deepEqual(sources(field.sheet(kara.id).conditionMeta.frightened).sort(), foes.map((foe) => foe.id).sort());
  return foes;
}

await test("D12: a hero frightened by two creatures walks closer to neither", async () => {
  await twoFears();
  board.giveTurn(kara.id);
  // East: away from the first goblin, toward the second. The walk a
  // companion, a typed move and pc_attack's approach all take
  // (token-rules.ts walkCharacter).
  const { walkCharacter } = await import("../src/lib/dm/token-rules.ts");
  const out = walkCharacter(field.campaign(), field.encounter(), board.map(), field.sheet(kara.id), board.token(kara.id), { x: 10, y: 7 });
  const at = board.token(kara.id);
  assert.deepEqual([at.x, at.y], [7, 7], `the frightened hero walked toward the second goblin: ${JSON.stringify(out)}`);
  assert.match(String(out.error ?? ""), /frightened/, JSON.stringify(out));
});

await test("D12: the player's own walk is refused the same", async () => {
  await twoFears();
  board.giveTurn(kara.id);
  field.signIn(field.owner);
  const moveRoute = await field.route("campaigns/[campaignId]/battle-map/move");
  const response = await moveRoute.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 10, y: 7 }) }),
    { params: Promise.resolve({ campaignId: field.campaignId }) },
  );
  assert.equal(response.status, 409, await response.text());
});

await test("D12: a creature frightened by two heroes walks closer to neither", async () => {
  const [foe] = await stage(1);
  const brin = field.sheets().find((sheet) => sheet.name === "Brin") ?? field.addHero({ name: "Brin", class: "fighter", level: 5, maxHp: 40 });
  await board.endFight();
  await board.fight(1, { heroFaces: { [kara.id]: 20, [brin.id]: 19 } });
  const [goblin] = field.enemies();
  void foe;
  board.place(kara.id, 2, 7);
  board.place(brin.id, 12, 7);
  board.place(goblin.id, 7, 7);
  for (const hero of [kara, brin]) {
    const scared = await field.invoke("set_condition", { enemyId: goblin.id, condition: "frightened", reason: "a war cry", rounds: 10, sourceCharacterId: hero.id });
    assert.equal(scared.ok, true, scared.error);
  }
  assert.equal(sources(board.enemy(goblin.id).conditionMeta.frightened).length, 2, JSON.stringify(board.enemy(goblin.id).conditionMeta));
  board.enemyTurn(goblin.id);
  const out = await field.invoke("move_token", { token: goblin.id, x: 10, y: 7 });
  const at = board.token(goblin.id);
  assert.ok(at.x <= 7, `the frightened goblin walked toward Brin to (${at.x},${at.y}): ${JSON.stringify(out)}`);
});

// D13. SRD 5.1, Heal: "This spell also ends blindness, deafness, and any
// diseases affecting the target." Mass Heal: "Each creature healed by this
// spell is also cured of all diseases and any effect making it blinded or
// deafened." Both only healed: a blinded, plague-sick hero got 70 hit points
// and stayed blind and sick.
const { caster } = await import("./lib/enforce-spell-kit.mjs");
async function ailing(world, name) {
  const hero = world.addHero({ name, class: "fighter", level: 5, maxHp: 120 });
  world.patch(hero.id, { currentHp: 20, conditions: ["blinded", "deafened"], conditionMeta: { blinded: { minutes: 600 }, deafened: { minutes: 600 } } });
  world.dice(1);
  const sick = await world.invoke("afflict", { characterId: hero.id, kind: "disease", name: "Sewer Plague", save: false, symptomsNow: true });
  world.clearDice();
  assert.equal(sick.ok, true, sick.error);
  assert.ok(world.sheet(hero.id).conditions.includes("sewer plague"), JSON.stringify(world.sheet(hero.id).conditions));
  return hero;
}
const cured = (sheet) => ["blinded", "deafened", "sewer plague"].filter((name) => sheet.conditions.includes(name));

await test("D13: Heal ends blindness, deafness and the disease", async () => {
  const temple = await openWorld();
  const priest = temple.addHero(caster("cleric", "wis", ["Heal", "Mass Heal"], [], 17));
  const hero = await ailing(temple, "Wren");
  const out = await temple.invoke("heal", { characterId: hero.id, casterId: priest.id, spell: "Heal", level: 6 });
  assert.equal(out.ok, true, out.error);
  assert.equal(temple.sheet(hero.id).currentHp, 90, JSON.stringify(out.result));
  assert.deepEqual(cured(temple.sheet(hero.id)), [], `Heal left ${cured(temple.sheet(hero.id))}: ${JSON.stringify(out.result)}`);
});

await test("D13: Mass Heal does the same for each creature it heals", async () => {
  const temple = await openWorld();
  const priest = temple.addHero(caster("cleric", "wis", ["Heal", "Mass Heal"], [], 17));
  const hero = await ailing(temple, "Ostra");
  const out = await temple.invoke("heal", { characterId: hero.id, casterId: priest.id, spell: "Mass Heal", level: 9, amount: 50 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(cured(temple.sheet(hero.id)), [], `Mass Heal left ${cured(temple.sheet(hero.id))}: ${JSON.stringify(out.result)}`);
});

finish();
