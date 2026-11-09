// A player character is walked, and their turn spent, only for what their
// player's words ask (src/lib/dm/player-word.ts, player-word-logic.ts).
// The 0.34.0 report: on a narrow staircase the GM offered "hold still", the
// player answered "hold still", and the AI opened a fight in the same reply
// and called pc_attack for Kara with approach. Her pre-fight words counted as
// her turn, so the server walked her 30 feet through two opportunity attacks
// (4 damage) toward a goblin still out of reach, and the swing was refused.
//   - words from before the fight declare a turn only when they name
//     something done in it: the AI waits for the player, nothing is spent;
//   - a hold keeps the character where they stand: pc_attack's approach,
//     move_token and a Dash toward someone all refuse to walk them, and
//     nothing is spent or moved;
//   - a hold with nothing else declares no action, but the turn may end;
//   - a line that only asks a question declares nothing.
// What stays: an attack named before the fight, a charge declared in it, and
// the console's free hand. At a table in another language the words are read
// once by the utility model and the same rules follow.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-player-hold");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const ai = await aiEngine(world);
const { characterAwaitingPlayer, characterHeld } = await import("../src/lib/dm/player-word.ts");
const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");

const hero = (overrides) => world.addHero({ maxHp: 60, proficiencies: TRAINED, ...overrides });
const kara = hero({ name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
const brom = hero({ name: "Brom", class: "fighter", level: 5, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
const roster = [kara, brom];
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

// Kara first, the goblin four squares off: out of reach, within her walk.
async function fightOn(goblinAt = { x: 5, y: 9 }) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(roster.map((entry) => [entry.id, entry.id === kara.id ? 20 : 3]));
  await kit.fight(1, { heroFaces });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 400 });
  kit.place(kara.id, 5, 5);
  kit.place(brom.id, 1, 1);
  kit.place(goblin.id, goblinAt.x, goblinAt.y);
  assert.equal(kit.current().characterId, kara.id);
  ai.fresh();
  return goblin;
}

const where = () => {
  const token = kit.token(kara.id);
  return [token.x, token.y];
};
const state = () => JSON.stringify({ at: where(), hp: world.sheet(kara.id).currentHp, budget: world.encounter().turnBudget });
const approach = (goblin) => ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword", approach: true });

await test("The report: 'hold still' said before the AI opened the fight is no turn: pc_attack with approach waits for the player, and Kara is neither walked nor hit.", async () => {
  await kit.endFight();
  world.say("dm", "The hatch above you creaks. You could hold still, or climb toward it.");
  world.say("player", "hold still", kara);
  await pause();
  const goblin = await fightOn();
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, kara.id, "GAME STATE waits on Kara's player");
  assert.equal(characterHeld(world.campaignId)?.id, kara.id, "GAME STATE says she holds still");
  const before = state();
  const out = await approach(goblin);
  assert.equal(out.ok, false);
  assert.match(out.error, /^Kara has not acted: their player spoke before this fight began and named nothing Kara does in it\. Nothing was spent\./);
  assert.equal(state(), before, "nothing walked, hit or spent");
  // The turn is hers to play once she speaks in it.
  const ended = await ai.invoke("end_turn", { characterId: kara.id });
  assert.equal(ended.ok, false, "her turn is not ended for her either");
});

await test("An attack named before the fight is still her turn: the AI walks her in and swings.", async () => {
  await kit.endFight();
  world.say("dm", "Three goblins spill out of the hatch.");
  world.say("player", "I charge the goblin!", kara);
  await pause();
  const goblin = await fightOn();
  assert.equal(characterAwaitingPlayer(world.campaignId), null);
  world.clearDice();
  world.dice(15, 4);
  const out = await approach(goblin);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(out.result.approached, "the walk came with the swing");
  assert.notDeepEqual(where(), [5, 5]);
});

await test("A hold in the fight with an attack: no walk by approach, move_token or a Dash toward the goblin, and nothing is spent.", async () => {
  const goblin = await fightOn();
  world.say("dm", "The goblin hangs back on the stairs. Kara?");
  world.say("player", "I hold my ground and swing at anything that comes close.", kara);
  assert.equal(characterAwaitingPlayer(world.campaignId), null, "she declared an action");
  assert.equal(characterHeld(world.campaignId)?.id, kara.id);
  const before = state();
  const swing = await approach(goblin);
  assert.equal(swing.ok, false);
  assert.match(swing.error, /Kara's player said Kara stays where they are \("hold my ground"\), so the server will not walk them\. Nothing was moved or attacked\./);
  const walk = await ai.invoke("move_token", { token: kara.id, x: 5, y: 8 });
  assert.equal(walk.ok, false);
  assert.match(walk.error, /stays where they are .* Nothing was moved\./);
  const dash = await ai.invoke("take_action", { characterId: kara.id, action: "dash", toward: goblin.id });
  assert.equal(dash.ok, false);
  assert.match(dash.error, /stays where they are .* Nothing was spent\./);
  assert.equal(state(), before, "nothing walked, hit or spent");
  // A swing at a foe in reach is what she asked for.
  kit.place(goblin.id, 5, 6);
  world.clearDice();
  world.dice(15, 4);
  const near = await ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(near.ok, true, near.error);
});

await test("A hold and nothing else: no action is taken for her, but her turn may end.", async () => {
  const goblin = await fightOn({ x: 5, y: 6 });
  world.say("dm", "The goblin snarls beside you. Kara?");
  world.say("player", "I hold still.", kara);
  const before = state();
  const swing = await ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  assert.equal(swing.ok, false);
  assert.match(swing.error, /^Kara has not acted: their player said Kara stays where they are and named nothing else\. Nothing was spent\. If that is all Kara does, end_turn ends the turn/);
  assert.equal(state(), before);
  const ended = await ai.invoke("end_turn", { characterId: kara.id });
  assert.equal(ended.ok, true, ended.error);
  assert.notEqual(kit.current().characterId, kara.id);
});

await test("A question is no action: 'Is the goblin still on the stairs?' spends nothing for her.", async () => {
  const goblin = await fightOn({ x: 5, y: 6 });
  world.say("dm", "Something moves on the stairs. Kara?");
  world.say("player", "Is the goblin still on the stairs?", kara);
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, kara.id);
  const swing = await ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  assert.equal(swing.ok, false);
  assert.match(swing.error, /only asked a question this turn/);
});

await test("A charge declared in the fight still walks her in.", async () => {
  const goblin = await fightOn();
  world.say("dm", "The goblin jeers from the stairs. Kara?");
  world.say("player", "I close in on the goblin and stab it.", kara);
  world.clearDice();
  world.dice(15, 4);
  const out = await approach(goblin);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(out.result.approached);
});

await test("At a table in another language the words are read once by the utility model: a hold read there keeps her still.", async () => {
  const model = await fakeModel();
  await model.pointAt(world);
  updateGameSettings(world.campaignId, { ...world.campaign().gameSettings, tableLanguage: "spanish" });
  try {
    const goblin = await fightOn();
    world.say("dm", "El goblin espera en la escalera. ¿Kara?");
    world.say("player", "Me quedo quieta y corto a quien se acerque.", kara);
    model.script([reply({ text: '{"acts":true,"holds":true}' })]);
    const before = state();
    const swing = await approach(goblin);
    assert.equal(swing.ok, false);
    assert.match(swing.error, /stays where they are/);
    assert.equal(state(), before);
    assert.equal(model.requests.length, 1, "one reading of the words");
    // The reading is kept: the next call reads nothing.
    const walk = await ai.invoke("move_token", { token: kara.id, x: 5, y: 8 });
    assert.equal(walk.ok, false);
    assert.equal(model.requests.length, 1);
  } finally {
    updateGameSettings(world.campaignId, { ...world.campaign().gameSettings, tableLanguage: "english" });
    model.close();
  }
});

await finish();
world.close?.();
