// Sweep, modelio (5): lists kept by hand that mirror a registry, each derived
// from the registry and diffed.
//
//   A. The compact profile's last step down (src/lib/dm/turn.ts
//      compactToolsThatFit: the essentials and more_tools). Registry: the
//      tools a turn offers (dmTurnTools). Hand lists: ESSENTIAL_TOOLS,
//      ESSENTIAL_COMBAT_TOOLS and TOOL_GROUPS (tool-profiles.ts). Every tool
//      is either offered at that step or in a group more_tools names; a tool
//      in neither is in no list the model is shown.
//   B. TOOL_GROUPS, the cores and COMPACT_OMITS name only tools and
//      arguments that exist.
//   C. The empty-turn line's list of a player's own actions
//      (src/lib/dm/empty-turn.ts) against the tools a Hand card plays
//      (src/lib/dm/intent-logic.ts directCardCall and directCardCalls, read
//      from the source): a card that went through and was not narrated says
//      so, and never "try again".
//   D. The watch stop's list of calls (src/lib/dm/foresight.ts rollAbout)
//      against the tools that throw a d20 in a fight: every fight tool is
//      called once for each value of its mode argument (the schema's own
//      enum), and one that threw a d20 has a branch in rollAbout.
//   E. SERVER_FEATURES (src/lib/capabilities.ts) against the screens: every
//      flag is read by a hostOffers call somewhere under src/.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel } from "./lib/enforce-narrator.mjs";
import { toolUniverse } from "./lib/sweep-modelio-tools.mjs";
import { baseArgs, modelDoor } from "./lib/sweep-modelio-fuzz.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-modelio-mirrors");
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const profiles = await import("../src/lib/dm/tool-profiles.ts");
const turnModule = await import("../src/lib/dm/turn.ts");
const { emptyTurnLine, RESOLVED_TURN_LINE } = await import("../src/lib/dm/empty-turn.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");

const WIZARD = {
  class: "wizard", level: 5, abilities: { int: 16 }, name: "Mira",
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
  spellcasting: {
    ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Fireball", "Hold Person"], known: [], cantrips: ["Fire Bolt"], spellbook: ["Magic Missile", "Fireball", "Hold Person"],
  },
};
const model = await fakeModel();
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const mage = world.addHero(WIZARD);
const sword = world.addHero({ class: "fighter", level: 5, name: "Brann", equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
model.pointAt(world);
const universe = await toolUniverse(world);
const campaign = universe.campaign;

const KNOWN = {};
const known = (id, meta) => {
  KNOWN[id] = meta;
};
async function row(id, fn) {
  if (KNOWN[id]) await gap(id, KNOWN[id], fn);
  else await test(id, fn);
}
let rows = 0;
// The d20-throwing calls with no branch in rollAbout, today (filled from a run).
const WATCH_TODAY = [
  "watch:group_check",
  "watch:apply_hazard:trap",
  "watch:apply_hazard:generic",
  "watch:apply_hazard:extreme_cold",
  "watch:apply_hazard:extreme_heat",
  "watch:social_check:persuade",
  "watch:social_check:deceive",
  "watch:social_check:intimidate",
  "watch:take_action:hide",
  "watch:take_action:grapple",
  "watch:take_action:shove",
  "watch:add_enemies",
];
const IN_FLIGHT_891 = "In flight: PR #891 stops a trap's or hazard's save thrown with apply_hazard.";
const WATCH_NOTES = {
  "watch:group_check": "Each hero's check is an ability check a watcher could foretell; group_check rolls them all with no stop.",
  "watch:apply_hazard:trap": IN_FLIGHT_891,
  "watch:apply_hazard:generic": IN_FLIGHT_891,
  "watch:apply_hazard:extreme_cold": IN_FLIGHT_891,
  "watch:apply_hazard:extreme_heat": IN_FLIGHT_891,
  "watch:social_check:persuade": "A Charisma check rolled mid-fight with no stop.",
  "watch:social_check:deceive": "A Charisma check rolled mid-fight with no stop.",
  "watch:social_check:intimidate": "A Charisma check rolled mid-fight with no stop.",
  "watch:take_action:hide": "The hero's Stealth check: no stop.",
  "watch:take_action:grapple": "A contest: the hero's Athletics check and the foe's answer, two d20s, no stop for either.",
  "watch:take_action:shove": "A contest: two d20s, no stop for either.",
  "watch:add_enemies": "The reinforcements' initiative (a Dexterity check). The opening's own initiative is not stopped either; recorded for a ruling, severity low.",
};

// ---- A. the essentials step -------------------------------------------------

// Every tool is offered at the essentials step or in a group more_tools
// names there: the cores are groups of their own since the 2026-11-09 repair
// (src/lib/dm/tool-profiles.ts TOOL_GROUPS core, fight).
for (const fight of [false, true]) {
  const state = fight ? "fight" : "explore";
  const names = turnModule.dmTurnTools(campaign, fight, true, false).map((tool) => tool.function.name);
  const essentials = new Set([...profiles.ESSENTIAL_TOOLS, ...(fight ? profiles.ESSENTIAL_COMBAT_TOOLS : [])]);
  const offered = new Set(names.filter((name) => essentials.has(name)));
  const closed = profiles.closedGroups(names, offered);
  const reachable = new Set([...offered, ...closed.flatMap((group) => profiles.TOOL_GROUPS[group].tools)]);
  for (const name of new Set(names)) {
    rows += 1;
    await row(`essentials:${state}:${name}`, () => {
      assert.ok(reachable.has(name), `${name}: not among the ${offered.size} tools the essentials step offers ${fight ? "in a fight" : "out of one"}, and in none of the ${closed.length} groups more_tools names`);
    });
  }
}

// ---- B. the hand lists name real things -------------------------------------

{
  // A tool a group names that no table of this suite offers, with the reason.
  const GATED = { relationship_scheme: "offered only at a table where a scheme could run (src/lib/dm/scheme-tools.ts); reached by name through invoke-dispatch.ts" };
  const sourceNames = new Set([...universe.byName.keys(), ...Object.keys(GATED)]);
  for (const [group, entry] of Object.entries(profiles.TOOL_GROUPS)) {
    rows += 1;
    await row(`groups:${group}`, () => {
      const missing = entry.tools.filter((name) => !sourceNames.has(name));
      assert.deepEqual(missing, [], `group ${group} names tools no turn offers`);
    });
  }
  for (const list of ["ESSENTIAL_TOOLS", "ESSENTIAL_COMBAT_TOOLS", "EXPLORE_SPARE_TOOLS", "COMBAT_SPARE_TOOLS"]) {
    rows += 1;
    await row(`lists:${list}`, () => {
      const missing = profiles[list].filter((name) => !sourceNames.has(name));
      assert.deepEqual(missing, [], `${list} names tools no turn offers`);
    });
  }
  for (const [name, fields] of Object.entries(profiles.COMPACT_OMITS)) {
    rows += 1;
    await row(`omits:${name}`, () => {
      const properties = universe.byName.get(name)?.function.parameters.properties ?? {};
      assert.deepEqual(fields.filter((field) => !(field in properties)), [], `COMPACT_OMITS.${name} names arguments the tool does not take`);
      const cut = profiles.compactTool(universe.byName.get(name)).function.parameters;
      assert.deepEqual((cut.required ?? []).filter((field) => !(field in cut.properties)), [], "an omitted argument is still required");
    });
  }
}

// ---- C. the empty-turn line knows every card's tool --------------------------

{
  const cardTools = new Set([...read("src/lib/dm/intent-logic.ts").matchAll(/\bname: "([a-z_]+)"/g)].map((match) => match[1]));
  // Every way a card names the character acting, across the calls.
  const args = { characterId: "c1", casterCharacterId: "c1", casterId: "c1", healerId: "c1", spell: "Bless", condition: "prone", action: "dodge" };
  for (const name of cardTools) {
    rows += 1;
    await row(`empty-turn:${name}`, () => {
      const line = emptyTurnLine([
        { role: "assistant", content: "", tool_calls: [{ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } }] },
        { role: "tool", tool_call_id: "x", content: JSON.stringify({ ok: true }) },
      ]);
      assert.equal(line, RESOLVED_TURN_LINE, `a ${name} card that went through and was not narrated reads: ${line}`);
    });
  }
  await test(`the Hand's cards play ${cardTools.size} tools`, () => assert.ok(cardTools.size >= 12, [...cardTools].join(", ")));
}

// ---- D. the watch stop against the tools that roll --------------------------

{
  await world.invoke("set_npc", { name: "Orla", attitude: "indifferent", gender: "Female" });
  const encounter = await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: { [mage.id]: 20, [sword.id]: 19 } });
  // A fight whose tokens stand nowhere, as scripts/test-enforce-tool-args.mjs
  // makes one: start_encounter places them at random, and which tools reach
  // their dice must not turn on where.
  {
    const { getDatabase } = await import("../src/lib/db/core.ts");
    const db = getDatabase();
    db.prepare("DELETE FROM battle_tokens WHERE map_id IN (SELECT id FROM battle_maps WHERE encounter_id = ?)").run(encounter.id);
    db.prepare("DELETE FROM battle_maps WHERE encounter_id = ?").run(encounter.id);
  }
  world.say("player", "I do it.", mage);
  world.say("player", "I do it.", sword);
  const enemy = world.enemies()[0];
  const fixtures = { characterId: mage.id, characterName: "Mira", otherCharacterId: sword.id, otherCharacterName: "Brann", enemyId: enemy.id, enemyName: enemy.name };
  const door = await modelDoor(world);
  const watched = new Set([...read("src/lib/dm/foresight.ts").matchAll(/call\.name === "([a-z_]+)"/g)].map((match) => match[1]));
  // What a mode needs beside its name to reach its dice at this table.
  const WITH = {
    request_roll: { characterId: mage.id, skill: "perception", ability: "wis", dc: 12, reason: "listening", expression: "1d20" },
    group_check: { skill: "stealth", dc: 12 },
    check_notice: { dc: 12 },
    apply_hazard: { characterIds: [mage.id], feet: 20, saveAbility: "dex", dc: 12, damage: "1d6", damageType: "fire", severity: "setback" },
    take_action: { characterId: mage.id, targetEnemyId: enemy.id, skill: "stealth", ability: "str", difficulty: "moderate", distanceFt: 5, scene: "a loose chandelier rope", damage: "1d10" },
    pc_attack: { attacks: [{ targetEnemyId: enemy.id, spell: "Fire Bolt" }] },
    cast_at_enemy: { targets: [{ targetEnemyId: enemy.id }], spell: "Hold Person" },
    aoe_damage: { casterCharacterId: mage.id, spell: "Fireball", enemyIds: [enemy.id] },
    cast_at_player: { saveAbility: "dex", dc: 12, damage: "1d6", damageType: "fire" },
    social_check: { npc: "Orla" },
  };
  const WATCH = {
    rule: "A player watching a fight for Portent, Chronal Shift, Flash of Genius or Favored by the Gods is stopped before a d20 they could answer is thrown (SRD 5.1 Portent: 'You can replace any attack roll, saving throw, or ability check made by you or a creature that you can see with one of these foretelling rolls. You must choose to do so before the roll').",
    where: "src/lib/dm/foresight.ts rollAbout (a branch for each of enemy_attack, pc_attack, cast_at_player, cast_at_enemy, aoe_damage, request_roll and no other)",
    severity: "medium",
  };
  for (const id of WATCH_TODAY) {
    known(id, { ...WATCH, ...(id === "watch:add_enemies" ? { severity: "low" } : {}), note: WATCH_NOTES[id] ?? "No stop for a watcher." });
  }
  const fightTools = universe.sets.find((set) => set.id === "full/fight").tools;
  const rolled = [];
  const answers = [];
  for (const tool of fightTools) {
    const name = tool.function.name;
    const properties = tool.function.parameters.properties ?? {};
    const required = tool.function.parameters.required ?? [];
    const mode = required.find((field) => Array.isArray(properties[field]?.enum)) ?? ["action", "type", "kind"].find((field) => Array.isArray(properties[field]?.enum));
    const modes = mode ? properties[mode].enum : [null];
    for (const value of modes) {
      rows += 1;
      const args = { ...baseArgs(tool, fixtures), ...(WITH[name] ?? {}), ...(mode ? { [mode]: value } : {}) };
      const out = await door.call(name, args);
      const id = `watch:${name}${mode ? `:${value}` : ""}`;
      if (out.d20s > 0) rolled.push(id);
      answers.push(`${id}\t${out.d20s}\t${out.kind}\t${String(out.error ?? "").slice(0, 150)}`);
      await row(id, () => {
        assert.ok(!(out.d20s > 0) || watched.has(name), `${name}${mode ? ` (${mode} ${value})` : ""} threw ${out.d20s} d20 in a fight and rollAbout has no branch for it: a watcher is never stopped`);
      });
    }
  }
  await test(`the walk found the tools that roll (${rolled.length} calls threw a d20; rollAbout names ${[...watched].join(", ")})`, () => {
    assert.ok(rolled.some((id) => id.startsWith("watch:pc_attack")), "pc_attack rolled");
    assert.ok(rolled.length >= 6, rolled.join(", "));
  });
  if (process.env.SWEEP_DUMP) fs.writeFileSync(process.env.SWEEP_DUMP, answers.join("\n"));
}

// ---- E. the feature flags are read ------------------------------------------

{
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "src"));
  const text = files.filter((file) => !file.endsWith("capabilities.ts")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const flag of Object.keys(SERVER_FEATURES)) {
    rows += 1;
    await row(`flag:${flag}`, () => {
      assert.ok(new RegExp(`["'\`]${flag}["'\`]`).test(text), `SERVER_FEATURES.${flag} is read by no screen under src/: a flag nobody asks about`);
    });
  }
}

model.close();
console.log(`  rows: ${rows}; skipped 0`);
world.close();
finish();
