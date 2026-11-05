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

const world = await openWorld({ campaign: { maxPlayers: 5 } });
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

const orin = world.addHero({
  name: "Orin", class: "cleric", level: 5, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } }, known: [], prepared: ["Cure Wounds", "Healing Word", "Bless"], cantrips: [] },
});
// A paladin with her Lay on Hands pool, last in the order (after the
// creatures), so Kara's End Turn still walks past them first.
const pella = world.addHero({
  name: "Pella", class: "paladin", level: 5, maxHp: 50, proficiencies: TRAINED,
  abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 14 },
  features: [{ name: "Lay on Hands", source: "class", level: 1 }],
  resources: { lay_on_hands: { max: 25, used: 0 } },
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
  await kit.fight(1 + extra, { heroFaces: { [kara.id]: 20, [bram.id]: 2, [vex.id]: 3, [orin.id]: 4, [pella.id]: 1 }, enemyFace: 10 });
  const [foe, ...others] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(foe.id, 6, 5);
  kit.place(bram.id, 14, 12);
  kit.place(vex.id, 12, 12);
  kit.place(orin.id, 10, 12);
  kit.place(pella.id, 8, 12);
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

// Orin inside the worm with her Spirit Guardians up, cast from `slotLevel`.
async function guardiansInside(slotLevel) {
  const { foe } = await facing("Purple Worm");
  kit.place(orin.id, 5, 6);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, orin);
  world.clearDice();
  assert.ok(holds(orin.id, "swallowed"));
  const sheet = world.sheet(orin.id);
  world.patch(orin.id, {
    conditions: [...sheet.conditions, "spirit guardians"],
    conditionMeta: { ...sheet.conditionMeta, "spirit guardians": { spell: "Spirit Guardians", slotLevel, source: orin.id } },
  });
  return foe;
}

// "30 damage or more on a single turn from a creature inside it" (SRD 5.1,
// Purple Worm): the worm's own turn is one turn and Orin's is another. Both
// end at the same move here (the worm's turn is played in the GM turn after
// the move that starts it), and each is counted alone.
await test("A swallowed cleric's Spirit Guardians as the worm's turn starts counts for the worm's own turn: its 24 and her mace's 13 on her turn are two turns, and neither makes it save", async () => {
  const foe = await guardiansInside(3);
  // Kara's End Turn walks past the worm: its WIS save a 2, the ring's 3d8
  // all 8s, then its acid on Orin.
  kit.giveTurn(kara.id);
  const before = kit.enemy(foe.id).currentHp;
  world.dice(2, 8, 8, 8, 1, 1, 1, 1, 1, 1);
  await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  assert.equal(before - kit.enemy(foe.id).currentHp, 24, "the ring burned it");
  assert.ok(holds(orin.id, "swallowed"), "24 is not yet 30");
  // Orin's turn: her mace from inside (blinded and restrained: two d20s).
  kit.giveTurn(orin.id);
  const mace = await kit.swing(orin.id, foe.id, [19, 19, 6]);
  assert.equal(mace.error, undefined, JSON.stringify(mace.out));
  // A save would take this 2; none is owed.
  world.dice(2);
  await world.invoke("end_turn", { characterId: orin.id });
  const unused = world.clearDice();
  assert.ok(holds(orin.id, "swallowed") && !holds(orin.id, "prone"), "24 on the worm's turn and 13 on hers are two turns, and neither is 30");
  assert.equal(unused, 1, "no Constitution save was rolled");
});

await test("A ring that deals 30 or more from inside on the worm's own turn makes it save at that turn's end, and a failure regurgitates her", async () => {
  const foe = await guardiansInside(5);
  // The ring from a 5th level slot: 5d8, all 8s.
  kit.giveTurn(kara.id);
  const before = kit.enemy(foe.id).currentHp;
  world.dice(2, 8, 8, 8, 8, 8, 1, 1, 1, 1, 1, 1);
  await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  assert.equal(before - kit.enemy(foe.id).currentHp, 40, "the ring burned it");
  assert.ok(holds(orin.id, "swallowed"), "its turn has not ended yet");
  // The worm's turn ends with the next move: its save a 2.
  kit.giveTurn(orin.id);
  world.dice(2);
  await world.invoke("end_turn", { characterId: orin.id });
  world.clearDice();
  assert.ok(!holds(orin.id, "swallowed") && holds(orin.id, "prone"), "40 on its own turn: it saved, failed, and regurgitated her");
});

// A blow from inside lands on the turn it is dealt in. Kara's End Turn walks
// past the worm and rests on Vex, whose turn waits while the worm takes its
// own (held-turn.ts). Orin's ring burns it as its turn starts, and the attack
// she readied answers as it acts: both on the worm's turn. They used to be
// counted apart, the swing on Vex's turn.
await test("Orin's ring as the worm's turn starts and her readied attack as it acts are one turn: 24 and 8 make it save, and it regurgitates her", async () => {
  const foe = await guardiansInside(3);
  kit.freshRound();
  kit.giveTurn(orin.id);
  const ready = await world.invoke("take_action", { characterId: orin.id, action: "ready", trigger: "when the worm acts" });
  assert.equal(ready.ok, true, JSON.stringify(ready));
  kit.giveTurn(kara.id);
  // Its WIS save a 2, the ring's 3d8 all 8s, then its acid on Orin.
  const before = kit.enemy(foe.id).currentHp;
  world.dice(2, 8, 8, 8, 1, 1, 1, 1, 1, 1);
  await world.invoke("end_turn", { characterId: kara.id });
  world.clearDice();
  assert.equal(before - kit.enemy(foe.id).currentHp, 24, "the ring burned it");
  const encounter = world.encounter();
  assert.equal(encounter.order[encounter.turnIndex].characterId, vex.id, "the pointer rests on Vex");
  assert.equal(encounter.legendary.turnStart, vex.id, "Vex's turn waits for the worm's");
  // The worm acts: its stinger at Kara misses on a 1, and Orin's readied
  // mace answers from inside: 6 + 2.
  world.dice(1);
  const sting = await bite(foe, kara, "Tail Stinger");
  world.clearDice();
  assert.equal(sting.ok, true, JSON.stringify(sting));
  const readied = await kit.swing(orin.id, foe.id, [19, 19, 6]);
  assert.equal(readied.error, undefined, JSON.stringify(readied.out));
  assert.equal(before - kit.enemy(foe.id).currentHp, 32, "24 and 8, on the worm's turn");
  // The turn is handed on; Vex ends hers, and with it the worm's turn ends:
  // its save a 2.
  kit.handOnEnemies();
  world.dice(2);
  await world.invoke("end_turn", { characterId: vex.id });
  world.clearDice();
  assert.ok(!holds(orin.id, "swallowed") && holds(orin.id, "prone"), "32 on its own turn: it saved, failed, and regurgitated her");
});

// Vex, the one the pointer rests on, readied an attack on her turn before.
// Released as the worm acts, it is her reaction, not her turn's Attack
// action, and her turn has not begun; her swing once it has is her own
// turn's. 16 on the worm's turn and 16 on hers are two turns, where both used
// to be counted on hers as 32.
await test("Vex's readied attack released from inside as the worm acts is her reaction on the worm's turn, and her swing on her own turn is hers: 16 and 16, and no save", async () => {
  const { foe } = await facing("Purple Worm");
  const was = world.sheet(vex.id);
  world.patch(vex.id, { abilities: { ...was.abilities, str: 18 }, equipment: [{ name: "Greatsword", qty: 1, equipped: true }] });
  try {
    kit.place(vex.id, 5, 6);
    world.dice(19, 1, 1, 1, 1);
    await bite(foe, vex);
    world.clearDice();
    assert.ok(holds(vex.id, "swallowed"));
    kit.freshRound();
    // On her turn before, Vex readies an attack for when the worm acts.
    kit.giveTurn(vex.id);
    const ready = await world.invoke("take_action", { characterId: vex.id, action: "ready", trigger: "when the worm acts" });
    assert.equal(ready.ok, true, JSON.stringify(ready));
    // Kara's End Turn walks past the worm (its acid on Vex, all 1s) and
    // rests on Vex, whose turn waits for the worm's.
    kit.giveTurn(kara.id);
    world.dice(1, 1, 1, 1, 1, 1);
    await world.invoke("end_turn", { characterId: kara.id });
    world.clearDice();
    const encounter = world.encounter();
    assert.equal(encounter.order[encounter.turnIndex].characterId, vex.id, "the pointer rests on Vex");
    assert.equal(encounter.legendary.turnStart, vex.id, "Vex's turn is held for the worm's");
    // The worm acts: its stinger at Kara misses on a 1. Vex's readied
    // greatsword answers from inside: 16.
    world.dice(1);
    const sting = await bite(foe, kara, "Tail Stinger");
    world.clearDice();
    assert.equal(sting.ok, true, JSON.stringify(sting));
    const before = kit.enemy(foe.id).currentHp;
    const readied = await kit.swing(vex.id, foe.id, [19, 19, 6, 6]);
    assert.equal(readied.error, undefined, JSON.stringify(readied.out));
    assert.equal(before - kit.enemy(foe.id).currentHp, 16, "the readied swing on the worm's turn");
    assert.ok(world.encounter().reactionsUsed.includes(vex.id), "the release took her reaction");
    assert.ok(!holds(vex.id, "readied"), "and what she readied");
    assert.equal(world.encounter().legendary.turnStart, vex.id, "her turn has not begun");
    // The turn is handed on, and Vex's begins: her swing from inside, 16.
    kit.handOnEnemies();
    assert.equal(world.encounter().legendary.turnStart, undefined, "Vex's turn has begun");
    const own = await kit.swing(vex.id, foe.id, [19, 19, 6, 6]);
    assert.equal(own.error, undefined, JSON.stringify(own.out));
    assert.equal(before - kit.enemy(foe.id).currentHp, 32);
    // A save would take this 2; none is owed.
    world.dice(2);
    await world.invoke("end_turn", { characterId: vex.id });
    const unused = world.clearDice();
    assert.ok(holds(vex.id, "swallowed") && !holds(vex.id, "prone"), "16 on the worm's turn and 16 on hers are two turns, and neither is 30");
    assert.equal(unused, 1, "no Constitution save was rolled");
  } finally {
    world.patch(vex.id, { abilities: was.abilities, equipment: was.equipment });
  }
});

await test("The fight's last foe dies with Kara inside: the fight ends with her out of the corpse and prone, and the next fight reaches her and she it", async () => {
  const { foe } = await facing("Purple Worm");
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  assert.ok(holds(kara.id, "swallowed"), "swallowed");
  kit.setEnemy(foe.id, { currentHp: 100 });
  const slain = await world.invoke("apply_damage", { enemyId: foe.id, amount: 200, reason: "the test's blow" });
  assert.equal(slain.result?.encounterOver, true, JSON.stringify(slain));
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(!holds(kara.id, name), `no longer ${name} once the fight is over`);
  }
  assert.ok(holds(kara.id, "prone"), "exiting prone");
  assert.match(slain.result.swallowedOut ?? JSON.stringify(slain.result), /As the fight ends: Kara out of .*'s corpse, prone\./);
  // The next fight, staged without the reset facing() does: a goblin beside her.
  await kit.fight(1, { heroFaces: { [kara.id]: 20, [bram.id]: 2, [vex.id]: 3, [orin.id]: 4 }, enemyFace: 10 });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(goblin.id, 6, 5);
  kit.giveTurn(kara.id);
  const swing = await kit.attack(kara.id, goblin.id);
  assert.doesNotMatch(JSON.stringify(swing), /is inside/, "her swing reaches the goblin");
  kit.freshRound();
  const back = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id });
  assert.doesNotMatch(JSON.stringify(back), /is inside/, "the goblin's swing reaches her");
});

await test("A swallower that flees leaves her behind, prone where it stood, and the fight goes on", async () => {
  const { foe } = await facing("Purple Worm", 1);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  const fled = await world.invoke("enemy_flees", { enemyId: foe.id });
  assert.equal(fled.ok, true, JSON.stringify(fled));
  assert.ok(world.encounter(), "the goblin holds the fight open");
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(!holds(kara.id, name), `no longer ${name} after it fled`);
  }
  assert.ok(holds(kara.id, "prone"), "prone");
  assert.match(fled.result.swallowedFreed ?? JSON.stringify(fled.result), /Kara at \(\d+,\d+\) is left behind as .* flees: out of it, prone where it was\./);
});

await test("A swallower banished to another plane leaves her behind on this one, prone where it stood", async () => {
  const { foe } = await facing("Purple Worm", 1);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  const gone = await world.invoke("set_condition", { enemyId: foe.id, condition: "banished" });
  assert.equal(gone.ok, true, JSON.stringify(gone));
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(!holds(kara.id, name), `no longer ${name} once it is banished`);
  }
  assert.ok(holds(kara.id, "prone"), "prone");
  assert.match(JSON.stringify(gone.result), /Kara at \(\d+,\d+\) is left behind as .* vanishes from this plane/);
});

// "A swallowed creature ... has total cover against attacks and other effects
// outside the worm" (SRD 5.1): a heal, a buff and a healer's hands are effects
// too, both ways.
const firstSlots = () => world.sheet(orin.id).spellcasting.slots[1].used;
const insideRefusal = /is inside .*(total cover against attacks and other effects from outside it|from there only .* can be reached)\. Nothing was spent/;

await test("Orin's Cure Wounds and Bless from outside the worm do not reach Kara inside it, and nothing is spent", async () => {
  const { foe } = await facing("Purple Worm");
  kit.place(orin.id, 5, 6);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  world.patch(kara.id, { currentHp: 40 });
  kit.giveTurn(orin.id);
  const spent = firstSlots();
  world.dice(8);
  const touch = await world.invoke("heal", { characterId: kara.id, casterId: orin.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  assert.equal(world.sheet(kara.id).currentHp, 40, "a touch from outside heals nobody inside");
  assert.match(touch.error ?? JSON.stringify(touch), insideRefusal);
  const bless = await world.invoke("cast_buff", { characterId: orin.id, spell: "Bless", targetCharacterIds: [kara.id] });
  assert.ok(!holds(kara.id, "blessed") && !holds(kara.id, "bless"), "no Bless inside");
  assert.match(bless.error ?? JSON.stringify(bless), insideRefusal);
  assert.equal(firstSlots(), spent, "no slot spent");
});

await test("From inside the worm Orin's Healing Word does not reach Bram outside, while Cure Wounds reaches Kara inside the same worm", async () => {
  const { foe } = await facing("Purple Worm");
  kit.place(orin.id, 5, 6);
  kit.place(bram.id, 4, 6);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  kit.freshRound();
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, orin);
  world.clearDice();
  assert.ok(holds(orin.id, "swallowed") && holds(kara.id, "swallowed"), "both inside");
  world.patch(bram.id, { currentHp: 10 });
  world.patch(kara.id, { currentHp: 40 });
  kit.giveTurn(orin.id);
  const spent = firstSlots();
  world.dice(4);
  const word = await world.invoke("heal", { characterId: bram.id, casterId: orin.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(world.sheet(bram.id).currentHp, 10, "nothing from inside reaches outside");
  assert.match(word.error ?? JSON.stringify(word), insideRefusal);
  assert.equal(firstSlots(), spent, "no slot spent");
  world.dice(8);
  const touch = await world.invoke("heal", { characterId: kara.id, casterId: orin.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  assert.equal(touch.ok, true, JSON.stringify(touch));
  assert.ok(world.sheet(kara.id).currentHp > 40, "inside the same worm, a touch reaches");
});

// Kara inside the worm, Bram and a goblin beside her token outside it.
async function insideBesideGoblin() {
  const { foe, others } = await facing("Purple Worm", 1);
  const [goblin] = others;
  kit.place(bram.id, 5, 6);
  kit.place(goblin.id, 4, 5);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  assert.ok(holds(kara.id, "swallowed"));
  return goblin;
}

await test("Bram beside her token cannot stabilize Kara dying inside the worm", async () => {
  await insideBesideGoblin();
  world.patch(kara.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  kit.giveTurn(bram.id);
  world.dice(20);
  const tended = await world.invoke("stabilize", { characterId: kara.id, healerId: bram.id });
  world.clearDice();
  assert.ok(!world.sheet(kara.id).deathSaves?.stable, "not stabilized from outside");
  assert.match(tended.error ?? JSON.stringify(tended), insideRefusal);
});

await test("From inside the worm Kara can neither grapple, shove, help nor improvise against the goblin outside it, nor reach the scene outside", async () => {
  const goblin = await insideBesideGoblin();
  const crossed = [];
  // An improvised action (take_action improvise) reaches a creature or the
  // scene: from inside, neither is there.
  const improvised = { action: "improvise", reason: "kicks a lantern over", skill: "athletics", scene: "the lantern", distanceFt: 5 };
  for (const args of [
    { action: "grapple", targetEnemyId: goblin.id },
    { action: "shove", targetEnemyId: goblin.id },
    { action: "help", targetCharacterId: bram.id, targetEnemyId: goblin.id },
    { ...improvised, targetEnemyId: goblin.id, condition: "prone" },
    { ...improvised, difficulty: "easy" },
  ]) {
    kit.giveTurn(kara.id);
    world.dice(20, 1);
    const tried = await world.invoke("take_action", { characterId: kara.id, ...args });
    world.clearDice();
    if (!insideRefusal.test(tried.error ?? "")) {
      crossed.push(`${args.action}: ${JSON.stringify(tried).slice(0, 200)}`);
    }
  }
  assert.deepEqual(crossed, [], "each reached outside the worm");
  assert.ok(!kit.enemy(goblin.id).conditions.some((entry) => /grappled|prone/i.test(entry)), "no grapple or shove landed");
  assert.ok(!holds(bram.id, "helped"), "no help given from inside");
});

await test("Swallowed, she is out of every grapple: the goblin's on her ends, and so does hers on the goblin", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  const [goblin] = others;
  kit.place(goblin.id, 4, 5);
  world.patch(kara.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: goblin.id } } });
  kit.setEnemy(goblin.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: kara.id } } });
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  assert.ok(holds(kara.id, "swallowed"), "swallowed");
  assert.ok(!holds(kara.id, "grappled"), "the goblin outside holds her no longer");
  assert.ok(!kit.enemy(goblin.id).conditions.includes("grappled"), "she holds the goblin outside no longer");
});

await test("Every other door is shut across the worm's wall: a condition laid from either side, a potion poured, an item handed, a feature spent", async () => {
  const goblin = await insideBesideGoblin();
  world.patch(bram.id, { equipment: [...world.sheet(bram.id).equipment, { name: "Potion of Healing", qty: 1 }] });
  world.patch(kara.id, { currentHp: 40 });
  const crossed = [];
  const tryIt = async (label, name, args) => {
    const out = await world.invoke(name, args);
    if (!insideRefusal.test(out.error ?? "")) {
      crossed.push(`${label}: ${JSON.stringify(out).slice(0, 200)}`);
    }
  };
  kit.giveTurn(bram.id);
  await tryIt("the goblin's fear on Kara inside", "set_condition", { characterId: kara.id, condition: "frightened", sourceEnemyId: goblin.id });
  await tryIt("Kara's fear on the goblin outside", "set_condition", { enemyId: goblin.id, condition: "frightened", sourceCharacterId: kara.id });
  await tryIt("Bram's potion poured into Kara", "use_item", { characterId: bram.id, item: "Potion of Healing", targetCharacterId: kara.id });
  kit.giveTurn(kara.id);
  await tryIt("Kara's greatsword handed to Bram", "handle_item", { characterId: kara.id, action: "hand", item: "Greatsword", toCharacterId: bram.id });
  assert.deepEqual(crossed, [], "each crossed the worm's wall");
  assert.ok(!holds(kara.id, "frightened") && !kit.enemy(goblin.id).conditions.includes("frightened"), "no fear landed");
  assert.equal(world.sheet(kara.id).currentHp, 40, "nothing healed her");
  assert.ok(world.sheet(kara.id).equipment.some((item) => /greatsword/i.test(item.name)), "she keeps her sword");
});

// The goblin beside Kara's token, held inside the worm with her: a creature
// row swallowed as the engine writes one (swallowCreature).
function goblinInside(foe, goblin) {
  kit.setEnemy(goblin.id, { conditions: ["blinded", "restrained", "swallowed"], conditionMeta: { blinded: { source: foe.id }, restrained: { source: foe.id }, swallowed: { source: foe.id } } });
}

await test("Pella's Lay on Hands from beside Kara's token does not reach her inside the worm, and spends no point of the pool", async () => {
  await insideBesideGoblin();
  kit.place(pella.id, 4, 6);
  world.patch(kara.id, { currentHp: 40 });
  kit.giveTurn(pella.id);
  const touch = await world.invoke("use_resource", { characterId: pella.id, resource: "Lay on Hands", targetCharacterId: kara.id, amount: 5 });
  assert.equal(world.sheet(kara.id).currentHp, 40, `a paladin's touch from outside healed her: ${JSON.stringify(touch).slice(0, 200)}`);
  assert.equal(world.sheet(pella.id).resources.lay_on_hands.used, 0, "no point of the pool spent");
  assert.match(touch.error ?? "", insideRefusal);
});

await test("Bram's healing with no spell (a potion poured, a touch) does not reach Kara inside the worm", async () => {
  await insideBesideGoblin();
  world.patch(kara.id, { currentHp: 40 });
  const poured = await world.invoke("heal", { characterId: kara.id, casterId: bram.id, amount: 10, reason: "a potion poured" });
  assert.equal(world.sheet(kara.id).currentHp, 40, `healed from outside: ${JSON.stringify(poured).slice(0, 200)}`);
  assert.match(poured.error ?? "", insideRefusal);
});

await test("Kara inside the worm cannot pin the goblin outside it, though she holds its grapple", async () => {
  const goblin = await insideBesideGoblin();
  world.patch(kara.id, { feats: ["Grappler"] });
  // A grapple written after the swallow (the swallow itself ends hers).
  kit.setEnemy(goblin.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: kara.id } } });
  kit.giveTurn(kara.id);
  world.dice(20, 1, 1);
  const pinned = await world.invoke("take_action", { characterId: kara.id, action: "pin", targetEnemyId: goblin.id });
  world.clearDice();
  assert.ok(!kit.enemy(goblin.id).conditions.includes("restrained"), `pinned from inside: ${JSON.stringify(pinned).slice(0, 200)}`);
  assert.match(pinned.error ?? "", insideRefusal);
});

await test("Bram's wolf cannot bite a goblin inside the worm", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  const [goblin] = others;
  kit.place(goblin.id, 5, 5);
  goblinInside(foe, goblin);
  kit.giveTurn(bram.id);
  const summoned = await world.invoke("summon_pet", { characterId: bram.id, kind: "other", form: "wolf", name: "Patch" });
  assert.equal(summoned.ok, true, summoned.error);
  kit.giveTurn(bram.id);
  const hp = kit.enemy(goblin.id).currentHp;
  world.dice(20, 4, 4, 20);
  const bite = await world.invoke("pet_attack", { characterId: bram.id, targetEnemyId: goblin.id });
  world.clearDice();
  assert.equal(kit.enemy(goblin.id).currentHp, hp, `bitten inside the worm: ${JSON.stringify(bite).slice(0, 200)}`);
  assert.match(bite.error ?? "", insideRefusal);
});

await test("Bram's Protection does not reach Kara inside the worm, though her token is beside him", async () => {
  await insideBesideGoblin();
  const sheet = world.sheet(bram.id);
  world.patch(bram.id, {
    equipment: [...sheet.equipment, { name: "Shield", qty: 1, equipped: true }],
    features: [...sheet.features, { name: "Fighting Style: Protection", source: "class", level: 1 }],
  });
  const out = await world.invoke("use_reaction", { characterId: bram.id, feature: "Protection", targetCharacterId: kara.id });
  assert.ok(!holds(kara.id, "protected"), `protected from outside: ${JSON.stringify(out).slice(0, 200)}`);
  assert.match(out.error ?? "", insideRefusal);
});

await test("Vex's Counterspell does not reach a goblin shaman casting inside the worm", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  const [goblin] = others;
  kit.setEnemy(goblin.id, { stats: { spellcasting: { dc: 13, attack: 5, ability: "int", slots: { 3: 1 }, spells: [{ name: "Fireball", level: 3 }] } } });
  kit.place(goblin.id, 5, 5);
  kit.place(vex.id, 8, 5);
  goblinInside(foe, goblin);
  const sheet = world.sheet(vex.id);
  world.patch(vex.id, { spellcasting: { ...sheet.spellcasting, prepared: [...sheet.spellcasting.prepared, "Counterspell"], spellbook: [...(sheet.spellcasting.spellbook ?? []), "Counterspell"] } });
  const slots = world.sheet(vex.id).spellcasting.slots[3].used;
  const out = await world.invoke("use_reaction", { characterId: vex.id, feature: "Counterspell", targetEnemyId: goblin.id, spell: "Fireball" });
  assert.equal(world.sheet(vex.id).spellcasting.slots[3].used, slots, `countered inside the worm: ${JSON.stringify(out).slice(0, 200)}`);
  assert.match(out.error ?? "", insideRefusal);
});

await test("Orin's Turn Undead reaches no undead inside the worm, and keeps his Channel Divinity", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  const [goblin] = others;
  kit.setEnemy(goblin.id, { stats: { type: "undead", cr: 1 } });
  kit.place(goblin.id, 5, 5);
  kit.place(orin.id, 7, 7);
  goblinInside(foe, goblin);
  const sheet = world.sheet(orin.id);
  world.patch(orin.id, {
    features: [...sheet.features, { name: "Channel Divinity (1/rest)", source: "class", level: 2 }],
    resources: { ...sheet.resources, channel_divinity: { max: 1, used: 0 } },
  });
  kit.giveTurn(orin.id);
  world.dice(1, 1);
  const out = await world.invoke("use_resource", { characterId: orin.id, resource: "Channel Divinity", variant: "turn undead" });
  world.clearDice();
  assert.ok(!kit.enemy(goblin.id).conditions.includes("turned"), `turned inside the worm: ${JSON.stringify(out).slice(0, 200)}`);
  assert.equal(world.sheet(orin.id).resources.channel_divinity.used, 0, "Channel Divinity kept");
  assert.match(out.error ?? "", /Nothing Turn Undead affects is within 30 feet/);
});

await test("An aboleth's Psychic Drain does not reach Kara inside the worm, and its legendary actions are not spent", async () => {
  const { foe, others } = await facing("Purple Worm", 1);
  const [aboleth] = others;
  const stats = srd("Aboleth");
  kit.setEnemy(aboleth.id, { ac: stats.ac, maxHp: stats.maxHp, currentHp: 100, stats });
  kit.place(aboleth.id, 4, 5);
  world.dice(19, 1, 1, 1, 1);
  await bite(foe, kara);
  world.clearDice();
  const sheet = world.sheet(kara.id);
  world.patch(kara.id, { conditions: [...sheet.conditions, "charmed"], conditionMeta: { ...sheet.conditionMeta, charmed: { source: aboleth.id } } });
  kit.giveTurn(kara.id);
  const hp = world.sheet(kara.id).currentHp;
  const pool = () => world.encounter().legendary.pools?.[aboleth.id]?.actions ?? 3;
  world.dice(4, 4, 4);
  const out = await world.invoke("legendary_action", { enemyId: aboleth.id, action: "Psychic Drain", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(world.sheet(kara.id).currentHp, hp, `drained through the wall: ${JSON.stringify(out).slice(0, 200)}`);
  assert.equal(pool(), 3, "no legendary action spent");
  assert.match(out.error ?? "", /Kara is inside .*total cover against attacks and other effects from outside it/);
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
