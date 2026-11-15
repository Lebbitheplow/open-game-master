// The NPC state sheet (docs/specs/ogm-npc-state.md): the server keeps whether
// a tracked NPC is free or a prisoner, what holds them, and whether they
// stand or are down, and the GM reads it on the roster every turn. Before it,
// a prisoner taken at a mill stayed "at the mill" in the record while the
// party marched him off, and was forgotten.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, call } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-npc-state");
const logic = await import("../src/lib/dm/npc-state-logic.ts");
const { handleNpcState, npcStateTools } = await import("../src/lib/dm/npc-state-tools.ts");
const { rankNpcsForPrompt } = await import("../src/lib/dm/npc-rank-logic.ts");
const mind = await import("../src/lib/dm/npc-mind.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const { upsertNpc, getNpcByName } = await import("../src/lib/db/npcs.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true } });
const model = await fakeModel();
model.pointAt(world);
const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });

const state = (args) => handleNpcState(world.campaign(), JSON.stringify(args));
const sheetOf = (name) => getNpcByName(world.campaignId, name).state;

// ---- Pure rules ----------------------------------------------------------

await test("a row written before the sheet reads as free, unbound and standing", () => {
  for (const raw of ["", null, undefined, "not json", "[]", '{"custody":"sideways"}']) {
    assert.deepEqual(logic.parseNpcState(raw), logic.DEFAULT_NPC_STATE);
  }
  assert.equal(logic.serializeNpcState(logic.DEFAULT_NPC_STATE), "", "the default keeps an empty column");
  assert.equal(logic.npcStateWords(logic.DEFAULT_NPC_STATE), "");
});

await test("a declared change keeps what it does not name, and freeing removes the bonds", () => {
  const taken = logic.applyNpcStatePatch(logic.DEFAULT_NPC_STATE, { custody: "captive", heldBy: "Mara", restraint: "bound" });
  assert.deepEqual(taken.state, { custody: "captive", heldBy: "Mara", restraint: "bound", condition: "up" });
  const hurt = logic.applyNpcStatePatch(taken.state, { condition: "wounded" });
  assert.equal(hurt.state.heldBy, "Mara");
  assert.equal(logic.npcStateWords(hurt.state), "prisoner of Mara, bound, wounded");
  const freed = logic.applyNpcStatePatch(hurt.state, { custody: "free" });
  assert.deepEqual(freed.state, { custody: "free", heldBy: "", restraint: "none", condition: "wounded" });
  const handed = logic.applyNpcStatePatch(taken.state, { heldBy: "Brakk" });
  assert.equal(handed.state.heldBy, "Brakk", "a new keeper alone hands the prisoner over");
});

await test("a prisoner needs a keeper, and the dead stay dead", () => {
  assert.match(logic.applyNpcStatePatch(logic.DEFAULT_NPC_STATE, { custody: "captive" }).error, /heldBy/);
  const dead = logic.applyNpcStatePatch(logic.DEFAULT_NPC_STATE, { condition: "dead" }).state;
  assert.match(logic.applyNpcStatePatch(dead, { condition: "up" }).error, /dead/);
  assert.match(logic.applyNpcStatePatch(dead, { restraint: "bound" }).error, /dead/);
  assert.equal(logic.npcSilencedBy(dead), "dead");
  assert.equal(logic.npcSilencedBy({ ...logic.DEFAULT_NPC_STATE, condition: "unconscious" }), "unconscious");
  assert.equal(logic.npcSilencedBy({ ...logic.DEFAULT_NPC_STATE, condition: "wounded" }), "");
});

await test("a prisoner stays near the roster's head wherever the record puts them", () => {
  const roster = [
    { name: "Far Away", location: "Roccanera" },
    { name: "Rugo", location: "the old mill", inView: true },
    { name: "Here", location: "the square" },
  ];
  assert.deepEqual(
    rankNpcsForPrompt(roster, { location: "the square", text: "" }).map((npc) => npc.name),
    ["Rugo", "Here", "Far Away"],
  );
});

// ---- The tool ------------------------------------------------------------

await test("npc_state records a prisoner and refuses what it cannot apply, writing nothing", () => {
  upsertNpc({ campaignId: world.campaignId, name: "Uomo armato", location: "the old mill" });
  assert.ok(npcStateTools.some((tool) => tool.function.name === "npc_state"));
  const unknown = state({ name: "Nobody Here", custody: "free" });
  assert.equal(unknown.retry, true);
  assert.equal(state({ name: "Uomo armato" }).retry, true, "nothing changed is a call to fix");
  assert.equal(state({ name: "Uomo armato", restraint: "handcuffed" }).retry, true, "a value off the list");
  assert.match(state({ name: "Uomo armato", custody: "captive" }).error, /heldBy/);
  assert.deepEqual(sheetOf("Uomo armato"), logic.DEFAULT_NPC_STATE, "refusals wrote nothing");
  const taken = state({ name: "Uomo armato", custody: "captive", heldBy: "Mara", restraint: "bound" });
  assert.equal(taken.ok, true);
  assert.equal(taken.state, "prisoner of Mara, bound");
  assert.equal(sheetOf("Uomo armato").heldBy, "Mara");
  const freed = state({ name: "Uomo armato", custody: "free" });
  assert.equal(freed.state, "free and on their feet");
  assert.equal(getDatabase().prepare("SELECT state_json FROM npcs WHERE name = ?").get("Uomo armato").state_json, "");
});

await test("the senseless and the dead neither speak nor hear", async () => {
  const row = upsertNpc({ campaignId: world.campaignId, name: "Vell" });
  minds.setNpcTier(row.id, "primary");
  state({ name: "Vell", condition: "unconscious" });
  const spoken = await mind.handleNpcSpeak(world.campaign(), JSON.stringify({ name: "Vell", perceives: "Brakk shakes you." }));
  assert.equal(spoken.refused, "rules");
  assert.match(spoken.error, /unconscious/);
  const heard = mind.handleNpcHear(world.campaign(), JSON.stringify({ speaker: "Brakk", words: "Wake up.", listeners: [{ name: "Vell", reach: "near" }] }));
  assert.deepEqual(heard.heard, []);
  assert.deepEqual(heard.missed, ["Vell"]);
  assert.equal(minds.listNpcMemories(world.campaignId, row.id).length, 0, "nothing reached a senseless mind");
});

// ---- A whole turn --------------------------------------------------------

await test("the GM sees the prisoner on the roster on the next turn, with the tool on offer", async () => {
  assert.ok(dmTurnToolCatalogue(world.campaign()).some((tool) => tool.function.name === "npc_state"));
  upsertNpc({ campaignId: world.campaignId, name: "Aldren", location: "" });
  model.script([
    reply({ calls: [call("npc_state", { name: "Aldren", custody: "captive", heldBy: "Mara", restraint: "chained" })] }),
    reply({ text: "Mara snaps the irons shut on Aldren's wrists." }),
  ]);
  await model.turn(world, "We chain Aldren.", brakk.id);
  assert.equal(sheetOf("Aldren").restraint, "chained");
  model.script([reply({ text: "The road is quiet." })]);
  await model.turn(world, "We walk on.", brakk.id);
  const system = model.requests.at(-1).messages.map((message) => String(message.content ?? "")).join("\n");
  assert.match(system, /- Aldren: [a-z]+, prisoner of Mara, in chains/);
  assert.match(system, /call npc_state in the same reply/);
});

model.close();
finish();
