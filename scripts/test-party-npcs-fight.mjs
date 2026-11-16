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

await test("whether an ally strikes is theirs: a turn nobody played, they hold; a first-tier one's mind chooses first", async () => {
  const tools = await import("../src/lib/dm/encounter-tools.ts");
  const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
  const mind = await import("../src/lib/dm/npc-mind.ts");
  const minds = await import("../src/lib/db/npc-minds.ts");
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
  const fight = world.encounter();
  const rows = encounters.listEnemies(fight.id);
  const mara = rows.find((row) => row.displayName === "Capitana Mara");
  const wolf = rows.find((row) => row.slug === "wolf");
  // Live play: the lieutenant shouted «Nobody strike!», the garrison's men
  // held, and the captain swung at once because the server swung for her.
  const sheets = world.sheets();
  onPersonsTurn(world.campaign(), (turn) => tools.autoActSkippedEnemies(world.campaign(), turn, world.encounter(), [mara.id], sheets, new Map(sheets.map((sheet) => [sheet.id, sheet]))));
  const { listRecentMessages } = await import("../src/lib/db/messages.ts");
  const note = listRecentMessages(world.campaignId, 5).map((message) => message.content).find((content) => /resolve automatically/.test(content)) ?? "";
  assert.match(note, /Capitana Mara does not attack this turn/, note);
  assert.equal(encounters.listEnemies(fight.id).find((row) => row.id === wolf.id).currentHp, wolf.currentHp, "the server did not swing for her");
  const minded = { ...world.campaign(), gameSettings: { ...world.campaign().gameSettings, npcMinds: true } };
  minds.setNpcTier(mara.npcId, "primary");
  const swing = JSON.stringify({ enemyId: mara.id, targetCharacterId: wolf.id });
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => {
    assert.match(mind.mindTurnRefusal(minded, "enemy_attack", swing)?.error ?? "", /npc_speak for Capitana Mara first/);
    assert.equal(mind.mindTurnRefusal(minded, "enemy_attack", JSON.stringify({ enemyId: wolf.id, targetCharacterId: brakk.id })), null, "a wolf is not asked");
    assert.equal(mind.mindTurnRefusal(world.campaign(), "enemy_attack", swing), null, "without minds the narrator plays her");
  });
  minds.setNpcTier(mara.npcId, "secondary");
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

await test("some of the party go on: who travels with it stays behind, is not at the fight there, and comes when all go", async () => {
  const sven = world.addHero({ name: "Sven", race: "human", class: "fighter" });
  assert.ok((await world.invoke("move_party", { name: "Cortile" })).ok);
  upsertNpc({ campaignId: world.campaignId, name: "Teren" });
  state({ name: "Teren", withParty: true });
  assert.equal(getNpcByName(world.campaignId, "Teren").location, "Cortile");
  // Live play: Brakk went to the gate with two soldiers; the captain, her
  // guards and the prisoners on the cart were dragged there with him.
  assert.ok((await world.invoke("move_party", { name: "Porta", characterIds: [brakk.id] })).ok);
  assert.equal(getNpcByName(world.campaignId, "Teren").location, "Cortile", "a split leaves him where he was");
  assert.equal(getNpcByName(world.campaignId, "Aldren").location, "Cortile", "and the prisoner on the cart");
  const fight = await world.beginFight([{ monster: "wolf" }]);
  const names = encounters.listEnemies(fight.id).map((row) => row.displayName);
  assert.ok(!names.includes("Teren") && !names.includes("Aldren"), `left in the courtyard, not at the gate's fight: ${names.join(", ")}`);
  for (const row of encounters.listEnemies(fight.id)) {
    encounters.patchEnemyHp(row.id, 0, "dead");
  }
  assert.ok((await world.invoke("end_encounter", { outcome: "victory" })).ok);
  assert.ok((await world.invoke("move_party", { name: "Cortile", characterIds: [brakk.id, sven.id] })).ok);
  assert.ok((await world.invoke("move_party", { name: "Strada" })).ok);
  assert.equal(getNpcByName(world.campaignId, "Teren").location, "Strada", "the whole party moving takes him along again");
});

finish();
