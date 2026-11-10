// Gap sweep, package `dice`, part 1 through the AI's own turn: issue #896.
//
// "Auto Die Roll Happened When Physical Dice: ON" (issue #896, 0.33.0, an AI
// Game Master on qwen3.6-35b): a skill check came off the server's dice at a
// table whose player rolls physical dice. The reporter expected "it would
// pause and ask me to report what I rolled with my physical die", which is
// what the seat is told (src/lib/dice/held-rolls.ts REAL_DICE_SCOPE): "You
// roll your attacks and their damage, initiative, and the checks and saves
// the GM asks for."
//
// scripts/test-enforce-sweep-dice-sites.mjs finds the tools that throw a
// seat's d20 by calling the engine. This suite plays the same rows as whole
// AI turns: the player's line, then a scripted model that answers it with one
// tool call, as a model does. Each row is a tool a model reaches for when a
// player tries something whose outcome is in doubt. A spy on the dice says
// whether the server threw the seat's d20 (THROWN) or a card went to the seat
// with nothing thrown (PARKED). Every row must park; the ones that throw are
// the paths of #896, in KNOWN.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { d20sOf, formArgs, installDiceSpy, taggedFor } from "./lib/sweep-dice.mjs";

// A scripted model answers in request order, so nothing but the turn may ask
// it anything. Past 120 messages the server compacts the transcript in the
// background (src/lib/dm/compaction.ts COMPACT_THRESHOLD) with two model
// calls of its own, and whichever row was running when the count crossed the
// line lost its scripted tool call to them: the turn then got the closing
// narration, made no call, and the row read as throwing nothing. The count
// depends on how earlier rows' dice fell, so it moved from run to run. Read
// when compaction.ts loads, which openWorld's first import of src/ brings on.
process.env.DM_COMPACT_THRESHOLD ??= "1000000";
const { test, gap, finish } = suite("test-enforce-sweep-dice-turn");
const spy = installDiceSpy();
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed", ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const DEBUG = Boolean(process.env.ODM_SWEEP_DEBUG);

// The owner's own character, on physical dice: an AI table of one.
const hero = world.addHero({ name: "Dicey", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 14, cha: 14 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }], gold: 200 });
// The seat's d20s from sites that do not say whose they are (the sites
// suite's UNTAGGED_HERO_SITES): the only character at this table is the seat.
const mine = (dice) => d20sOf(dice).filter((die) => taggedFor(die, hero.name) || (!die.purpose && !/roll-gates|action-common|roll-card|enemy-|npc/.test(die.file)));

let made = 0;
async function prepare(name) {
  setMemberRealDice(world.campaignId, hero.userId, false);
  const form = adjudication(name);
  made += 1;
  const out = await world.invoke(name, { ...formArgs(form, { heroId: hero.id }), name: `Turn ${made}`, title: `Turn ${made}` });
  if (!out.ok) throw new Error(`set-up ${name} refused: ${out.error}`);
  return `Turn ${made}`;
}

const rows = [
  { id: "request_roll.skill_check", line: "I search the desk for a hidden drawer.", tool: "request_roll", args: () => ({ characterId: hero.id, kind: "skill_check", skill: "investigation", dc: 12, reason: "searching the desk" }) },
  { id: "request_roll.saving_throw", line: "I grit my teeth and wade through the fumes.", tool: "request_roll", args: () => ({ characterId: hero.id, kind: "saving_throw", ability: "con", dc: 12, reason: "the fumes" }) },
  { id: "group_check", line: "I creep along the wall, keeping low.", tool: "group_check", args: () => ({ skill: "stealth", dc: 12, characterIds: [hero.id], reason: "creeping along the wall" }) },
  { id: "social_check.persuade", line: "I lean on the bar and talk the innkeeper into letting us use the cellar: it is in her interest, and I say why.", tool: "social_check", setup: () => prepare("set_npc"), args: (name) => ({ characterId: hero.id, npc: name, approach: "persuade", reason: "the cellar" }) },
  { id: "social_check.intimidate", line: "I grab the innkeeper by the collar and tell her to open the cellar or else.", tool: "social_check", setup: () => prepare("set_npc"), args: (name) => ({ characterId: hero.id, npc: name, approach: "intimidate", reason: "the cellar" }) },
  { id: "haggle", line: "I haggle hard over the price of the rope.", tool: "haggle", setup: () => prepare("open_shop"), args: (name) => ({ characterId: hero.id, shop: name, skill: "persuasion" }) },
  { id: "scene_check", line: "I vault the cart and keep running after the thief.", tool: "scene_check", setup: () => prepare("start_scene"), args: () => ({ characterId: hero.id, skill: "athletics", dc: 12, approach: "vaulting the cart" }) },
  { id: "take_action.search", fight: true, line: "I use my action to search the room for the lever.", tool: "take_action", args: () => ({ characterId: hero.id, action: "search", skill: "perception", reason: "the lever" }) },
  { id: "take_action.shove", fight: true, line: "I shove the goblin to the ground.", tool: "take_action", args: (_, enemy) => ({ characterId: hero.id, action: "shove", targetEnemyId: enemy.id, shove: "prone", reason: "knocking it down" }) },
  { id: "pc_attack", fight: true, line: "I swing my longsword at the goblin.", tool: "pc_attack", args: (_, enemy) => ({ characterId: hero.id, targetEnemyId: enemy.id, weapon: "Longsword" }) },
  { id: "start_encounter.initiative", line: "I kick the door in and charge the goblin inside.", tool: "start_encounter", args: () => ({ enemies: [{ monster: "goblin", count: 1 }] }) },
];

// None left: every check tool throws the seat's d20 through
// src/lib/dm/character-roll.ts, which holds the call for its card.
const KNOWN = {
};

async function play(entry) {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  setMemberRealDice(world.campaignId, hero.userId, false);
  await kit.endFight();
  await world.invoke("end_scene", {});
  world.patch(hero.id, { currentHp: 44, conditions: [], conditionMeta: {} });
  let enemy = null;
  if (entry.fight) {
    await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
    [enemy] = world.enemies();
    kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400 });
    kit.place(hero.id, 5, 5);
    kit.place(enemy.id, 5, 6);
  }
  const name = entry.setup ? await entry.setup() : null;
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  setMemberRealDice(world.campaignId, hero.userId, true);
  model.script([reply({ calls: [call(entry.tool, entry.args(name, enemy))] }), reply({ text: "The moment hangs." })]);
  spy.take();
  await model.turn(world, entry.line, hero.id, hero.userId);
  await settleQueue(world.campaignId);
  const stray = model.requests.filter((request) => !request.tools?.length);
  if (stray.length) {
    throw new Error(`${entry.id}: a request that was not the turn's took a scripted reply: ${String(stray[0].messages[0]?.content).slice(0, 120)}`);
  }
  const thrown = mine(spy.take());
  const parked = listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === hero.userId && pending.parkedFor === "real_dice");
  const told = model.requests.at(-1)?.messages.filter((message) => message.role === "tool").at(-1)?.content ?? "";
  const verdict = thrown.length ? "THROWN" : parked.length ? "PARKED" : "QUIET";
  if (DEBUG) console.log(`  ${verdict.padEnd(7)} ${entry.id} sites=${[...new Set(thrown.map((die) => `${die.file.replace("src/lib/dm/", "")}#${die.fn}`))].join(",")} parked=${parked.map((pending) => pending.kind).join(",")} told=${String(told).slice(0, 140)}`);
  return { verdict, thrown, parked, told };
}

const tally = { PARKED: 0, THROWN: 0, QUIET: 0 };
for (const entry of rows) {
  const run = async () => {
    const got = await play(entry);
    tally[got.verdict] += 1;
    if (got.verdict === "QUIET") throw new Error(`${entry.id}: the turn rolled nothing and parked nothing: ${String(got.told).slice(0, 300)}`);
    assert.equal(got.verdict, "PARKED", `the AI's turn threw the seat's d20 on the server's dice (${[...new Set(got.thrown.map((die) => `${die.file}#${die.fn}`))].join(", ")})`);
  };
  if (KNOWN[entry.id]) {
    await gap(`turn.${entry.id}`, KNOWN[entry.id], run);
  } else {
    await test(`${entry.id}: an AI turn hands the seat on physical dice its roll`, run);
  }
}

console.log(`rows: ${rows.length} ${JSON.stringify(tally)}`);
model.close();
world.close();
finish();
