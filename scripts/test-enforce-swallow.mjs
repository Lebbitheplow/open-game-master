// Swallowed whole, played by the engine (src/lib/dm/swallow.ts, issue 685):
// a Swallow action (the behir's) and a bite that swallows (the purple
// worm's on a failed save, the kraken's of a creature it grapples) lay
// blinded, restrained and swallowed; the creature inside has total cover
// against everything outside and reaches only its swallower; it takes the
// block's acid at the start of each of the swallower's turns; enough damage
// from inside in one turn forces the swallower's Constitution save at that
// turn's end, and a failure regurgitates it prone beside the creature; and a
// swallower that dies leaves it unrestrained, to climb out of the corpse
// with the feet of movement the block prints, exiting prone. The turns are
// the engine's own: end_turn walks the order.
//
// Before, only a bite read "is swallowed" did anything (blinded and
// restrained, for good), a purple worm's never swallowed, a kraken's asked
// the target its own regurgitation save, and a behir's Swallow was no attack
// at all.
//
// The creatures are the rulebook's own pages read as the engine reads a pack
// row (statblock.ts parseMonster), so the suite needs no content pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-enforce-swallow");

const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srd(title) {
  const page = book.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}

const world = await openWorld({ campaign: { maxPlayers: 4 } });
const kit = await combatKit(world);
const kara = world.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 150, proficiencies: TRAINED,
  abilities: { str: 18, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Greatsword", qty: 1, equipped: true }],
});
const bram = world.addHero({ name: "Bram", maxHp: 60 });
const vex = world.addHero({
  name: "Vex", class: "wizard", level: 5, maxHp: 60,
  abilities: { int: 17, dex: 14 },
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } }, known: [], prepared: ["Fireball"], cantrips: [], spellbook: ["Fireball"] },
});

// "Revert this turn" (src/lib/dm/turn-revert.ts), as the table's owner.
async function revertTurn(turnId) {
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  world.signIn(world.owner);
  const response = await handler.POST(
    new Request("http://odm.test/revert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// Kara on her turn beside one SRD creature (and a goblin far off).
async function facing(title, extra = 0) {
  await kit.endFight();
  // Kara first, the creatures next, the others last: Kara's End Turn walks
  // the order past the creatures' turns.
  await kit.fight(1 + extra, { heroFaces: { [kara.id]: 20, [bram.id]: 2, [vex.id]: 3 }, enemyFace: 10 });
  const [foe, ...others] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(foe.id, 6, 5);
  kit.place(bram.id, 14, 12);
  kit.place(vex.id, 12, 12);
  others.forEach((other, index) => kit.place(other.id, 1 + index, 13));
  kit.giveTurn(kara.id);
  return { foe: world.enemies().find((enemy) => enemy.id === foe.id), others };
}

// Kara's own walk on the board, as the player drags her token.
async function walk(x, y) {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: kara.userId });
  const response = await route.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  return { status: response.status, body: await response.json() };
}

const holds = (id, name) => world.sheet(id).conditions.map((entry) => entry.toLowerCase()).includes(name);
const grapple = (id, by) => world.patch(id, { conditions: ["grappled"], conditionMeta: { grappled: { source: by } } });
// What a swing said, at the top of the result or on the swing that made it.
const said = (out, key) => out.result?.[key] ?? out.result?.swings?.find((swing) => swing[key])?.[key];
const bite = (foe, target, attack = "Bite") => world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: target.id, attack });

await test("A purple worm's bite swallows on a failed Dexterity save: blinded, restrained and swallowed, with total cover from outside", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  world.dice(19, 1, 1, 1, 1);
  const out = await bite(foe, kara);
  world.clearDice();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(said(out, "swallowed"), /Kara is swallowed: blinded and restrained inside .*6d6 acid damage at the start of each of its turns\. 30 damage dealt it from inside in one turn makes it save \(DC 21 Constitution\)/);
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(holds(kara.id, name), name);
  }
  // Nothing outside reaches her, and from inside she reaches only the worm.
  kit.freshRound();
  const sting = await world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: kara.id, attack: "Tail Stinger" });
  assert.match(sting.error ?? JSON.stringify(sting), /Kara is inside .*total cover against attacks and other effects from outside it\. Nothing was spent/);
  const out2 = await kit.attack(kara.id, others[0].id);
  assert.match(out2.error ?? "", /Kara is inside .*from there only .* can be reached\. Nothing was spent/);
});

await test("Its acid at the start of each of its turns, as the engine walks the order", async () => {
  const { foe } = await facing("Purple Worm");
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  const hp = world.sheet(kara.id).currentHp;
  // The worm's turn starts as Kara's ends: 6d6 acid.
  world.dice(2, 2, 2, 2, 2, 2);
  const ended = await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  assert.equal(ended.error, undefined, JSON.stringify(ended));
  assert.equal(world.sheet(kara.id).currentHp, hp - 12, "12 acid as its turn starts");
  assert.ok(holds(kara.id, "swallowed"), "still inside");
});

await test("Thirty damage from inside in one turn: the worm fails its Constitution save at that turn's end and regurgitates her, prone beside it", async () => {
  const { foe } = await facing("Purple Worm");
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  // Two greatsword hits from inside, blinded and restrained (disadvantage).
  const first = await kit.swing(kara.id, foe.id, [19, 19, 6, 6]);
  assert.equal(first.error, undefined, JSON.stringify(first.out));
  const second = await kit.swing(kara.id, foe.id, [19, 19, 6, 6]);
  assert.equal(second.error, undefined, JSON.stringify(second.out));
  assert.ok(foe.currentHp - kit.enemy(foe.id).currentHp >= 30, "thirty from inside");
  // Its save: a 2.
  world.dice(2);
  await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(!holds(kara.id, name), `no longer ${name}`);
  }
  assert.ok(holds(kara.id, "prone"), "prone");
  const at = kit.token(kara.id);
  const body = kit.token(foe.id);
  const apart = Math.max(Math.max(body.x - at.x, at.x - (body.x + 3), 0), Math.max(body.y - at.y, at.y - (body.y + 3), 0));
  assert.ok(apart <= 2, `within 10 feet of the worm: (${at.x},${at.y}) beside (${body.x},${body.y})`);
});

await test("A behir's Swallow: its bite at the creature it grapples, one creature at a time; its death frees her to climb out with 15 feet of movement, prone", async () => {
  const { foe } = await facing("Behir", 1);
  kit.place(bram.id, 5, 6);
  // Not held: no Swallow, nothing spent.
  const loose = await bite(foe, kara, "Swallow");
  assert.match(loose.error ?? "", /Kara is not grappled by .*a creature it is grappling\. Nothing was spent/);
  grapple(kara.id, foe.id);
  world.dice(19, 1, 1, 1);
  const swallowed = await bite(foe, kara, "Swallow");
  world.clearDice();
  assert.equal(swallowed.ok, true, JSON.stringify(swallowed));
  assert.match(said(swallowed, "swallowed"), /Kara is swallowed/);
  assert.ok(holds(kara.id, "swallowed") && !holds(kara.id, "grappled"), "swallowed, and the grapple ends");
  kit.freshRound();
  grapple(bram.id, foe.id);
  const second = await bite(foe, bram, "Swallow");
  assert.match(second.error ?? "", /already has a creature swallowed, and can have only one at a time/);
  // Inside a living behir there is no walk.
  const stuck = await walk(2, 5);
  assert.match(stuck.body.error ?? JSON.stringify(stuck.body), /Kara is swallowed inside .*no walking/);
  // It dies.
  const slain = await world.invoke("apply_damage", { enemyId: foe.id, amount: 200, reason: "the test's blow" });
  assert.match(JSON.stringify(slain), /no longer restrained by .*15 feet of movement climbs out of the corpse/);
  assert.ok(!holds(kara.id, "restrained") && holds(kara.id, "swallowed"), "unrestrained, still in the corpse");
  const out = await walk(2, 5);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.match(JSON.stringify(out.body), /climbs out of .*corpse with 15 feet of movement and lands prone/);
  assert.ok(!holds(kara.id, "swallowed") && !holds(kara.id, "blinded") && holds(kara.id, "prone"));
});

await test("A kraken's bite swallows only the creature it grapples, and asks no save of it", async () => {
  const { foe } = await facing("Kraken");
  world.dice(19, 1, 1, 1);
  const loose = await bite(foe, kara);
  world.clearDice();
  assert.equal(loose.ok, true, JSON.stringify(loose));
  assert.match(said(loose, "notSwallowed"), /not grappled by/);
  assert.ok(!holds(kara.id, "swallowed"));
  kit.freshRound();
  grapple(kara.id, foe.id);
  world.dice(19, 1, 1, 1);
  const held = await bite(foe, kara);
  world.clearDice();
  assert.match(said(held, "swallowed"), /Kara is swallowed/);
  assert.ok(holds(kara.id, "swallowed"));
});

await test("A routine's later swing at a creature an earlier one swallowed is refused with total cover, and nothing outside reaches it", async () => {
  const { foe } = await facing("Purple Worm");
  world.dice(19, 1, 1, 1, 1, 19, 1, 1, 1);
  const out = await bite(foe, kara);
  world.clearDice();
  assert.equal(out.ok, true, JSON.stringify(out));
  const swings = out.result.swings ?? [];
  assert.match(swings[0]?.swallowed ?? "", /Kara is swallowed/);
  assert.match(swings[1]?.skipped ?? JSON.stringify(swings), /Kara is inside .*total cover against attacks and other effects from outside it/);
  assert.equal(swings[1]?.hit, undefined, "the second bite never rolled");
});

await test("A swallow in a turn goes back with Revert this turn: free, held as before, unharmed", async () => {
  const { foe } = await facing("Behir", 1);
  grapple(kara.id, foe.id);
  const hp = world.sheet(kara.id).currentHp;
  world.dice(19, 1, 1, 1);
  const swallowed = await bite(foe, kara, "Swallow");
  world.clearDice();
  assert.ok(holds(kara.id, "swallowed") && world.sheet(kara.id).currentHp < hp);
  const back = await revertTurn(swallowed.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(!holds(kara.id, name), `no longer ${name}`);
  }
  assert.ok(holds(kara.id, "grappled"), "held as before");
  assert.equal(world.sheet(kara.id).currentHp, hp, "unharmed");
});

await test("A regurgitation at a turn's end goes back with that turn's revert: inside again, not prone, where she was", async () => {
  const { foe } = await facing("Purple Worm");
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  await kit.swing(kara.id, foe.id, [19, 19, 6, 6]);
  await kit.swing(kara.id, foe.id, [19, 19, 6, 6]);
  const at = { ...kit.token(kara.id) };
  world.dice(2);
  const ended = await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  assert.ok(!holds(kara.id, "swallowed") && holds(kara.id, "prone"), "regurgitated");
  const back = await revertTurn(ended.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.ok(holds(kara.id, "swallowed") && holds(kara.id, "blinded") && holds(kara.id, "restrained"), "inside again");
  assert.ok(!holds(kara.id, "prone"), "not prone");
  assert.deepEqual([kit.token(kara.id).x, kit.token(kara.id).y], [at.x, at.y], "where she was");
});

await test("Damage from inside counts from whatever deals it: Vex's Fireball from inside the worm makes it save and regurgitate her", async () => {
  const { foe } = await facing("Purple Worm");
  kit.place(vex.id, 5, 6);
  world.dice(19, 1, 1, 1, 1);
  const swallowed = await bite(foe, vex);
  world.clearDice();
  assert.ok(holds(vex.id, "swallowed"), JSON.stringify(swallowed));
  kit.giveTurn(vex.id);
  world.dice(1, 6, 6, 6, 6, 6, 6, 6, 6);
  const fire = await world.invoke("aoe_damage", { casterCharacterId: vex.id, spell: "Fireball", level: 3, enemyIds: [foe.id] });
  world.clearDice();
  assert.equal(fire.ok, true, JSON.stringify(fire));
  assert.ok(foe.currentHp - kit.enemy(foe.id).currentHp >= 30, `thirty from inside: ${JSON.stringify(fire.result)}`);
  world.dice(2);
  await world.invoke("end_turn", { characterId: vex.id });
  world.clearDice();
  assert.ok(!holds(vex.id, "swallowed") && holds(vex.id, "prone"), "regurgitated by the fire inside it");
});

await test("A creature fighting on the party's side is swallowed as a hero is: its row inside, total cover, the acid at the worm's turn start", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  const [goblin] = others;
  kit.setEnemy(goblin.id, { conditions: ["charmed"], conditionMeta: { charmed: { spell: "Dominate Person", source: kara.id } } });
  kit.place(goblin.id, 5, 6);
  world.dice(19, 1, 1, 1, 1);
  const out = await world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: goblin.id, attack: "Bite" });
  world.clearDice();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(said(out, "swallowed") ?? JSON.stringify(out), /is swallowed/);
  const row = () => kit.enemy(goblin.id);
  assert.ok(["swallowed", "blinded", "restrained"].every((name) => row().conditions.includes(name)), row().conditions.join(", "));
  kit.freshRound();
  const sting = await world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: goblin.id, attack: "Tail Stinger" });
  assert.match(sting.error ?? JSON.stringify(sting), /is inside .*total cover against attacks and other effects from outside it/);
  const hp = row().currentHp;
  world.dice(2, 2, 2, 2, 2, 2);
  await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  assert.ok(row().currentHp < hp, "the acid at the worm's turn start");
});

await test("The board's move says she is swallowed and how out, not that her speed is 0", async () => {
  const { foe } = await facing("Purple Worm");
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  const stuck = await walk(2, 5);
  assert.equal(stuck.status, 409);
  assert.match(stuck.body.error, /Kara is swallowed inside .*no walking\. 30 damage dealt it from inside in one turn makes it save or regurgitate them, and once it dies, 20 feet of movement climbs out of its corpse/);
});

finish();
