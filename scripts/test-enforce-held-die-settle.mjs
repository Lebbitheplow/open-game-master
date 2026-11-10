// A held Bardic Inspiration or Dark One's Own Luck die on the rolls that
// cannot wait for its holder (src/lib/dm/forced-save.ts heldDieWaits and
// settleHeldDie). SRD 5.1, Bardic Inspiration: the creature "can wait until
// after it rolls the d20 before deciding to use the Bardic Inspiration die".
// The engine decides as the holder would: the die is added once the d20 falls
// short, only when it can carry the roll, and is kept otherwise. Riding every
// roll, it was spent on rolls that passed without it.
//
// One family per test: a save a tool forces, a group check, the party's
// Stealth for an ambush, an attack roll; and the ratchet below keeps every
// other site that rolls with a held die on the same rule.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-held-die-settle");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { characterSave } = await import("../src/lib/dm/between-io.ts");
const { decideAmbush } = await import("../src/lib/dm/encounter-open.ts");

const DIE = "bardic inspiration (d8)";
const hero = world.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { str: 10, dex: 10, con: 10 }, proficiencies: { ...TRAINED, saves: [], skills: [] }, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
const holds = () => world.sheet(hero.id).conditions.includes(DIE);
const give = () => world.patch(hero.id, { conditions: [DIE], conditionMeta: {} });

await test("A save a tool forces (between-io characterSave): kept on a pass and on a hopeless miss, spent where it carries the save.", async () => {
  give();
  world.dice(14);
  assert.equal(characterSave(world.campaign(), world.sheet(hero.id), { ability: "con", dc: 12, detail: "the cold" }).success, true);
  world.clearDice();
  assert.ok(holds(), "a save that passes keeps the die: this was the bug");
  world.dice(2);
  assert.equal(characterSave(world.campaign(), world.sheet(hero.id), { ability: "con", dc: 12, detail: "the cold" }).success, false);
  world.clearDice();
  assert.ok(holds(), "a d8 cannot lift 2 to 12: kept");
  world.dice(7, 6);
  assert.equal(characterSave(world.campaign(), world.sheet(hero.id), { ability: "con", dc: 12, detail: "the cold" }).success, true);
  world.clearDice();
  assert.ok(!holds(), "7 and the d8's 6 make 13: spent on it");
});

await test("A group check: the die is spent only on the member it carries.", async () => {
  give();
  world.dice(15);
  const passed = await world.invoke("group_check", { ability: "str", dc: 12, characterIds: [hero.id] });
  world.clearDice();
  assert.equal(passed.ok, true, passed.error);
  assert.ok(holds(), "a member who passes keeps the die");
  world.dice(8, 5);
  const carried = await world.invoke("group_check", { ability: "str", dc: 12, characterIds: [hero.id] });
  assert.equal(carried.ok, true, carried.error);
  // Inside a GM's call the roll waits on its player, who adds the die
  // (src/lib/dm/character-roll.ts; the 2026-11-09 gap sweep's findings
  // dice-afterroll-*): it was added for them before. Outside one (the saves
  // above, the ambush below) it is still settled for them.
  const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
  const { call } = await import("./lib/enforce-campaign.mjs");
  const card = listOpenPendingRolls(world.campaignId).find((pending) => pending.thrown?.options.some((option) => option.id === "bardic"));
  assert.ok(card, "the 8 waits on the die its player holds");
  world.signIn({ id: hero.userId });
  const added = await call(await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"), "POST", { use: "bardic" }, { campaignId: world.campaignId, pendingRollId: card.id });
  world.clearDice();
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.ok(!holds(), "8 and 5 make 13: spent");
});

await test("The party's Stealth for an ambush: kept when it already beats every watcher, spent when it lifts the roll past them.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [hero.id]: 10 } });
  const enemies = world.enemies();
  await kit.endFight();
  give();
  world.dice(19);
  decideAmbush(world.campaign(), "party", enemies, [world.sheet(hero.id)]);
  world.clearDice();
  assert.ok(holds(), "a Stealth that already hides keeps the die");
  world.dice(3, 8);
  decideAmbush(world.campaign(), "party", enemies, [world.sheet(hero.id)]);
  world.clearDice();
  assert.ok(!holds(), "3 and 8 make 11, past a goblin's watch: spent");
});

// The engine settles an attack's die only for a seat an agent plays, which has
// no card to press; a player's own seat decides after the roll
// (scripts/test-enforce-after-roll-attacks.mjs).
const { createConnectionGrant, revokeConnectionGrant } = await import("../src/lib/agents/grants.ts");
const asAgentSeat = () => {
  const userId = world.sheet(hero.id).userId;
  const { grant } = createConnectionGrant({ userId, name: "seat", scopes: ["play"], campaignId: world.campaignId });
  return () => revokeConnectionGrant(userId, grant.id);
};

await test("An agent's attack roll: kept on a hit and on a miss it cannot save, spent on the miss it turns into a hit; never on a natural 1.", async () => {
  const revoke = asAgentSeat();
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, ac: 15 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  const swing = async (faces) => {
    kit.giveTurn(hero.id);
    const out = await kit.swing(hero.id, enemy.id, faces, { weapon: "Longsword" });
    assert.equal(out.ok, true, out.error);
    return out;
  };
  give();
  await swing([17, 4]);
  assert.ok(holds(), "a hit keeps the die: it rode every attack before");
  await swing([2]);
  assert.ok(holds(), "a d8 cannot lift 5 to 15: kept");
  await swing([1]);
  assert.ok(holds(), "a natural 1 misses whatever is added");
  await swing([9, 6, 4]);
  assert.ok(!holds(), "9 + 3 = 12 misses, and the d8's 6 makes 18: spent on the miss it saves");
  await kit.endFight();
  revoke();
});

await test("An agent's parked to-hit roll (a seat that holds its rolls) takes the die the same way when it lands.", async () => {
  const revoke = asAgentSeat();
  const { call } = await import("./lib/enforce-campaign.mjs");
  const { listOpenPendingRolls, getPendingRoll } = await import("../src/lib/db/dm-turns.ts");
  const { getRoll } = await import("../src/lib/db/rolls.ts");
  const prefs = await world.route("campaigns/[campaignId]/members/me");
  const pendingRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
  const owner = world.sheet(hero.id).userId;
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, ac: 15 });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  // Held from here, once the order is set: initiative would park too.
  world.signIn({ id: owner });
  assert.ok((await call(prefs, "PATCH", { holdRolls: true }, { campaignId: world.campaignId })).status < 300);
  const parkedSwing = async (faces) => {
    kit.giveTurn(hero.id);
    const out = await kit.attack(hero.id, enemy.id, { weapon: "Longsword" });
    assert.equal(out.ok, true, out.error);
    const [pending] = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "attack");
    assert.ok(pending, "the to-hit roll parks");
    world.signIn({ id: owner });
    world.dice(...faces);
    const landed = await call(pendingRoute, "POST", { fallback: "digital" }, { campaignId: world.campaignId, pendingRollId: pending.id });
    world.clearDice();
    assert.equal(landed.status, 200);
    for (const left of listOpenPendingRolls(world.campaignId)) {
      world.dice(1);
      await call(pendingRoute, "POST", { fallback: "digital" }, { campaignId: world.campaignId, pendingRollId: left.id });
      world.clearDice();
    }
    return getRoll(getPendingRoll(pending.id).rollId);
  };
  give();
  await parkedSwing([17]);
  assert.ok(holds(), "a parked hit keeps the die");
  const saved = await parkedSwing([9, 6]);
  assert.ok(!holds(), "9 + 3 = 12 misses, the d8's 6 makes 18: spent");
  assert.equal(saved.total, 18);
  assert.ok(!saved.detail.includes("physical"));
  await call(prefs, "PATCH", { holdRolls: false }, { campaignId: world.campaignId });
  await kit.endFight();
  revoke();
});

// Every site in src/lib/dm that rolls a d20 with what a roll carries
// (resolveRollExpression's spendInspiration) settles a held die after the
// d20 or says why it cannot: initiative takes no held die, and these have no
// target to judge the die against.
const NO_TARGET = new Map([
  ["contest-roll.ts", "rollCharacterCheck with no DC, and initiative"],
  ["encounter-open.ts", "initiative"],
  ["invoke-roll.ts", "the after-the-roll card waits on the player instead"],
]);

await test("Every site that rolls with a held die settles it after the d20, or names why it cannot.", () => {
  const dir = path.join(import.meta.dirname, "../src/lib/dm");
  const missing = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const sites = (text.match(/spendRollCarriers\([^)]*resolved\.spendInspiration\)/g) ?? []).length;
    // Settled by the site, or by the one door a character's d20 is thrown
    // through (character-roll.ts), told to with settleHeldDie or settle.
    const settled = (text.match(/settleHeldDie[(:]|\bsettle: /g) ?? []).length;
    if (sites > settled && !NO_TARGET.has(file)) {
      missing.push(`${file}: ${sites} rolls with carriers, ${settled} settled`);
    }
  }
  assert.deepEqual(missing, []);
});

world.close();
finish();
