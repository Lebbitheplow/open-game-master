// A creature's Parry on a dark board. SRD 5.1's Bandit Captain: "adds 2 to its
// AC against one melee attack that would hit it. To do so, the captain must see
// the attacker." The attack already gets its advantage from what the light lets
// the creature see (attack-light.ts); Parry reads the same answer.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-parry-in-the-dark");
const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const maps = await import("../src/lib/db/battle-maps.ts");
const { clearLitTilesCache } = await import("../src/lib/battlemap/lit-cache.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

// Attacks at +6, so a d20 of 7 is a 13 against the dummy's AC 13. No darkvision.
const fighter = world.addHero({
  class: "fighter", level: 5, maxHp: 300, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});

const plainFeatures = world.sheet(fighter.id).features;

const PARRY = "Reaction: Parry. The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon.";
const SHIELD = { dc: 15, ability: "int", casterLevel: 9, spells: [{ name: "Shield", level: 1 }], slots: { 1: 3 } };
const IN_THE_DARK = { passivePerception: 10, darkvision: 60 };

async function stage(stats = {}) {
  await kit.endFight();
  world.patch(fighter.id, { currentHp: 300, conditions: [], conditionMeta: {}, features: plainFeatures });
  await kit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, stats });
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, fighter.id);
  return kit.enemy(enemy.id);
}

// Night under a roof: no ambient light, no lamps, no torches.
function lightsOut() {
  const board = kit.map();
  maps.setBattleMapOutdoors(board.id, false);
  getDatabase().prepare(`UPDATE battle_maps SET ambient = 'dark', lights_json = '[]', zones_json = '[]' WHERE id = ?`).run(board.id);
  for (const token of maps.listTokens(board.id)) {
    maps.setTokenLight(token.id, 0);
  }
  clearLitTilesCache();
}

function lightsOn() {
  getDatabase().prepare(`UPDATE battle_maps SET ambient = 'bright' WHERE id = ?`).run(kit.map().id);
  clearLitTilesCache();
}

const reactionSpent = (enemy) => world.encounter().reactionsUsed.includes(enemy.id);

async function land(pending, faces) {
  world.signIn({ id: fighter.userId });
  const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return getPendingRoll(pending.id).combatNote ?? "";
}

async function parkAndLand(enemy, faces, before = () => {}) {
  setMemberRealDice(world.campaignId, fighter.userId, true);
  try {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const parked = await world.invoke("pc_attack", { characterId: fighter.id, targetEnemyId: enemy.id, weapon: "Longsword" });
    assert.equal(parked.ok, true, parked.error);
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === "attack" && !earlier.has(entry.id));
    assert.ok(pending, "the to-hit roll is parked");
    before();
    return await land(pending, faces);
  } finally {
    setMemberRealDice(world.campaignId, fighter.userId, false);
  }
}

// The three ways a character's attack meets a Parry. Each returns whether the
// attack hit. Neither side sees in the dark unless the test says so, so the
// disadvantage and the advantage cancel and the attack rolls one d20; with a
// creature that does see, the attacker's disadvantage means two.
const PATHS = {
  "on real dice": async (enemy, faces) => /HIT/.test(await parkAndLand(enemy, faces)),
  "on the server's dice": async (enemy, faces) => {
    const blow = await kit.swing(fighter.id, enemy.id, [...faces, 5], { weapon: "Longsword" });
    assert.equal(blow.ok, true, blow.error);
    return blow.result.hit === true;
  },
  // A character who cannot see the creature makes no opportunity attack at all,
  // so this one sees in the dark. A creature that cannot see them gives the
  // attack advantage, and the first two faces are its d20s; one that can leaves
  // one d20, and the Parry leaves the rest unread.
  "on an opportunity attack": async (enemy) => {
    world.patch(fighter.id, { features: [...plainFeatures, { name: "Darkvision", description: "" }] });
    world.clearDice();
    world.dice(7, 7, 5);
    const before = kit.enemy(enemy.id).currentHp;
    resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
    world.clearDice();
    return kit.enemy(enemy.id).currentHp < before;
  },
};

for (const [path, swing] of Object.entries(PATHS)) {
  await test(`A creature that cannot see in the dark does not Parry a hit ${path}`, async () => {
    const enemy = await stage({ traits: [PARRY] });
    lightsOut();
    assert.equal(await swing(enemy, [7]), true, "the 13 hits AC 13");
    assert.ok(!reactionSpent(enemy), "the reaction stays");
  });

  await test(`A creature with darkvision still Parries a hit in the dark ${path}`, async () => {
    const enemy = await stage({ traits: [PARRY], senses: IN_THE_DARK });
    lightsOut();
    assert.equal(await swing(enemy, [7, 7]), false, "the Parry turns the 13");
    assert.ok(reactionSpent(enemy), "the reaction went on it");
  });

  await test(`On a lit board the same creature Parries a hit ${path}`, async () => {
    const enemy = await stage({ traits: [PARRY] });
    assert.equal(await swing(enemy, [7]), false, "the Parry turns the 13");
    assert.ok(reactionSpent(enemy), "the reaction went on it");
  });
}

await test("A creature under True Seeing Parries a hit in the dark, as it sees through it", async () => {
  const enemy = await stage({ traits: [PARRY] });
  kit.setEnemy(enemy.id, { conditions: ["True Seeing"] });
  lightsOut();
  // It sees and the attacker does not, so the attack is at disadvantage: two d20s.
  const note = await parkAndLand(enemy, [7, 7]);
  assert.match(note, /MISS/, note);
  assert.ok(reactionSpent(enemy), "the reaction went on it");
});

await test("A creature with no token on the board still Parries, as nothing says it cannot see", async () => {
  const enemy = await stage({ traits: [PARRY] });
  lightsOut();
  maps.deleteToken(maps.getTokenByRef(kit.map().id, enemy.id).id);
  const note = await parkAndLand(enemy, [7]);
  assert.match(note, /MISS/, note);
  assert.ok(reactionSpent(enemy), "the reaction went on it");
});

await test("Shield still answers a hit in the dark, since it needs no sight of the attacker", async () => {
  const enemy = await stage({ spellcasting: SHIELD });
  lightsOut();
  const note = await parkAndLand(enemy, [7]);
  assert.match(note, /casts Shield/, note);
  assert.match(note, /MISS/, note);
});

await test("With real dice, the light when the attack is made decides, not the light when the roll lands", async () => {
  const dark = await stage({ traits: [PARRY] });
  lightsOut();
  const unseen = await parkAndLand(dark, [7], lightsOn);
  assert.match(unseen, /HIT/, unseen);
  assert.ok(!reactionSpent(dark), "unseen when it was made");

  const lit = await stage({ traits: [PARRY] });
  lightsOn();
  const seen = await parkAndLand(lit, [7], lightsOut);
  assert.match(seen, /MISS/, seen);
  assert.ok(reactionSpent(lit), "seen when it was made");
});

await finish();
