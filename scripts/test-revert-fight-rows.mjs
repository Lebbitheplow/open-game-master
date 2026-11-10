// "Revert this turn" puts back what the turn's own calls did to the fight
// and the board (issue 685; src/lib/db/turn-rows.ts keeps each row as the
// turn found it, src/lib/dm/turn-rows-logic.ts says how it goes back), at a
// table a person runs and at one the AI runs:
//   - a creature's hit points, standing, conditions, initiative and place;
//   - a creature the turn brought in, and one a spell called up;
//   - the order of turns and whose turn it is, the legendary actions spent;
//   - an area laid on the board and an effect started;
//   - a fight the turn began goes, as if it never began.
// A row changed again since is asked about first, as a later sheet change
// is, and goes back on yes. Before, the revert put back the sheets and the
// clock alone: a goblin felled in a reverted turn stayed down.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-revert-fight-rows");
const { getEnemy, saveEncounter, setEnemyInitiative } = await import("../src/lib/db/encounters.ts");
const { listLiveTurnChangeViews } = await import("../src/lib/db/turn-changes.ts");
const { listEffects } = await import("../src/lib/db/active-effects.ts");
const { summonsOf } = await import("../src/lib/dm/summon-store.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { setDmMode, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { enqueueDmJob } = await import("../src/lib/dm/queue.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { setBattleMapTerrain } = await import("../src/lib/db/battle-maps.ts");

async function revertTurn(world, turnId, confirm = false) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, ...(confirm ? { confirm: true } : {}) }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

async function snapshot(world) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]");
  const response = await handler.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  return response.json();
}

// The latest turn that kept fight rows.
const lastFightTurn = (world) => listLiveTurnChangeViews(world.campaignId).filter((change) => change.kind === "fight").at(-1)?.turnId;

// ---- a table a person runs ----

const person = await openWorld({ gameSettings: { dmMode: "human", multiCharacter: "all_active", ttsEnabled: false } });
const kit = await combatKit(person);
person.addHero({ class: "fighter", level: 5, maxHp: 300 });
const SLOTS = () => ({ 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } });
const vex = person.addHero({
  user: person.owner,
  name: "Vex",
  class: "wizard",
  level: 5,
  maxHp: 30,
  abilities: { int: 17, dex: 14 },
  spellcasting: { ability: "int", slots: SLOTS(), known: [], prepared: ["Web", "Unseen Servant"], cantrips: [], spellbook: ["Web", "Unseen Servant"] },
});
setDmMode(person.campaignId, "human", person.owner.id);

async function act(body) {
  const handler = await person.route("campaigns/[campaignId]/actions");
  person.signIn(person.owner);
  const response = await handler.POST(new Request("http://odm.test/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "do", ...body }) }), {
    params: Promise.resolve({ campaignId: person.campaignId }),
  });
  return { status: response.status, body: await response.json() };
}

await test("a fight a person's call began goes with that call's revert, asked about first", async () => {
  person.clearDice();
  person.dice(1, 15, 15);
  const started = await person.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  person.clearDice();
  assert.equal(started.ok, true, started.error);
  assert.ok(person.encounter(), "no fight began");
  const asked = await revertTurn(person, started.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /began the fight/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(person, started.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(person.encounter(), null, "the fight the turn began is still on");
});

await kit.fight(2);
const [goblin, other] = person.enemies();

await test("a creature felled in the reverted call stands again with its hit points, and the event log offered that call's revert", async () => {
  const before = getEnemy(goblin.id);
  const felled = await person.invoke("damage_enemy", { enemyId: goblin.id, amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  assert.notEqual(getEnemy(goblin.id).status, "alive");
  const listed = (await snapshot(person)).turnChanges.find((change) => change.turnId === felled.turnId && change.kind === "fight");
  assert.ok(listed, "the event log does not offer the call's revert");
  assert.match(listed.line, /1 creature/);
  const back = await revertTurn(person, felled.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const now = getEnemy(goblin.id);
  assert.equal(now.status, "alive");
  assert.equal(now.currentHp, before.currentHp);
});

await test("a condition, a move on the board and an initiative a call set go back with it", async () => {
  const at = kit.token(other.id);
  const prone = await person.invoke("set_enemy_condition", { enemyId: other.id, condition: "prone" });
  assert.equal(prone.ok, true, prone.error);
  assert.ok(getEnemy(other.id).conditions.includes("prone"));
  assert.equal((await revertTurn(person, prone.turnId)).status, 200);
  assert.deepEqual(getEnemy(other.id).conditions, []);
  const moved = await person.invoke("move_token", { token: other.id, x: at.x - 1, y: at.y });
  assert.equal(moved.ok, true, moved.error);
  assert.equal((await revertTurn(person, moved.turnId)).status, 200);
  assert.deepEqual([kit.token(other.id).x, kit.token(other.id).y], [at.x, at.y], "the creature stayed where the call walked it");
  // The initiative a turn wrote, as the lead's console does through it.
  const initiative = getEnemy(other.id).initiative;
  const turn = createDmTurn(person.campaignId, [], "human_dm");
  runInTurnScope(turn.id, () => setEnemyInitiative(other.id, 25));
  assert.equal((await revertTurn(person, turn.id)).status, 200);
  assert.equal(getEnemy(other.id).initiative, initiative);
});

await test("a creature a call brought in leaves the fight, the board and the order with its revert", async () => {
  const before = person.enemies().map((enemy) => enemy.id);
  const added = await person.invoke("add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(added.ok, true, added.error);
  const [newcomer] = person.enemies().filter((enemy) => !before.includes(enemy.id));
  assert.ok(newcomer, "nobody came in");
  assert.equal((await revertTurn(person, added.turnId)).status, 200);
  assert.equal(getEnemy(newcomer.id), null);
  assert.equal(kit.token(newcomer.id), null);
  assert.ok(!person.encounter().order.some((entry) => entry.enemyId === newcomer.id));
});

await test("each call's line in the log says what it changed once it is done, and a later call's rows a revert wrote over go: it no longer offers to bring back a token without its creature", async () => {
  // The browser pass (scenario 115): the GM added a goblin, then moved it,
  // and reverted the add, yes to the question. The move still offered its
  // revert, which would have set the goblin's token back on the board with no
  // goblin; and a line the GM watched arrive read "The fight changes." until
  // a reload.
  const before = person.enemies().map((enemy) => enemy.id);
  const added = await person.invoke("add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(added.ok, true, added.error);
  const [newcomer] = person.enemies().filter((enemy) => !before.includes(enemy.id));
  const at = kit.token(newcomer.id);
  const moved = await person.invoke("move_token", { token: newcomer.id, x: at.x, y: at.y > 0 ? at.y - 1 : at.y + 1 });
  assert.equal(moved.ok, true, moved.error);
  const lineOf = (turnId) => listLiveTurnChangeViews(person.campaignId).find((change) => change.kind === "fight" && change.turnId === turnId)?.line;
  assert.match(lineOf(added.turnId) ?? "", /^The fight changes: 1 creature, /);
  assert.equal(lineOf(moved.turnId), "The fight changes: 1 token.");
  assert.equal((await revertTurn(person, added.turnId)).status, 409, "the later move is asked about first");
  assert.equal((await revertTurn(person, added.turnId, true)).status, 200);
  assert.equal(kit.token(newcomer.id), null);
  assert.equal(lineOf(moved.turnId), undefined, "the move no longer offers its revert");
  await revertTurn(person, moved.turnId, true);
  assert.equal(kit.token(newcomer.id), null, "no token came back without its goblin");
  assert.equal(getEnemy(newcomer.id), null);
});

await test("the order of turns a call moved on, and the legendary actions a turn spent, go back with it", async () => {
  const { round, turnIndex } = person.encounter();
  const current = person.encounter().order[turnIndex];
  const ended = await person.invoke("end_turn", current.kind === "pc" ? { characterId: current.characterId } : { enemyId: current.enemyId });
  assert.equal(ended.ok, true, ended.error);
  assert.notDeepEqual([person.encounter().round, person.encounter().turnIndex], [round, turnIndex], "the pointer never moved");
  assert.equal((await revertTurn(person, ended.turnId)).status, 200);
  assert.deepEqual([person.encounter().round, person.encounter().turnIndex], [round, turnIndex]);
  const legendary = person.encounter().legendary;
  const turn = createDmTurn(person.campaignId, [], "human_dm");
  runInTurnScope(turn.id, () => saveEncounter({ ...person.encounter(), legendary: { ...legendary, acted: [goblin.id] } }));
  assert.equal((await revertTurn(person, turn.id)).status, 200);
  assert.deepEqual(person.encounter().legendary, legendary);
});

await test("an effect a call started ends with its revert", async () => {
  const set = await person.invoke("set_effect", { enemyId: other.id, name: "Shield of Faith", field: "ac", modifiers: [{ field: "ac", mode: "add", value: 2 }] });
  assert.equal(set.ok, true, set.error);
  assert.ok(listEffects(person.campaignId).some((effect) => effect.name === "Shield of Faith"));
  assert.equal((await revertTurn(person, set.turnId)).status, 200);
  assert.ok(!listEffects(person.campaignId).some((effect) => effect.name === "Shield of Faith"), "the effect outlived the revert");
});

await test("a Web laid on the board and a servant a spell called up go with the GM's card's revert, the slots with them", async () => {
  kit.giveTurn(vex.id);
  kit.place(vex.id, 3, 3);
  const webs = () => kit.map().spellZones.filter((zone) => zone.spell === "Web").length;
  const web = await act({ content: "I cast Web on (9,5) using a level 2 slot.", characterId: vex.id, intent: { card: "spell", spell: "Web", slotLevel: 2, atX: 9, atY: 5 } });
  assert.equal(web.status, 200, JSON.stringify(web.body));
  assert.equal(webs(), 1);
  assert.equal((await revertTurn(person, lastFightTurn(person))).status, 200);
  assert.equal(webs(), 0, "the web outlived the revert");
  assert.equal(person.sheet(vex.id).spellcasting.slots[2].used, 0);
  kit.giveTurn(vex.id);
  const servant = await act({ content: "I cast Unseen Servant using a level 1 slot.", characterId: vex.id, intent: { card: "spell", spell: "Unseen Servant", slotLevel: 1 } });
  assert.equal(servant.status, 200, JSON.stringify(servant.body));
  assert.equal(summonsOf(person.campaignId, vex.id, "Unseen Servant").length, 1);
  const back = await revertTurn(person, lastFightTurn(person), true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(summonsOf(person.campaignId, vex.id, "Unseen Servant").length, 0, "the servant stayed");
});

await test("ground a revert puts back as wall sets whoever has stepped onto it since on open ground, never inside it", async () => {
  kit.openField([[2, 2, "#"]]);
  const board = kit.map();
  const turn = createDmTurn(person.campaignId, [], "human_dm");
  // The turn opens the wall; afterwards a goblin is set down where it stood.
  runInTurnScope(turn.id, () => setBattleMapTerrain(board.id, board.drawnTerrain.replace("#", ".")));
  kit.place(goblin.id, 2, 2);
  assert.equal((await revertTurn(person, turn.id)).status, 200);
  const after = kit.map();
  assert.equal(after.terrain[2 * after.width + 2], "#", "the wall did not come back");
  const at = kit.token(goblin.id);
  assert.notDeepEqual([at.x, at.y], [2, 2], "the goblin was left inside the wall");
});

await test("a summoned creature a call sent away comes back whole with its revert: its sheet, its hit points, its token", async () => {
  kit.giveTurn(vex.id);
  const servant = await act({ content: "I cast Unseen Servant using a level 1 slot.", characterId: vex.id, intent: { card: "spell", spell: "Unseen Servant", slotLevel: 1 } });
  assert.equal(servant.status, 200, JSON.stringify(servant.body));
  const [called] = summonsOf(person.campaignId, vex.id, "Unseen Servant");
  assert.ok(called, "no servant came");
  const hp = person.sheet(called.id).currentHp;
  const struck = await person.invoke("apply_damage", { characterId: called.id, amount: 50, type: "slashing" });
  assert.equal(struck.ok, true, struck.error);
  assert.equal(person.sheet(called.id), null, "the servant was not sent away");
  const back = await revertTurn(person, struck.turnId, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const again = person.sheet(called.id);
  assert.ok(again, "the servant did not come back");
  assert.equal(again.currentHp, hp, "it came back without its hit points");
  assert.equal(summonsOf(person.campaignId, vex.id, "Unseen Servant").length, 1);
  assert.ok(kit.token(called.id), "it came back off the board");
});

await test("a creature a later call changed again is asked about first, and goes back as the reverted call found it on yes", async () => {
  const before = getEnemy(goblin.id).currentHp;
  const first = await person.invoke("damage_enemy", { enemyId: goblin.id, amount: 3 });
  const second = await person.invoke("damage_enemy", { enemyId: goblin.id, amount: 2 });
  assert.equal(first.ok && second.ok, true);
  const asked = await revertTurn(person, first.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => new RegExp(`${goblin.displayName}.* changed again`).test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(person, first.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(getEnemy(goblin.id).currentHp, before);
  await person.invoke("end_encounter", { outcome: "truce" });
});

// ---- a table the AI runs ----

const ai = await openWorld({ gameSettings: { dmMode: "ai", ttsEnabled: false } });
const aiKit = await combatKit(ai);
const aiHero = ai.addHero({ class: "fighter", level: 5, maxHp: 300 });
const model = await fakeModel();
model.pointAt(ai);
await aiKit.fight(2);
const [brute] = ai.enemies();

await test("at an AI table the storyteller's turn is taken back from the fight too: the creature it sent running is back in the fight, the hero it walked stands where they stood, and the order is where the turn found it", async () => {
  const hp = getEnemy(brute.id).currentHp;
  aiKit.giveTurn(aiHero.id);
  aiKit.place(aiHero.id, 4, 4);
  const at = aiKit.token(aiHero.id);
  const { round, turnIndex } = ai.encounter();
  model.script([
    reply({ calls: [call("enemy_flees", { enemyId: brute.id }), call("move_token", { token: aiHero.id, x: at.x + 1, y: at.y })] }),
    reply({ text: "The brute bolts as you step in." }),
  ]);
  const said = await model.turn(ai, "I step forward and roar at the brute.", aiHero.id);
  assert.ok(said?.dmTurnId, "the turn wrote no narration");
  assert.notEqual(getEnemy(brute.id).status, "alive", "the model's call sent nobody running");
  const answers = model.requests.flatMap((request) => model.results(request));
  assert.notDeepEqual([aiKit.token(aiHero.id).x, aiKit.token(aiHero.id).y], [at.x, at.y], `the model's move landed nowhere: ${JSON.stringify(answers).slice(0, 400)}`);
  // Nothing changed since: the revert goes through without a question.
  const back = await revertTurn(ai, said.dmTurnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(getEnemy(brute.id).status, "alive");
  assert.equal(getEnemy(brute.id).currentHp, hp);
  assert.deepEqual([aiKit.token(aiHero.id).x, aiKit.token(aiHero.id).y], [at.x, at.y]);
  assert.deepEqual([ai.encounter().round, ai.encounter().turnIndex], [round, turnIndex]);
});

await test("at an AI table, the turn run by the server's own queue, a token the storyteller's turn moved, moved again since by the GM's own hand, is asked about first", async () => {
  aiKit.giveTurn(aiHero.id);
  aiKit.freshTurn();
  aiKit.place(aiHero.id, 4, 4);
  model.script([reply({ calls: [call("move_token", { token: aiHero.id, x: 5, y: 4 })] }), reply({ text: "You step in." })]);
  // As a player's line sets a turn going on a live server: a queue job, whose
  // end is when the turn's work is done.
  insertCampaignMessage({ campaignId: ai.campaignId, seq: allocateSeq(ai.campaignId), authorType: "player", userId: ai.owner.id, characterId: aiHero.id, content: "I step forward." });
  await enqueueDmJob(ai.campaignId, () => startDmTurn(ai.campaignId));
  const said = listRecentMessages(ai.campaignId, 10).filter((message) => message.authorType === "dm").at(-1);
  assert.ok(said?.dmTurnId, "the queued turn wrote no narration");
  assert.deepEqual([aiKit.token(aiHero.id).x, aiKit.token(aiHero.id).y], [5, 4], "the model's move landed nowhere");
  // The GM drags the token after the turn: no turn of its own.
  aiKit.place(aiHero.id, 6, 6);
  const asked = await revertTurn(ai, said.dmTurnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /'s token changed again/.test(line)), JSON.stringify(asked.json));
  assert.equal((await revertTurn(ai, said.dmTurnId, true)).status, 200);
  assert.deepEqual([aiKit.token(aiHero.id).x, aiKit.token(aiHero.id).y], [4, 4]);
});

model.close();

// ---- the rules, read alone ----

const { planRowsRevert, fightLine, restoredColumns } = await import("../src/lib/dm/turn-rows-logic.ts");

await test("the rules: a row made goes, one taken comes back, one changed is written back; a fight's standing and summary are never a revert's", () => {
  const goblinRow = { id: "g", encounter_id: "e", campaign_id: "c", display_name: "Goblin", current_hp: 7, status: "alive" };
  const fight = { id: "e", campaign_id: "c", status: "active", summary: "", round: 2, turn_index: 1, order_json: "[]" };
  const rows = [
    { table: "encounter_enemies", rowId: "g", before: goblinRow, after: { ...goblinRow, current_hp: 0, status: "dead" }, now: { ...goblinRow, current_hp: 0, status: "dead" }, encounterId: "e" },
    { table: "encounter_enemies", rowId: "n", before: null, after: { ...goblinRow, id: "n" }, now: { ...goblinRow, id: "n" }, encounterId: "e" },
    { table: "battle_tokens", rowId: "t", before: { id: "t", map_id: "m", campaign_id: "c", x: 1, y: 1 }, after: null, now: null, encounterId: "e" },
    { table: "encounters", rowId: "e", before: fight, after: { ...fight, round: 3 }, now: { ...fight, round: 4, status: "ended" }, encounterId: "e" },
  ];
  const plan = planRowsRevert(rows, new Map([["e", { active: true, begunInTurn: false, endedInTurn: false }]]));
  assert.deepEqual(plan.deletes, [{ table: "encounter_enemies", rowId: "n" }]);
  assert.deepEqual(plan.inserts.map((entry) => entry.row.id), ["t"]);
  const goblinBack = plan.updates.find((entry) => entry.rowId === "g").values;
  assert.deepEqual([goblinBack.current_hp, goblinBack.status], [7, "alive"]);
  const fightBack = plan.updates.find((entry) => entry.rowId === "e").values;
  assert.equal(fightBack.round, 2);
  assert.equal("status" in fightBack || "summary" in fightBack, false, "a revert wrote a fight's standing");
  assert.ok(plan.warnings.some((line) => /order of turns changed again/.test(line)), "a change since was not told");
  assert.deepEqual(restoredColumns("encounter_enemies", goblinRow).sort(), ["current_hp", "display_name", "status"]);
});

// WAVE1 maintainer decision on LC-REV-13 (/tmp/odm-gapstudy/WAVE1.md): "a
// turn that ended a fight reopens it (or refuses with a sentence saying why
// it cannot, if reopening is unsafe)". This suite pinned the old rule, that
// a fight the turn ended stays ended with what was done in it.
await test("the rules: a fight begun in the turn goes whole; one it ended opens again, or is refused with another fight on", () => {
  const row = { table: "encounter_enemies", rowId: "g", before: { id: "g", current_hp: 7 }, after: { id: "g", current_hp: 3 }, now: { id: "g", current_hp: 3 }, encounterId: "e" };
  const begun = planRowsRevert([row], new Map([["e", { active: true, begunInTurn: true, endedInTurn: false }]]));
  assert.deepEqual([begun.dropFights, begun.updates], [["e"], []]);
  const ended = planRowsRevert([row], new Map([["e", { active: false, begunInTurn: false, endedInTurn: true }]]));
  assert.deepEqual([ended.dropFights, ended.updates, ended.refusal], [[], [{ table: "encounter_enemies", rowId: "g", values: { current_hp: 7 } }], null]);
  assert.match(ended.warnings.join(" "), /ended the fight: reverting it opens the fight again/);
  const blocked = planRowsRevert([row], new Map([["e", { active: false, begunInTurn: false, endedInTurn: true, blocked: true }]]));
  assert.match(blocked.refusal ?? "", /another fight has begun since/);
  assert.deepEqual(blocked.updates, []);
  const since = planRowsRevert([row], new Map([["e", { active: false, begunInTurn: false, endedInTurn: false }]]));
  assert.deepEqual([since.updates, since.refusal], [[], null]);
  assert.match(since.warnings.join(" "), /has ended since: what the turn did in it stays/);
  assert.equal(fightLine({ encounter_enemies: 2, battle_tokens: 1, encounters: 1 }), "The fight changes: 2 creatures, 1 token and the order of turns.");
});

finish();
