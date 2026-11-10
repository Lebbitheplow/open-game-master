// Gap sweep, package `dice`, part 3: the stop before a watched d20.
//
// Portent (Divination wizard 2, src/lib/srd/subclasses.json): "You can
// replace any attack roll, saving throw, or ability check made by you or a
// creature that you can see with one of these foretelling rolls. You must
// choose to do so before the roll."
//
// "Before the roll" is the watch (src/lib/dm/foresight.ts): with a watcher
// on, the AI's turn holds a call that is about to throw a d20 and asks first.
// foresight.ts rollAbout decides which calls those are, by a list of six tool
// names it keeps by hand, reading each call's arguments its own way.
//
// This suite walks the tools instead. Each row is one tool with one shape of
// arguments a model sends (an id, a name where the handler takes one, a
// target list by ids or by names), played as a whole AI turn against a
// scripted model with a Portent holder watching and every creature in sight.
// A spy on the dice says whether a d20 was thrown. A row ends STOPPED (the
// turn parked on the watcher before any d20), UNWATCHED (a d20 of a creature
// in sight was thrown and the watcher was never asked), or QUIET (no d20).
// Every row that throws must stop; the ones that do not are in KNOWN.
import assert from "node:assert/strict";
import { call as routeCall } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { d20sOf, installDiceSpy } from "./lib/sweep-dice.mjs";

// A scripted model answers in request order, so nothing but the turn may ask
// it anything. Past 120 messages the server compacts the transcript in the
// background (src/lib/dm/compaction.ts COMPACT_THRESHOLD) with two model
// calls of its own, and whichever row was running when the count crossed the
// line lost its scripted tool call to them: the turn then got the closing
// narration, made no call, and the row read as throwing nothing. The count
// depends on how earlier rows' dice fell, so it moved from run to run. Read
// when compaction.ts loads, which openWorld's first import of src/ brings on.
process.env.DM_COMPACT_THRESHOLD ??= "1000000";
const { test, gap, finish } = suite("test-enforce-sweep-dice-windows");
const spy = installDiceSpy();
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");
const route = {
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  toggle: await world.route("campaigns/[campaignId]/foresight"),
};
const DEBUG = Boolean(process.env.ODM_SWEEP_DEBUG);
const ONLY = process.env.ODM_SWEEP_ONLY ? new RegExp(process.env.ODM_SWEEP_ONLY) : null;

const seerUser = world.addUser("seer");
const karaUser = world.addUser("kara");
// The watcher's player is at the table: one who has left is not stopped for.
subscribe(world.campaignId, () => {}, seerUser.id);
const seer = world.addHero({ user: seerUser, name: "Seer", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 } });
const CASTING = {
  ability: "wis",
  slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
  prepared: ["Bless", "Guiding Bolt", "Hold Person", "Cure Wounds"],
  known: [],
  cantrips: ["Sacred Flame", "Fire Bolt"],
};
const GEAR = [{ name: "Longsword", qty: 1, equipped: true }, { name: "Component pouch", qty: 1 }];
const kara = world.addHero({ user: karaUser, name: "Kara", class: "cleric", level: 5, maxHp: 44, abilities: { str: 16, dex: 12, wis: 16 }, proficiencies: TRAINED, equipment: GEAR, spellcasting: CASTING });

let goblin;
let far;
const stops = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "watch");

async function stage() {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  await kit.endFight();
  world.patch(seer.id, { currentHp: 30, conditions: [], conditionMeta: {}, features: [{ name: "Portent", source: "subclass" }], resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3], watchingEncounterId: null });
  world.patch(kara.id, { currentHp: 44, conditions: [], conditionMeta: {}, spellcasting: CASTING, equipment: GEAR, concentration: null });
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [seer.id]: 12 } });
  [goblin, far] = world.enemies();
  for (const enemy of [goblin, far]) kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400 });
  kit.place(kara.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(seer.id, 5, 3);
  kit.place(far.id, 9, 6);
  world.signIn(seerUser);
  const on = await routeCall(route.toggle, "POST", { on: true, characterId: seer.id }, { campaignId: world.campaignId });
  if (on.status !== 200) throw new Error(`the watch did not turn on: ${JSON.stringify(on.json)}`);
  spy.take();
  world.clearDice();
}

// One AI turn that makes one call. `who`: whose turn the call is made on.
async function play(entry) {
  await stage();
  const c = { karaId: kara.id, seerId: seer.id, goblinId: goblin.id, goblinName: goblin.displayName, farId: far.id };
  if (entry.setup) entry.setup(c);
  const args = entry.args(c);
  const encounter = world.encounter();
  model.script(entry.tool ? [reply({ calls: [call(entry.tool, args)] }), reply({ text: "It is done." })] : [reply({ text: "The goblin snarls and bides its time." })]);
  spy.take();
  if (entry.who === "enemy") {
    saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === goblin.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
    world.say("system", "The goblins press in.");
    await startDmTurn(world.campaignId);
  } else {
    kit.giveTurn(kara.id);
    world.say("dm", "A chandelier hangs low over the goblin, its rope tied off within reach.");
    await model.turn(world, entry.line ?? "I attack the goblin with my longsword, now.", kara.id, karaUser.id);
  }
  const before = d20sOf(spy.take());
  const [stop] = stops();
  const told = model.requests.at(-1)?.messages.filter((message) => message.role === "tool").at(-1)?.content ?? "";
  const verdict = stop && !before.length ? "STOPPED" : before.length ? "UNWATCHED" : "QUIET";
  if (stop) {
    world.signIn(seerUser);
    await routeCall(route.watch, "POST", { pass: true }, { campaignId: world.campaignId, pendingRollId: stop.id });
  }
  await settleQueue(world.campaignId);
  const threw = [...new Set(before.map((die) => `${die.file.replace("src/lib/dm/", "")}#${die.fn}${die.purpose ? `<${die.purpose.roller}/${die.purpose.kind}>` : "<untagged>"}`))];
  // Every request the script answered must be the turn's own (it carries the
  // tools): anything else took a reply meant for the turn.
  const stray = model.requests.filter((request) => !request.tools?.length);
  if (stray.length) {
    throw new Error(`${entry.id}: a request that was not the turn's took a scripted reply: ${String(stray[0].messages[0]?.content).slice(0, 120)}`);
  }
  if (DEBUG) {
    console.log(`  ${verdict.padEnd(9)} ${entry.id} threw=${threw.join(",")} told=${String(told).slice(0, 150)}`);
  }
  return { verdict, threw, told };
}

// ---- the rows ----

const rows = [];
const row = (id, tool, who, args, extra = {}) => rows.push({ id, tool, who, args, ...extra });
const SAVE = { saveAbility: "dex", dc: 12, damage: "2d6", halfOnSave: true };

// A creature's acts, on its turn.
row("enemy_attack.ids", "enemy_attack", "enemy", (c) => ({ enemyId: c.goblinId, targetCharacterId: c.karaId }));
row("enemy_attack.enemy_by_name", "enemy_attack", "enemy", (c) => ({ enemyId: c.goblinName, targetCharacterId: c.karaId }));
row("enemy_attack.target_by_name", "enemy_attack", "enemy", (c) => ({ enemyId: c.goblinId, targetCharacterId: "Kara" }));
row("cast_at_player.enemy_ability", "cast_at_player", "enemy", (c) => ({ characterId: c.karaId, casterEnemyId: c.goblinId, enemyAbility: "Web", saveAbility: "dex", dc: 12, condition: "restrained" }));
row("cast_at_player.hazard", "cast_at_player", "enemy", (c) => ({ characterId: c.karaId, source: "a poison needle", saveAbility: "con", dc: 10, damage: "1d4", damageType: "poison" }));
row("cast_at_player.character_by_name", "cast_at_player", "enemy", () => ({ characterId: "Kara", source: "a poison needle", saveAbility: "con", dc: 10, damage: "1d4", damageType: "poison" }));
row("aoe_damage.enemy.character_ids", "aoe_damage", "enemy", (c) => ({ casterEnemyId: c.goblinId, enemyAbility: "Fire Breath", ...SAVE, type: "fire", characterIds: [c.karaId] }));
row("aoe_damage.enemy.targets_by_name", "aoe_damage", "enemy", (c) => ({ casterEnemyId: c.goblinId, enemyAbility: "Fire Breath", ...SAVE, type: "fire", targets: "Kara" }));
row("aoe_damage.enemy.two_characters", "aoe_damage", "enemy", (c) => ({ casterEnemyId: c.goblinId, enemyAbility: "Fire Breath", ...SAVE, type: "fire", characterIds: [c.karaId, c.seerId] }));
row("apply_hazard.generic_save", "apply_hazard", "enemy", (c) => ({ type: "generic", characterIds: [c.karaId], ...SAVE, damageType: "fire", reason: "a gout of flame from the wall" }));
row("apply_hazard.trap", "apply_hazard", "enemy", (c) => ({ type: "trap", trap: "Poison Needle", characterIds: [c.karaId], reason: "the lock bites" }));
row("move_token.enemy_leaves_reach", "move_token", "enemy", (c) => ({ token: c.goblinId, x: 5, y: 12, reason: "it runs" }));
// A creature's turn the model narrates and never plays: the server plays it
// (the enemy-turn backstop), with the same dice.
row("backstop.enemy_turn_unplayed", null, "enemy", () => ({}));
// A character's acts, on their turn and on their player's word.
row("move_token.hero_leaves_reach", "move_token", "hero", (c) => ({ token: c.karaId, x: 5, y: 1, reason: "she falls back" }), { line: "I fall back from the goblin, straight to the north wall." });
row("pc_attack.ids", "pc_attack", "hero", (c) => ({ characterId: c.karaId, targetEnemyId: c.goblinId, weapon: "Longsword" }));
row("pc_attack.character_by_name", "pc_attack", "hero", (c) => ({ characterId: "Kara", targetEnemyId: c.goblinId, weapon: "Longsword" }));
row("pc_attack.enemy_by_name", "pc_attack", "hero", (c) => ({ characterId: c.karaId, targetEnemyId: c.goblinName, weapon: "Longsword" }));
row("pc_attack.spell", "pc_attack", "hero", (c) => ({ characterId: c.karaId, targetEnemyId: c.goblinId, spell: "Fire Bolt" }), { line: "I cast Fire Bolt at the goblin." });
row("cast_at_enemy.save_spell", "cast_at_enemy", "hero", (c) => ({ characterId: c.karaId, targetEnemyId: c.goblinId, spell: "Sacred Flame" }), { line: "I cast Sacred Flame at the goblin." });
row("cast_at_enemy.enemy_by_name", "cast_at_enemy", "hero", (c) => ({ characterId: c.karaId, targetEnemyId: c.goblinName, spell: "Sacred Flame" }), { line: "I cast Sacred Flame at the goblin." });
row("cast_at_enemy.hold_person", "cast_at_enemy", "hero", (c) => ({ characterId: c.karaId, targetEnemyId: c.goblinId, spell: "Hold Person" }), { line: "I cast Hold Person on the goblin." });
row("request_roll.skill.ids", "request_roll", "hero", (c) => ({ characterId: c.karaId, kind: "skill_check", skill: "athletics", dc: 12, reason: "forcing the door" }), { line: "I put my shoulder to the door and force it." });
row("request_roll.skill.by_name", "request_roll", "hero", () => ({ characterId: "Kara", kind: "skill_check", skill: "athletics", dc: 12, reason: "forcing the door" }), { line: "I put my shoulder to the door and force it." });
row("request_roll.save", "request_roll", "hero", (c) => ({ characterId: c.karaId, kind: "saving_throw", ability: "con", dc: 12, reason: "the gas" }), { line: "I hold my breath and push through the gas." });
row("request_roll.ability", "request_roll", "hero", (c) => ({ characterId: c.karaId, kind: "ability_check", ability: "str", dc: 12, reason: "the bars" }), { line: "I bend the bars." });
row("request_roll.contest", "request_roll", "hero", (c) => ({ characterId: c.karaId, kind: "skill_check", skill: "stealth", againstEnemyId: c.goblinId, reason: "slipping past" }), { line: "I slip past the goblin." });
row("group_check.one", "group_check", "hero", (c) => ({ skill: "athletics", dc: 10, characterIds: [c.karaId], reason: "over the wall" }), { line: "I climb the wall." });
row("damage_object.weapon", "damage_object", "hero", (c) => ({ name: "the door", material: "wood", size: "medium", characterId: c.karaId, weapon: "Longsword", reason: "breaking it" }), { line: "I hack at the door with my longsword." });
const HERO_ACTION = {
  grapple: (c) => ({ targetEnemyId: c.goblinId }),
  shove: (c) => ({ targetEnemyId: c.goblinId, shove: "prone" }),
  search: () => ({ skill: "perception" }),
  hide: () => ({}),
  escape: () => ({}),
  improvise: (c) => ({ skill: "athletics", difficulty: "moderate", targetEnemyId: c.goblinId, scene: "the chandelier", distanceFt: 5 }),
};
const HERO_ACTION_SETUP = {
  hide: (c) => [c.goblinId, c.farId].forEach((id) => kit.setEnemy(id, { conditions: ["blinded"] })),
  escape: (c) => world.patch(kara.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: c.goblinId, sourceName: "Goblin", escapeDc: 12 } } }),
};
// Every action the form offers that this sweep knows makes a check; the
// form's other actions are checked to exist below, so a new one is noticed.
const QUIET_ACTIONS = ["dodge", "dash", "disengage", "help", "ready", "use_object", "pin"];
for (const action of Object.keys(HERO_ACTION)) {
  row(`take_action.hero_${action}`, "take_action", "hero", (c) => ({ characterId: c.karaId, action, reason: "the sweep", ...HERO_ACTION[action](c) }), { line: `I use my action to ${action}${action === "improvise" ? " by cutting the chandelier's rope so it falls on the goblin" : " the goblin"}.`, setup: HERO_ACTION_SETUP[action] });
}

// ---- what is known ----

const PORTENT = '"You can replace any attack roll, saving throw, or ability check made by you or a creature that you can see with one of these foretelling rolls. You must choose to do so before the roll." (Portent, src/lib/srd/subclasses.json; the watch is its moment: src/lib/dm/foresight.ts)';
// The watched tools are read from the roll sites now (foresight.ts
// watchStopForRoll, held-call.ts): a held call stops before the d20 its tag
// says a watcher may answer. Left: the turn the server plays itself after the
// model has spoken, which no held call carries.
const KNOWN = {
  "backstop.enemy_turn_unplayed": { rule: PORTENT, where: "src/lib/dm/turn.ts (the enemy-turn backstop plays the creature's attack outside parkForWatch)", severity: "medium", note: "a creature's turn the model narrates and never plays is played by the server, whose enemy_attack is never held for the watcher" },
};
// Rows that throw no d20, and why.
const QUIET = {};

const tally = { STOPPED: 0, UNWATCHED: 0, QUIET: 0 };
for (const entry of rows) {
  if (ONLY && !ONLY.test(entry.id)) continue;
  const known = KNOWN[entry.id];
  const run = async () => {
    const got = await play(entry);
    tally[got.verdict] += 1;
    return got;
  };
  if (known) {
    await gap(`windows.${entry.id}`, known, async () => {
      const got = await run();
      if (got.verdict === "QUIET") throw new Error(`${entry.id} is a known gap and its row no longer throws a d20: ${String(got.told).slice(0, 300)}`);
      assert.equal(got.verdict, "STOPPED", `${entry.tool} threw ${got.threw.join(", ")} with a Portent holder watching and never stopped`);
    });
  } else if (QUIET[entry.id]) {
    await test(`${entry.id}: throws no d20 (${QUIET[entry.id]})`, async () => {
      const got = await run();
      assert.equal(got.verdict, "QUIET", `${entry.id} was expected to throw nothing and ${got.verdict}: ${got.threw.join(", ")}`);
    });
  } else {
    await test(`${entry.id}: the turn stops for the watcher before the d20`, async () => {
      const got = await run();
      assert.equal(got.verdict, "STOPPED", `${entry.id}: ${got.verdict} ${got.threw.join(", ")} ${got.verdict === "QUIET" ? String(got.told).slice(0, 300) : ""}`);
    });
  }
}

await test("take_action's form offers no action this sweep has not placed", () => {
  const offered = ADJUDICATIONS.find((entry) => entry.name === "take_action").fields.find((field) => field.name === "action").options.map((option) => option.value);
  const unplaced = offered.filter((action) => !HERO_ACTION[action] && !QUIET_ACTIONS.includes(action));
  assert.deepEqual(unplaced, [], `actions with no row and no reason: ${unplaced.join(", ")}`);
});

console.log(`rows: ${rows.length} ${JSON.stringify(tally)}`);
model.close();
world.close();
finish();
