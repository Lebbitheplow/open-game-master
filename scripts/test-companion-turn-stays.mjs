// A companion under a player's orders keeps its turn after its action, as the
// player's own character does (issue 761, src/lib/dm/encounter-tools.ts
// markResolvedFromArgs and src/lib/dm/aoe-damage.ts). The GM cast its spell,
// said it could still move, and the turn passed before the player answered:
// the action marked the whole turn resolved, whoever played the companion.
//   - Every action below leaves a commanded companion's turn open, its
//     commander's order walks it after, and End Turn ends it.
//   - The GM's end_turn still ends it when the commander is done.
//   - A companion the GM plays still has its turn end with the action, so the
//     backstop does not act it twice.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-companion-turn-stays");

const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { createDmTurn, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");

registerDmWaker(() => {});

const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};

// A one-player table the AI runs: Kara, then Tamsin, a companion wizard
// (commanded by the owner when `commanded`), then two goblins beside her. The
// turn is Tamsin's.
async function table({ commanded = true } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", abilities: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  const bot = createCompanionUser("Tamsin");
  const made = createSheet(world.campaignId, bot.id, 5, {
    ...world.sheet(kara.id),
    name: "Tamsin",
    ...wizard(5, { spellcasting: { prepared: ["Hold Person", "Web", "Fireball"] } }),
    abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
    proficiencies: TRAINED,
    equipment: [{ name: "Dagger", qty: 1 }, { name: "Component pouch", qty: 1 }],
    hitDice: { die: "d6", total: 5, spent: 0 },
  });
  markSheetAsCompanion(made.id, "party", "steady");
  setCompanionCommander(made.id, commanded ? world.owner.id : null);
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  const [goblin, second] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 400, currentHp: 300 });
  kit.setEnemy(second.id, { maxHp: 400, currentHp: 300 });
  kit.place(made.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(second.id, 6, 6);
  kit.place(kara.id, 4, 6);
  assert.equal(kit.endTurn(world.owner.id), true, "Kara's turn ends");
  assert.equal(current(world)?.characterId, made.id, "the turn is Tamsin's");
  return { world, kit, kara, tamsin: world.sheet(made.id), goblin, second };
}

// That DM turn's narration posted and the turn order settled, as finalize()
// does.
function dmTurnEnds(world, turn) {
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "dm", content: "Tamsin can still move." });
  tools.advanceAfterTurn(world.campaign(), getDmTurn(turn.id));
}

const ACTIONS = [
  ["an attack", ({ tamsin, goblin }) => ["pc_attack", { characterId: tamsin.id, attacks: [{ targetEnemyId: goblin.id, weapon: "Dagger" }] }]],
  ["a spell at one creature", ({ tamsin, goblin }) => ["cast_at_enemy", { characterId: tamsin.id, targetEnemyId: goblin.id, spell: "Hold Person", level: 2 }]],
  ["an area spell that holds them", ({ tamsin, goblin, second }) => ["aoe_damage", { casterCharacterId: tamsin.id, spell: "Web", level: 2, enemyIds: [goblin.id, second.id] }]],
  ["an area spell that burns them", ({ tamsin, goblin, second }) => ["aoe_damage", { casterCharacterId: tamsin.id, spell: "Fireball", level: 3, enemyIds: [goblin.id, second.id] }]],
  ["the Help action", ({ tamsin, goblin, kara }) => ["take_action", { characterId: tamsin.id, action: "help", targetEnemyId: goblin.id, targetCharacterId: kara.id }]],
];

for (const [label, build] of ACTIONS) {
  await test(`A commanded companion keeps its turn after ${label}, and End Turn ends it`, async () => {
    const setup = await table();
    const { world, kit, tamsin } = setup;
    world.say("player", `Tamsin: ${label}.`, world.sheet(tamsin.id));
    const turn = createDmTurn(world.campaignId, [], "ai");
    const [name, args] = build(setup);
    const done = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
    assert.equal(done.ok, true, done.error);
    dmTurnEnds(world, turn);
    assert.equal(current(world)?.characterId, tamsin.id, "the turn passed before the commander answered");
    assert.equal(
      listRecentMessages(world.campaignId, 10).some((message) => /It is now Kara's turn/.test(message.content)),
      false,
      "the table was told the turn moved on",
    );
    assert.equal(kit.endTurn(world.owner.id), true, "the commander ends the turn");
    assert.notEqual(current(world)?.characterId, tamsin.id);
  });
}

await test("A commanded companion's order after its spell walks it on the same turn", async () => {
  const { world, tamsin, goblin, second } = await table();
  world.say("player", "Tamsin casts Web.", world.sheet(tamsin.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  const cast = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "aoe_damage", args: { casterCharacterId: tamsin.id, spell: "Web", level: 2, enemyIds: [goblin.id, second.id] } });
  assert.equal(cast.ok, true, cast.error);
  dmTurnEnds(world, turn);

  world.say("player", "Tamsin walks back.", world.sheet(tamsin.id));
  const next = createDmTurn(world.campaignId, [], "ai");
  const walk = await invokeEngine(world.campaign(), { kind: "ai", turnId: next.id }, { name: "move_token", args: { token: tamsin.id, x: 2, y: 2 } });
  assert.equal(walk.ok, true, walk.error);
});

await test("The GM's end_turn ends a commanded companion's turn once its commander is done", async () => {
  const { world, tamsin, goblin } = await table();
  world.say("player", "Tamsin stabs the goblin, and that is all.", world.sheet(tamsin.id));
  const turn = createDmTurn(world.campaignId, [], "ai");
  await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "pc_attack", args: { characterId: tamsin.id, attacks: [{ targetEnemyId: goblin.id, weapon: "Dagger" }] } });
  const ended = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "end_turn", args: { characterId: tamsin.id } });
  assert.equal(ended.ok, true, ended.error);
  dmTurnEnds(world, turn);
  assert.notEqual(current(world)?.characterId, tamsin.id);
});

for (const [label, build] of ACTIONS) {
  await test(`A companion the GM plays has its turn end with ${label}`, async () => {
    const setup = await table({ commanded: false });
    const { world, tamsin } = setup;
    const turn = createDmTurn(world.campaignId, [], "ai");
    const [name, args] = build(setup);
    const done = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
    assert.equal(done.ok, true, done.error);
    dmTurnEnds(world, turn);
    assert.notEqual(current(world)?.characterId, tamsin.id, "the turn stayed on a companion nobody at the table plays");
    assert.equal(
      listRecentMessages(world.campaignId, 20).some((message) => /^Tamsin's turn resolves automatically/.test(message.content)),
      false,
      "the backstop acted it a second time",
    );
  });
}

finish();
