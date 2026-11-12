// Sweep, modelio (6): what a player's seat is sent while the GM's tools act
// on a creature the GM keeps off the board.
//
// "One the GM keeps off the board is 'someone unseen'" in every line the
// whole table reads (src/lib/dm/turn-lines-logic.ts tableName, the tracker
// in src/lib/db/encounter-view.ts, encounter-tools.ts owedNamesForTable: "The
// turn note and a player's End Turn refusal used to name a hidden ambusher
// outright"). Each of those was fixed where it was met. This suite listens on
// the campaign's event stream as a player (src/lib/events.ts subscribe with
// their user id, so src/lib/table-delivery.ts sends what that seat gets) and
// walks every tool a fight offers, once for each value of its mode argument,
// with the hidden creature as the enemy the call names: on a hero's turn and
// on the creature's own. No event the seat receives holds the creature's
// name.
//
// The rows are the fight's tools (scripts/lib/sweep-modelio-tools.mjs), so a
// new tool, or a new line an old one publishes, is listened to the day it
// lands. The same listener is the place to add an unmet person's portrait
// and the GM-only fields of a sheet; this suite covers the name alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { fakeModel } from "./lib/enforce-narrator.mjs";
import { toolUniverse } from "./lib/sweep-modelio-tools.mjs";
import { baseArgs, modelDoor } from "./lib/sweep-modelio-fuzz.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-modelio-leaks");
const { subscribe } = await import("../src/lib/events.ts");
const maps = await import("../src/lib/db/battle-maps.ts");

const WIZARD = {
  class: "wizard", level: 5, abilities: { int: 16 }, name: "Mira", maxHp: 60,
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
  spellcasting: {
    ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Fireball", "Hold Person"], known: [], cantrips: ["Fire Bolt"], spellbook: ["Magic Missile", "Fireball", "Hold Person"],
  },
};
const model = await fakeModel();
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const mage = world.addHero(WIZARD);
const sword = world.addHero({ class: "fighter", level: 5, name: "Brann", maxHp: 60, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
model.pointAt(world);
const universe = await toolUniverse(world);

await world.beginFight([{ monster: "bandit", count: 1 }, { monster: "goblin", count: 1 }], { heroFaces: { [mage.id]: 20, [sword.id]: 19 } });
kit.openField();
const nameOf = (enemy) => enemy.displayName ?? enemy.name;
const [first, second] = world.enemies();
const lurker = { ...first, name: nameOf(first) };
const seen = { ...second, name: nameOf(second) };
assert.notEqual(lurker.name, seen.name, "the two foes are told apart by name");
kit.place(mage.id, 2, 2);
kit.place(sword.id, 2, 3);
kit.place(lurker.id, 3, 2);
kit.place(seen.id, 3, 3);
maps.setTokenHidden(kit.token(lurker.id).id, true);
world.say("player", "I do it.", mage);
world.say("player", "I do it.", sword);

// What Brann's player is sent, and what a listener with no seat is.
const seat = [];
const unsubscribe = subscribe(world.campaignId, (chunk) => seat.push(String(chunk)), sword.userId);
const door = await modelDoor(world);
const named = new RegExp(`\\b${lurker.name}\\b`, "i");

const fixtures = { characterId: mage.id, characterName: "Mira", otherCharacterId: sword.id, otherCharacterName: "Brann", enemyId: lurker.id, enemyName: lurker.name };
const WITH = {
  request_roll: { characterId: mage.id, skill: "perception", ability: "wis", dc: 12, reason: "listening", targetEnemyId: lurker.id, expression: "1d20" },
  apply_hazard: { characterIds: [mage.id], feet: 20, saveAbility: "dex", dc: 12, damage: "1d6", damageType: "fire" },
  take_action: { enemyId: lurker.id },
  pc_attack: { attacks: [{ targetEnemyId: lurker.id, spell: "Fire Bolt" }] },
  cast_at_enemy: { targets: [{ targetEnemyId: lurker.id }], spell: "Hold Person" },
  aoe_damage: { casterCharacterId: mage.id, spell: "Fireball", enemyIds: [lurker.id] },
  cast_at_player: { saveAbility: "dex", dc: 12, damage: "1d6", damageType: "fire", casterEnemyId: lurker.id },
  enemy_attack: { enemyId: lurker.id, targetCharacterId: sword.id },
  apply_damage: { enemyId: lurker.id, amount: 2, source: "hazard", reason: "a falling beam" },
  set_condition: { enemyId: lurker.id, condition: "prone", reason: "a slip" },
  clear_condition: { enemyId: lurker.id, condition: "prone" },
  set_effect: { enemyId: lurker.id, name: "Shaken", modifiers: [{ field: "attack", mode: "add", value: -1 }] },
  move_token: { token: lurker.name, x: 4, y: 2 },
  set_movement: { token: lurker.name, movement: "walk" },
  declare_intent: { actor: lurker.id, verb: "raises its crossbow", kind: "attack" },
  enemy_flees: { enemyId: lurker.id },
};

// row id -> the event types that named it, today.
const KNOWN = {};
const LEAK = (types) => ({
  rule: "src/lib/dm/turn-lines-logic.ts: 'How a creature is named in a line the whole table reads: one the GM keeps off the board is \"someone unseen\" there, as on the tracker and in the turn note.'",
  where: "the tool's own published line (src/lib/dm/attack-blow.ts publishRoll labels, encounter-tools.ts notes, fx.ts) and src/lib/table-delivery.ts, which redacts by event type but knows nothing of hidden tokens",
  severity: "medium",
  note: `Brann's player is sent the creature's name in: ${types}.`,
});
for (const [id, types] of Object.entries(LEAKS_TODAY())) {
  KNOWN[id] = { ...LEAK(types), ...(id === "leak:hero:pc_attack" ? { severity: "low" } : {}) };
}

const fightTools = universe.sets.find((set) => set.id === "full/fight").tools;
const found = [];
let rows = 0;
for (const turnOf of ["hero", "lurker"]) {
  if (turnOf === "hero") {
    kit.giveTurn(mage.id);
  } else {
    // The pointer on the hidden creature, its turn owed (enemy-turn-order.ts),
    // as scripts/test-tool-error-kinds.mjs turnTo sets one.
    const encounter = world.encounter();
    const index = encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === lurker.id);
    assert.ok(index >= 0, "the hidden creature is in the order");
    kit.saveEncounter({ ...encounter, turnIndex: index, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [lurker.id] } });
  }
  for (const tool of fightTools) {
    const name = tool.function.name;
    const properties = tool.function.parameters.properties ?? {};
    const required = tool.function.parameters.required ?? [];
    // On its own turn only the calls that name an enemy say anything new.
    if (turnOf === "lurker" && !Object.keys(properties).some((key) => /enemy|attacker|actor|token/i.test(key))) {
      continue;
    }
    const mode = required.find((field) => Array.isArray(properties[field]?.enum)) ?? ["action", "type", "kind"].find((field) => Array.isArray(properties[field]?.enum));
    for (const value of mode ? properties[mode].enum : [null]) {
      rows += 1;
      const id = `leak:${turnOf}:${name}${mode ? `:${value}` : ""}`;
      const args = { ...baseArgs(tool, fixtures), ...(WITH[name] ?? {}), ...(mode ? { [mode]: value } : {}) };
      const from = seat.length;
      const out = await door.call(name, args);
      const leaks = seat.slice(from).filter((chunk) => named.test(chunk));
      const types = [...new Set(leaks.map((chunk) => /^event: ?(\S+)/m.exec(chunk)?.[1] ?? "?"))].join(", ");
      const around = (chunk) => {
        const at = named.exec(chunk)?.index ?? 0;
        return `${/^event: ?(\S+)/m.exec(chunk)?.[1]}: ...${chunk.slice(Math.max(0, at - 90), at + 60).replace(/\s+/g, " ")}...`;
      };
      if (leaks.length) found.push(`${id}\t${types}\t${out.kind}\t${leaks.map(around).join(" || ")}`);
      const check = () => assert.deepEqual(types, "", `${name}${mode ? ` (${mode} ${value})` : ""} on the ${turnOf}'s turn sent a player "${lurker.name}", whose token the GM has hidden: ${leaks[0]?.replace(/\s+/g, " ").slice(0, 200)}`);
      if (KNOWN[id]) await gap(id, KNOWN[id], check);
      else await test(id, check);
    }
  }
}
unsubscribe();

await test(`the listener heard the fight (${seat.length} events to the seat over ${rows} calls)`, () => {
  assert.ok(seat.length > 20, `${seat.length} events`);
  assert.ok(seat.some((chunk) => /Mira|Brann/.test(chunk)), "the seat is sent the party's own names");
});

if (process.env.SWEEP_DUMP) fs.writeFileSync(process.env.SWEEP_DUMP, found.join("\n"));
model.close();
console.log(`  rows: ${rows}; skipped 0`);
world.close();
finish();

// The rows the 2026-11-09 repair closed (src/lib/table-delivery.ts runs
// every event that can name a creature through src/lib/hidden-names-logic.ts)
// run as tests.
function LEAKS_TODAY() {
  return {};
}
