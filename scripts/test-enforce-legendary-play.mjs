// A legendary action played through the engine (issue 685 audit, 4.G): the
// GM's card is one call, the spend and what it buys together
// (src/lib/dm/legendary-play.ts), each of the SRD 5.1 bestiary's options
// played by what it does with the engine's own tools; and a follow-up the
// engine refuses gives the action back, on the card's one call and on the
// console's or the AI's two (legendary-purchase.ts settleLegendaryFollowUp).
//
// The creatures are the rulebook's own pages read as the engine reads a pack
// row (statblock.ts parseMonster), so the suite needs no content pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-enforce-legendary-play");

const campaigns = await import("../src/lib/db/campaigns.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { listEffects } = await import("../src/lib/db/active-effects.ts");
const { enemyActedThisRound } = await import("../src/lib/dm/can-act.ts");
const { getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");
const { listLiveTurnChangeViews } = await import("../src/lib/db/turn-changes.ts");
const { acWithEffects, enemyAcWithEffects } = await import("../src/lib/dm/ac-effects.ts");
const { endOwnTurn } = await import("../src/lib/dm/encounter-tools.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srd(title) {
  const page = book.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}

async function post(world, name, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

// A table a person runs, Kara on her turn and one SRD creature beside her.
async function facing(title) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", maxHp: 150 });
  const gm = world.addUser("gm");
  const status = world.campaign().status;
  campaigns.setCampaignStatus(world.campaignId, "lobby");
  assert.ok(campaigns.joinByInviteCode(gm.id, world.campaign().inviteCode).campaign);
  campaigns.setCampaignStatus(world.campaignId, status);
  campaigns.setDmMode(world.campaignId, "human", gm.id);
  await kit.fight(1, { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
  const [foe] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(foe.id, 6, 5);
  kit.giveTurn(kara.id);
  const play = (args) => post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: foe.id, ...args }, hand: true }, gm);
  const pool = () => world.encounter().legendary.pools[foe.id]?.actions ?? null;
  // The next turn's end: one legendary action may follow it again.
  const nextTurn = () => {
    const encounter = world.encounter();
    encounters.saveEncounter({ ...encounter, round: encounter.round + 1, legendary: { ...encounter.legendary, pools: {} } });
  };
  return { world, kit, kara: world.sheet(kara.id), gm, foe: world.enemies()[0], play, pool, nextTurn };
}

await test("A legendary swing refused after the spend gives the action back: the card's one call and the console's two", async () => {
  const { world, kara, gm, foe, play, pool, kit } = await facing("Adult Red Dragon");
  // Held where it stands, the tail cannot reach Kara forty feet off.
  kit.place(kara.id, 14, 5);
  kit.setEnemy(foe.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: kara.id } } });
  const rolls = listRecentRolls(world.campaignId, 50).length;
  const card = await play({ action: "Tail Attack", targetCharacterId: kara.id });
  assert.equal(card.status, 409, JSON.stringify(card.body));
  assert.match(card.body.error, /keeps its legendary action \(Tail Attack\): nothing was spent/);
  assert.equal(pool() ?? 3, 3, "the pool is whole");
  assert.equal((world.encounter().legendary.strikes ?? []).includes(foe.id), false, "no strike is owed");
  assert.equal(world.encounter().legendary.opportunities?.ids?.includes(foe.id) ?? false, false, "the turn's end is still open");
  assert.equal(listRecentRolls(world.campaignId, 50).length, rolls, "nothing was rolled");

  // The console's two calls: the spend, then the swing out of reach.
  const spent = await post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: foe.id, action: "Tail Attack" } }, gm);
  assert.equal(spent.status, 200, JSON.stringify(spent.body));
  assert.equal(pool(), 2);
  const swing = await post(world, "dm/invoke", { name: "enemy_attack", args: { enemyId: foe.id, targetCharacterId: kara.id, attack: "Tail" } }, gm);
  assert.equal(swing.status, 409);
  assert.match(swing.body.error, /keeps its legendary action \(Tail Attack\): nothing was spent/);
  assert.equal(pool(), 3, "the refused swing gave it back");
  // And it may be spent again at this turn's end.
  kit.place(kara.id, 7, 5);
  world.dice(19, 6, 6);
  const again = await play({ action: "Tail Attack", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(pool(), 2);
});

await test("Detect: the server rolls its Wisdom (Perception) check with the block's bonus", async () => {
  const { world, play, pool } = await facing("Adult Red Dragon");
  world.dice(10);
  const out = await play({ action: "Detect" });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.match(out.body.result.check, /Wisdom \(Perception\) check: 23\./, "10 and the dragon's +13");
  assert.equal(pool(), 2);
});

await test("Wing Attack: its save on everyone caught, then the flight the dragon may take, none of its turn's movement spent", async () => {
  const { world, kara, foe, play, pool, kit } = await facing("Adult Red Dragon");
  const hp = world.sheet(kara.id).currentHp;
  world.dice(1);
  const out = await play({ action: "Wing Attack", characterIds: [kara.id], x: 9, y: 5 });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(world.sheet(kara.id).currentHp < hp, "the wings struck");
  assert.ok(world.sheet(kara.id).conditions.includes("prone"));
  const token = kit.token(foe.id);
  assert.deepEqual([token.x, token.y, token.movement], [9, 5, "fly"], "it flew there and stays aloft");
  assert.equal(token.movedThisRound, 0, "none of its own movement");
  assert.equal(pool(), 1);
});

await test("A vampire's Move goes up to its speed with no opportunity attack; the tarrasque's half its speed", async () => {
  const vampire = await facing("Vampire");
  // A move onto Kara's square is the engine's own move refusing, after the
  // spend: the card gives the action back.
  const onto = await vampire.play({ action: "Move", x: vampire.kit.token(vampire.kara.id).x, y: vampire.kit.token(vampire.kara.id).y });
  assert.equal(onto.status, 409, JSON.stringify(onto.body));
  assert.match(onto.body.error, /keeps its legendary action \(Move\): nothing was spent/);
  assert.equal(vampire.pool() ?? 3, 3);
  const before = listRecentRolls(vampire.world.campaignId, 50).filter((roll) => roll.kind === "attack").length;
  const moved = await vampire.play({ action: "Move", x: 11, y: 5 });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual([vampire.kit.token(vampire.foe.id).x, vampire.kit.token(vampire.foe.id).movedThisRound], [11, 0]);
  assert.equal(listRecentRolls(vampire.world.campaignId, 50).filter((roll) => roll.kind === "attack").length, before, "Kara's opportunity attack was not rolled");
  assert.equal(moved.body.result.opportunityAttacks, undefined);
  // A square past its speed is walked as far as the move goes.
  vampire.nextTurn();
  const far = await vampire.play({ action: "Move", x: 19, y: 5 });
  assert.equal(far.status, 200, JSON.stringify(far.body));
  assert.equal(vampire.kit.token(vampire.foe.id).x, 17, "30 feet on");

  const tarrasque = await facing("Tarrasque");
  const half = await tarrasque.play({ action: "Move", x: 16, y: 5 });
  assert.equal(half.status, 200, JSON.stringify(half.body));
  assert.equal(tarrasque.kit.token(tarrasque.foe.id).x, 10, "half of 40 feet");
});

await test("A Move spent at the console and never walked is gone once that turn's end passes: the vampire's next walk is not a free one", async () => {
  const { world, gm, foe, kit, nextTurn } = await facing("Vampire");
  const spent = await post(world, "dm/invoke", { name: "legendary_action", args: { enemyId: foe.id, action: "Move" } }, gm);
  assert.equal(spent.status, 200, JSON.stringify(spent.body));
  assert.match(spent.body.result.next, /move_token/);
  nextTurn();
  const walk = await post(world, "dm/invoke", { name: "move_token", args: { token: foe.id, x: 9, y: 5 } }, gm);
  assert.equal(walk.body.result?.legendaryMove, undefined, JSON.stringify(walk.body));
  const token = kit.token(foe.id);
  assert.ok(token.x === 6 || token.movedThisRound > 0, `its own movement, or none: ${JSON.stringify(walk.body)}`);
});

await test("Teleport: a jump up to 120 feet; one onto a creature is refused and the action given back", async () => {
  const { foe, kara, play, pool, kit } = await facing("Solar");
  const onto = await play({ action: "Teleport", x: kit.token(kara.id).x, y: kit.token(kara.id).y });
  assert.equal(onto.status, 409, JSON.stringify(onto.body));
  assert.match(onto.body.error, /occupied by another combatant.*keeps its legendary action \(Teleport\): nothing was spent/);
  assert.equal(pool() ?? 3, 3);
  const out = await play({ action: "Teleport", x: 18, y: 9 });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual([kit.token(foe.id).x, kit.token(foe.id).y], [18, 9]);
  assert.equal(pool(), 2);
});

await test("Cantrip and Cast a Spell: through the spell tools, the slot spent as normal and the creature's own action kept", async () => {
  const lich = await facing("Lich");
  const notCantrip = await lich.play({ action: "Cantrip", characterIds: [lich.kara.id], spell: "Magic Missile" });
  assert.equal(notCantrip.status, 409);
  assert.match(notCantrip.body.error, /casts a cantrip, and Magic Missile is a level 1 spell\. Nothing was spent\./);
  assert.equal(lich.pool() ?? 3, 3);
  const hp = lich.world.sheet(lich.kara.id).currentHp;
  lich.world.dice(20, 8, 8);
  const frost = await lich.play({ action: "Cantrip", characterIds: [lich.kara.id], spell: "Ray of Frost" });
  lich.world.clearDice();
  assert.equal(frost.status, 200, JSON.stringify(frost.body));
  assert.ok(lich.world.sheet(lich.kara.id).currentHp < hp, "the ray struck");
  assert.equal(enemyActedThisRound(lich.world.encounter(), lich.foe.id), false, "its own action is untouched");

  const sphinx = await facing("Androsphinx");
  const slots = () => JSON.stringify(sphinx.world.encounter().legendary.abilities?.[sphinx.foe.id]?.slots ?? {});
  const before = slots();
  sphinx.world.dice(1);
  const strike = await sphinx.play({ action: "Cast a Spell", characterIds: [sphinx.kara.id], spell: "Flame Strike" });
  sphinx.world.clearDice();
  assert.equal(strike.status, 200, JSON.stringify(strike.body));
  assert.notEqual(slots(), before, "a level 5 slot was spent");
  assert.equal(enemyActedThisRound(sphinx.world.encounter(), sphinx.foe.id), false);
  assert.equal(sphinx.pool(), 0, "Cast a Spell costs 3");
});

await test("Heal Self, and Shimmering Shield on itself; negative energy keeps the heal from it, nothing spent", async () => {
  const { world, foe, play, pool, kit, nextTurn } = await facing("Unicorn");
  kit.setEnemy(foe.id, { currentHp: 20 });
  world.dice(8, 8);
  const healed = await play({ action: "Heal Self" });
  world.clearDice();
  assert.equal(healed.status, 200, JSON.stringify(healed.body));
  assert.equal(world.enemies()[0].currentHp, 38, "2d8+2: 8, 8 and 2");
  nextTurn();
  const ac = enemyAcWithEffects(world.campaignId, world.enemies()[0]);
  const shield = await play({ action: "Shimmering Shield", targetCharacterId: foe.id });
  assert.equal(shield.status, 200, JSON.stringify(shield.body));
  const held = world.enemies()[0];
  assert.ok(held.conditions.includes("shimmering shield"), held.conditions.join(", "));
  assert.equal(held.conditionMeta["shimmering shield"].untilTurnEndOf, foe.id, "until the end of the unicorn's next turn");
  assert.equal(enemyAcWithEffects(world.campaignId, held), ac + 2);
  assert.equal(listEffects(world.campaignId, { kind: "enemy", id: foe.id }).length, 0, "no effect counted in rounds beside it");
  nextTurn();
  kit.setEnemy(foe.id, { conditions: ["negative energy"] });
  const blocked = await play({ action: "Heal Self" });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /cannot regain hit points while negative energy holds it\. Nothing was spent\./);
  assert.equal(pool() ?? 3, 3);
});

await test("Channel Negative Energy: no healing for those it reaches until the end of the mummy lord's next turn", async () => {
  const { world, kit, kara, gm, play } = await facing("Mummy Lord");
  const out = await play({ action: "Channel Negative Energy", characterIds: [kara.id] });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(world.sheet(kara.id).conditions.includes("negative energy"));
  world.patch(kara.id, { currentHp: 50 });
  const heal = await post(world, "dm/invoke", { name: "heal", args: { characterId: kara.id, amount: 10 } }, gm);
  assert.equal(heal.status, 409);
  assert.match(heal.body.error, /negative energy and cannot regain hit points/);
  // Kara's turn ends and the round turns over: the mummy lord's turn has
  // begun, not ended. A round's count ended it here.
  assert.equal(endOwnTurn(world.campaignId, kara.userId), true);
  assert.ok(world.sheet(kara.id).conditions.includes("negative energy"), "it holds through the mummy lord's turn");
  // The GM hands its turn on: the end of its next turn, and of the curse.
  kit.handOnEnemies();
  assert.equal(world.sheet(kara.id).conditions.includes("negative energy"), false, world.sheet(kara.id).conditions.join(", "));
});

await test("Blasphemous Word stuns until the end of the mummy lord's next turn: through the round's turn over, gone as its turn ends", async () => {
  const { world, kit, kara, play } = await facing("Mummy Lord");
  // Kara's Constitution save: a 1.
  world.dice(1);
  const out = await play({ action: "Blasphemous Word", characterIds: [kara.id] });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(world.sheet(kara.id).conditions.includes("stunned"), JSON.stringify(out.body));
  // Kara's turn ends and the round turns over: the mummy lord's turn has
  // begun, not ended. A round's count ended the stun here.
  assert.equal(endOwnTurn(world.campaignId, kara.userId), true);
  assert.ok(world.sheet(kara.id).conditions.includes("stunned"), "it holds through the mummy lord's turn");
  kit.handOnEnemies();
  assert.equal(world.sheet(kara.id).conditions.includes("stunned"), false, world.sheet(kara.id).conditions.join(", "));
});

await test("Blinding Dust blinds until the end of the creature's own next turn: laid on Kara's turn, it holds through her next one", async () => {
  const { world, kit, kara, play } = await facing("Mummy Lord");
  world.dice(1);
  const out = await play({ action: "Blinding Dust", characterIds: [kara.id] });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(world.sheet(kara.id).conditions.includes("blinded"), JSON.stringify(out.body));
  // Laid during her turn: that one is not her next.
  assert.equal(endOwnTurn(world.campaignId, kara.userId), true);
  assert.ok(world.sheet(kara.id).conditions.includes("blinded"), "the round's turn over is not the end of her next turn");
  kit.handOnEnemies();
  assert.ok(world.sheet(kara.id).conditions.includes("blinded"), "her next turn has begun, not ended");
  assert.equal(endOwnTurn(world.campaignId, kara.userId), true);
  assert.equal(world.sheet(kara.id).conditions.includes("blinded"), false, world.sheet(kara.id).conditions.join(", "));
});

await test("Shimmering Shield on Kara lasts until the end of the unicorn's next turn: through the new round's start, gone as its turn ends", async () => {
  const { world, kit, kara, play } = await facing("Unicorn");
  // The unicorn acts first in the round: the round turns over as Kara's turn
  // ends, before the unicorn's turn. A round's count ended the shield there.
  const encounter = world.encounter();
  const order = [...encounter.order].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "enemy" ? -1 : 1));
  encounters.saveEncounter({ ...encounter, order, turnIndex: order.findIndex((entry) => entry.characterId === kara.id) });
  const ac = acWithEffects(world.campaignId, world.sheet(kara.id));
  const out = await play({ action: "Shimmering Shield", targetCharacterId: kara.id });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(acWithEffects(world.campaignId, world.sheet(kara.id)), ac + 2);
  assert.equal(endOwnTurn(world.campaignId, kara.userId), true);
  assert.equal(acWithEffects(world.campaignId, world.sheet(kara.id)), ac + 2, "it holds through the unicorn's turn");
  kit.handOnEnemies();
  assert.equal(acWithEffects(world.campaignId, world.sheet(kara.id)), ac, "and ends with it");
});

await test("The mummy lord's Attack is two cards: its fist, or its Dreadful Glare, which spends a legendary action and not its own", async () => {
  const { world, kara, foe, play, pool } = await facing("Mummy Lord");
  world.dice(1);
  const glare = await play({ action: "Attack", use: "Dreadful Glare", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(glare.status, 200, JSON.stringify(glare.body));
  assert.ok(world.sheet(kara.id).conditions.includes("frightened"));
  assert.equal(enemyActedThisRound(world.encounter(), foe.id), false, "its own action is still its own");
  assert.equal(pool(), 2);
  const wrong = await play({ action: "Attack", use: "Bite", targetCharacterId: kara.id });
  assert.equal(wrong.status, 409);
});

await test("Psychic Drain hurts only a creature the aboleth charms, and heals it by as much", async () => {
  const { world, kara, foe, play, pool, kit, nextTurn } = await facing("Aboleth");
  const refused = await play({ action: "Psychic Drain", targetCharacterId: kara.id });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /reaches only a creature .* has charmed.*Nothing was spent\./);
  assert.equal(pool() ?? 3, 3);
  nextTurn();
  world.patch(kara.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: foe.id } } });
  kit.setEnemy(foe.id, { currentHp: 100 });
  const hp = world.sheet(kara.id).currentHp;
  world.dice(4, 4, 4);
  const out = await play({ action: "Psychic Drain", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const lost = hp - world.sheet(kara.id).currentHp;
  assert.ok(lost > 0);
  assert.equal(world.enemies()[0].currentHp, 100 + lost);
});

await test("The kraken: Lightning Storm on at most three, its own action kept; Ink Cloud laid around it; Fling throws the creature it holds", async () => {
  const { world, kara, foe, play, pool, kit, nextTurn } = await facing("Kraken");
  const others = [world.addHero({ name: "Bo" }), world.addHero({ name: "Cy" }), world.addHero({ name: "Di" })];
  const four = await play({ action: "Lightning Storm", characterIds: [kara.id, ...others.map((entry) => entry.id)] });
  assert.equal(four.status, 409);
  assert.match(four.body.error, /Lightning Storm reaches at most 3 creatures\. Nothing was spent\./);
  world.dice(1);
  const storm = await play({ action: "Lightning Storm", characterIds: [kara.id] });
  world.clearDice();
  assert.equal(storm.status, 200, JSON.stringify(storm.body));
  assert.equal(enemyActedThisRound(world.encounter(), foe.id), false, "the storm a legendary action bought is not its action");
  assert.equal(pool(), 1);

  nextTurn();
  const cloud = await play({ action: "Ink Cloud" });
  assert.equal(cloud.status, 200, JSON.stringify(cloud.body));
  const zones = getBattleMapForEncounter(world.encounter().id).spellZones;
  assert.ok(zones.some((zone) => zone.spell === "Ink Cloud" && zone.dc === 23), JSON.stringify(zones.map((zone) => zone.spell)));

  nextTurn();
  const loose = await play({ action: "Tentacle Attack or Fling", use: "Fling", targetCharacterId: kara.id });
  assert.equal(loose.status, 409);
  assert.match(loose.body.error, /is not grappled by .*Nothing was spent\./);
  world.patch(kara.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: foe.id } } });
  const from = kit.token(kara.id);
  // A 7 on the d8: thrown west, into the board's edge 25 feet off.
  world.dice(7, 6, 6);
  const flung = await play({ action: "Tentacle Attack or Fling", use: "Fling", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(flung.status, 200, JSON.stringify(flung.body));
  const to = kit.token(kara.id);
  assert.notDeepEqual([to.x, to.y], [from.x, from.y], "thrown");
  assert.deepEqual([to.x, to.y], [0, 5]);
  assert.ok(world.sheet(kara.id).conditions.includes("prone"));
  assert.match(flung.body.result.thrownDamage, /strikes a solid surface and takes 12 bludgeoning damage/, "2d6 for the 20 feet it flew whole");
  assert.equal(world.sheet(kara.id).conditions.includes("grappled"), false, "let go");
});

await test("The tarrasque's Chomp: a bite, or Swallow, which swallows the creature it grapples on a hit", async () => {
  const { world, kara, foe, play } = await facing("Tarrasque");
  world.patch(kara.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: foe.id } } });
  world.dice(19, 6, 6, 6, 6);
  const out = await play({ action: "Chomp", use: "Swallow", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const conditions = world.sheet(kara.id).conditions;
  assert.ok(["blinded", "restrained", "swallowed"].every((name) => conditions.includes(name)) && !conditions.includes("grappled"), conditions.join(", "));
  const said = out.body.result.swallowed ?? out.body.result.swings?.find((swing) => swing.swallowed)?.swallowed;
  // The creature's own Swallow, numbers and all (src/lib/dm/swallow.ts).
  assert.match(said, /is swallowed: .*16d6 acid damage at the start of each of its turns\. 60 damage dealt it from inside/);
});

// "Revert this turn" on the GM's card (src/lib/db/turn-rows.ts): the
// legendary action is a write to the encounter's row, which the turn keeps.
async function revertTurn(world, user, turnId) {
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request("http://odm.test/revert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

await test("A legendary action played from the card goes back with Revert this turn: the action spent, its place at the turn's end, and what its swing did", async () => {
  const { world, kara, gm, play, pool } = await facing("Adult Red Dragon");
  const hp = world.sheet(kara.id).currentHp;
  world.dice(19, 6, 6);
  const out = await play({ action: "Tail Attack", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(pool(), 2);
  assert.ok(world.sheet(kara.id).currentHp < hp, "the tail struck");
  const turnId = listLiveTurnChangeViews(world.campaignId).filter((change) => change.kind === "fight").at(-1)?.turnId;
  assert.ok(turnId, "the card's turn kept the fight's rows");
  const back = await revertTurn(world, gm, turnId);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(pool() ?? 3, 3, "the legendary action is back");
  assert.equal(world.sheet(kara.id).currentHp, hp, "and the tail's damage");
  world.dice(19, 6, 6);
  const again = await play({ action: "Tail Attack", targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(again.status, 200, `it may be taken again at this turn's end: ${JSON.stringify(again.body)}`);
});

finish();
