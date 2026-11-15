// Everyone the party travels with is at its fights
// (src/lib/dm/party-npcs-fight.ts). Live play opened a fight with two wolves
// and Brakk alone on the board, while the captain, two guards and two chained
// prisoners stood around the fire: they shouted orders, nobody could strike
// them, and none of them took a turn.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-party-npcs-fight");
const logic = await import("../src/lib/dm/party-npcs-fight-logic.ts");
const { DEFAULT_NPC_STATE } = await import("../src/lib/dm/npc-state-logic.ts");
const { handleNpcState } = await import("../src/lib/dm/npc-state-tools.ts");
const { upsertNpc, getNpcByName } = await import("../src/lib/db/npcs.ts");
const { standingOn } = await import("../src/lib/dm/combatant.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });
const state = (args) => handleNpcState(world.campaign(), JSON.stringify(args));

// ---- Pure rules ----------------------------------------------------------

await test("a free hand fights as a guard, a prisoner or the disarmed as a commoner, the dead not at all", () => {
  assert.deepEqual(logic.allyField({ ...DEFAULT_NPC_STATE, withParty: true }), { block: "guard", conditions: [], down: false });
  assert.equal(logic.allyField({ ...DEFAULT_NPC_STATE, disarmed: true }).block, "commoner");
  const chained = logic.allyField({ ...DEFAULT_NPC_STATE, custody: "captive", heldBy: "Mara", restraint: "chained" });
  assert.deepEqual(chained, { block: "commoner", conditions: ["restrained", "incapacitated"], down: false }, "in bonds: struck, does nothing");
  assert.deepEqual(logic.allyField({ ...DEFAULT_NPC_STATE, condition: "unconscious" }).conditions, ["unconscious"]);
  assert.equal(logic.allyField({ ...DEFAULT_NPC_STATE, condition: "dead" }), null);
});

await test("what the fight did to an ally is what their record says after it", () => {
  const up = { ...DEFAULT_NPC_STATE, withParty: true };
  assert.equal(logic.stateAfterFight(up, { status: "dead", currentHp: 0 }).condition, "dead");
  assert.equal(logic.stateAfterFight(up, { status: "alive", currentHp: 0 }).condition, "unconscious");
  assert.equal(logic.stateAfterFight(up, { status: "alive", currentHp: 4 }), up);
});

// ---- A fight ------------------------------------------------------------

await test("the captain and the prisoner on the cart are on the board on the party's side; someone left behind is not", async () => {
  upsertNpc({ campaignId: world.campaignId, name: "Capitana Mara" });
  state({ name: "Capitana Mara", withParty: true });
  upsertNpc({ campaignId: world.campaignId, name: "Aldren" });
  state({ name: "Aldren", custody: "captive", heldBy: "Brakk", restraint: "chained" });
  upsertNpc({ campaignId: world.campaignId, name: "Ada", location: "the farm" });
  const fight = await world.beginFight([{ monster: "wolf" }]);
  const rows = encounters.listEnemies(fight.id);
  const mara = rows.find((row) => row.displayName === "Capitana Mara");
  const aldren = rows.find((row) => row.displayName === "Aldren");
  assert.ok(mara && aldren, rows.map((row) => row.displayName).join(", "));
  assert.ok(!rows.some((row) => row.displayName === "Ada"), "someone not with the party is not at its fight");
  assert.equal(mara.npcId, getNpcByName(world.campaignId, "Capitana Mara").id);
  assert.equal(mara.xp, 0, "nobody earns anything for an ally");
  assert.deepEqual(aldren.conditions, ["restrained", "incapacitated"]);
  const party = standingOn(world.campaignId, fight, "party").map((combatant) => combatant.name ?? combatant.id);
  assert.ok(party.some((name) => /Mara/.test(String(name))), `on the party's side: ${party.join(", ")}`);
  const foes = standingOn(world.campaignId, fight, "foe");
  assert.equal(foes.length, 1, "only the wolf is a foe");
  const map = getBattleMapForEncounter(fight.id);
  const tokens = listTokens(map.id);
  assert.ok(tokens.some((token) => token.refId === mara.id), "the captain has a token");
  const hero = tokens.find((token) => token.refId === brakk.id);
  const her = tokens.find((token) => token.refId === mara.id);
  const wolf = tokens.find((token) => token.refId === foes[0].id);
  const far = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  assert.ok(far(her, hero) < far(her, wolf), "she stands with the party, not among the wolves");
  assert.ok(fight.order.some((entry) => entry.enemyId === mara.id) || encounters.getActiveEncounter(world.campaignId).order.some((entry) => entry.enemyId === mara.id), "she has a place in the order");
});

await test("an ally killed in the fight is dead in their record; the wolves still end it as a victory", async () => {
  const fight = world.encounter();
  const rows = encounters.listEnemies(fight.id);
  const mara = rows.find((row) => row.displayName === "Capitana Mara");
  encounters.patchEnemyHp(mara.id, 0, "dead");
  for (const wolf of rows.filter((row) => row.slug === "wolf")) {
    encounters.patchEnemyHp(wolf.id, 0, "dead");
  }
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.ok(ended.ok, JSON.stringify(ended));
  assert.equal(getNpcByName(world.campaignId, "Capitana Mara").state.condition, "dead");
  assert.equal(getNpcByName(world.campaignId, "Aldren").state.condition, "up");
  assert.doesNotMatch(JSON.stringify(ended.result), /bondsClosed/, "an ally is not mourned as a foe");
});

finish();
