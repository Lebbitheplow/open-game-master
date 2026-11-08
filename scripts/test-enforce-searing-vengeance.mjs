// Searing Vengeance (The Celestial 14): "When you would make a death save,
// rise instead at half hit points, blinding and burning enemies within 30
// feet for 2d8 + Charisma radiant damage; recharges on a long rest."
//
// A dying hero's death save is rolled as the initiative pointer walks past
// their turn, so the warlock's turn was given away with the save, and the
// feature was a counter the GM spent by hand. Now the pointer stops on a
// warlock who can rise, the rise is the start of their turn, and they act on
// it; one who cannot rise (the use spent, another class) is walked past and
// saves as before. Out of a fight the save game time rolls is answered too.
//
// Every die that matters is forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { setDmMode } = await import("../src/lib/db/campaigns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { rollDeathSave } = await import("../src/lib/dm/death.ts");
const { registerDmWaker } = await import("../src/lib/dm/wake.ts");
await import("../src/lib/dm/loop.ts");

const { test, finish } = suite("test-enforce-searing-vengeance");
registerDmWaker(() => {});

const ALIVE = { successes: 0, failures: 0, stable: false, dead: false };
const COUNTER = "sub_searing_vengeance";

// Order: Tamsin (20, whose turn it is), the warlock (15, dying), Goblin 1
// (10) 10 feet from the warlock, Goblin 2 (5) across the board.
async function stage({ warlock = { class: "warlock", subclass: "The Celestial", level: 14 }, used = 0 } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 6 } });
  const kit = await combatKit(world);
  const tamsin = world.addHero({ name: "Tamsin", abilities: { dex: 10, con: 10, wis: 10 } });
  const ilsa = world.addHero({ name: "Ilsa", maxHp: 60, abilities: { dex: 10, con: 10, wis: 10, cha: 18 }, ...warlock });
  await kit.fight(2);
  assert.ok(setDmMode(world.campaignId, "human", world.owner.id)?.dmUserId, "a person takes the GM's seat");
  const [g1, g2] = world.enemies();
  const named = [[g1, "Goblin 1", 10], [g2, "Goblin 2", 5]];
  for (const [enemy, name, initiative] of named) {
    getDatabase().prepare(`UPDATE encounter_enemies SET display_name = ?, initiative = ? WHERE id = ?`).run(name, initiative, enemy.id);
  }
  const order = [
    { kind: "pc", characterId: tamsin.id, userId: tamsin.userId, name: "Tamsin", initiative: 20 },
    { kind: "pc", characterId: ilsa.id, userId: ilsa.userId, name: "Ilsa", initiative: 15 },
    { kind: "enemy", enemyId: g1.id, name: "Goblin 1", initiative: 10 },
    { kind: "enemy", enemyId: g2.id, name: "Goblin 2", initiative: 5 },
  ];
  kit.saveEncounter({ ...world.encounter(), order, turnIndex: 0, round: 2, surprisedIds: [], turnBudget: null });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  const resources = world.sheet(ilsa.id).resources;
  world.patch(ilsa.id, {
    currentHp: 0,
    deathSaves: { ...ALIVE },
    conditions: ["unconscious", "prone"],
    conditionMeta: {},
    ...(resources[COUNTER] ? { resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used } } } : {}),
  });
  const board = kit.map();
  kit.place(tamsin.id, 0, 0);
  kit.place(ilsa.id, 4, 4);
  kit.place(g1.id, 6, 4);
  kit.place(g2.id, board.width - 1, board.height - 1);
  return { world, kit, tamsin, ilsa, g1, g2 };
}

const saves = (world, id) => listRecentRolls(world.campaignId, 50).filter((roll) => roll.characterId === id && /death save/.test(roll.detail ?? ""));
const current = (world) => world.encounter().order[world.encounter().turnIndex];

await test("A Celestial warlock of 14th level holds the one use.", async () => {
  const { world, ilsa } = await stage();
  assert.deepEqual(world.sheet(ilsa.id).resources[COUNTER], { max: 1, used: 0 });
  world.close();
});

await test("The pointer stops on the dying warlock, who rises at half hit points on their feet instead of saving, burns and blinds the goblin within 30 feet, and keeps the turn.", async () => {
  const { world, tamsin, ilsa, g1, g2 } = await stage();
  world.dice(4, 4);
  assert.equal(tools.endOwnTurn(world.campaignId, tamsin.userId), true, "Tamsin ends her turn");
  world.clearDice();
  assert.equal(current(world).characterId, ilsa.id, "Ilsa's turn");
  const sheet = world.sheet(ilsa.id);
  assert.equal(sheet.currentHp, 30, "half of 60");
  assert.equal(sheet.deathSaves, null);
  assert.ok(!sheet.conditions.includes("unconscious") && !sheet.conditions.includes("prone"), JSON.stringify(sheet.conditions));
  assert.equal(sheet.resources[COUNTER].used, 1);
  assert.equal(saves(world, ilsa.id).length, 0, "no death save was rolled");
  const burned = world.enemies().find((enemy) => enemy.id === g1.id);
  assert.equal(burned.currentHp, 40 - (8 + 4), "2d8 + CHA radiant");
  assert.ok(burned.conditions.includes("blinded"));
  const far = world.enemies().find((enemy) => enemy.id === g2.id);
  assert.equal(far.currentHp, 40, "beyond 30 feet");
  world.close();
});

await test("With the use spent, the pointer walks past the dying warlock and the death save is rolled as before.", async () => {
  const { world, tamsin, ilsa } = await stage({ used: 1 });
  world.dice(15);
  tools.endOwnTurn(world.campaignId, tamsin.userId);
  world.clearDice();
  assert.notEqual(current(world)?.characterId, ilsa.id, "Ilsa's turn is passed");
  assert.equal(saves(world, ilsa.id).length, 1, "the save is rolled");
  assert.equal(world.sheet(ilsa.id).currentHp, 0);
  assert.equal(world.sheet(ilsa.id).deathSaves.successes, 1);
  world.close();
});

await test("A dying hero of another class is walked past and saves.", async () => {
  const { world, tamsin, ilsa } = await stage({ warlock: { class: "fighter", level: 14 } });
  world.dice(15);
  tools.endOwnTurn(world.campaignId, tamsin.userId);
  world.clearDice();
  assert.notEqual(current(world)?.characterId, ilsa.id);
  assert.equal(saves(world, ilsa.id).length, 1);
  world.close();
});

await test("Out of a fight, the save game time rolls is the rise too.", async () => {
  const { world, kit, ilsa } = await stage();
  await kit.endFight();
  world.patch(ilsa.id, { currentHp: 0, deathSaves: { ...ALIVE }, conditions: ["unconscious", "prone"] });
  const line = rollDeathSave(world.campaign(), ilsa.id);
  assert.match(String(line), /Searing Vengeance/);
  assert.equal(world.sheet(ilsa.id).currentHp, 30);
  assert.equal(saves(world, ilsa.id).length, 0);
  world.close();
});

finish();
