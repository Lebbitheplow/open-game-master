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

// Kara on her turn beside one SRD creature (and a goblin far off).
async function facing(title, extra = 0) {
  await kit.endFight();
  await kit.fight(1 + extra, { heroFaces: { [kara.id]: 20, [bram.id]: 2 }, enemyFace: 1 });
  const [foe, ...others] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(foe.id, 6, 5);
  kit.place(bram.id, 14, 12);
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
  assert.match(stuck.body.error ?? JSON.stringify(stuck.body), /cannot move while .*restrained/);
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

finish();
