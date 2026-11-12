// Gap sweep, package `dice`, part 1: who throws a player's dice.
//
// A seat on physical dice is promised (src/lib/dice/held-rolls.ts
// REAL_DICE_SCOPE): "You roll your attacks and their damage, initiative, and
// the checks and saves the GM asks for. The table rolls the rest for you, such
// as death saves, concentration, and the saves a spell, trap or monster forces
// on you." Issue #896 is a table where that did not hold: a skill check came
// off the server's dice with physical dice on.
//
// This suite does not list the rolls it knows of. It walks three registries:
//
//   1. the console catalog (src/lib/dm/invoke-catalog.ts ADJUDICATIONS): every
//      form is driven at least once with the real-dice seat's character as
//      the one who rolls, or is in QUIET with the reason it throws nothing;
//   2. the selects of the forms that pick WHAT is rolled (request_roll's kind
//      and screen, take_action's action, apply_hazard's type, social_check's
//      approach, afflict's kind, downtime's activity, stabilize's method):
//      one row per option, so an option added to a form is a row the day it
//      lands;
//   3. the source's own roll sites (scripts/lib/sweep-dice.mjs
//      staticRollSites): every call that throws dice is classified in SITES,
//      and every site that throws a character's d20 is reached by a row.
//
// Each row is run through the console's door and the AI's door
// (invokeEngine with a person and with an AI turn), with a spy on the dice
// that says which roll site threw each die and for whom. A row ends one of
// four ways: PARKED (a roll card went to the seat and the server threw none
// of their dice), THROWN (the server threw them), QUIET (nothing of theirs
// was rolled) or REFUSED. A row is expected PARKED unless it is named in
// RULING (thrown by the written scope above), KNOWN (thrown, against the
// scope: a gap) or QUIET.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine } from "./lib/enforce-narrator.mjs";
import { d20sOf, formArgs, installDiceSpy, staticRollSites, taggedFor } from "./lib/sweep-dice.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-dice-sites");
const spy = installDiceSpy();
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const ai = await aiEngine(world);
const { ADJUDICATIONS, adjudication } = await import("../src/lib/dm/invoke-catalog.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { REAL_DICE_SCOPE } = await import("../src/lib/dice/held-rolls.ts");

const DEBUG = Boolean(process.env.ODM_SWEEP_DEBUG);
// The promise every row is held to is quoted from the sentence itself, so a
// reworded scope stops this suite until its rows are read against it again.
if (!REAL_DICE_SCOPE.startsWith("You roll your attacks and their damage, initiative, and every check and save your character makes, the saves a spell, trap or monster forces on you included.")) {
  throw new Error(`REAL_DICE_SCOPE was reworded: read the rows of this suite against it again. It says: ${REAL_DICE_SCOPE}`);
}

// ---- the table ----

const CASTING = {
  ability: "wis",
  slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
  prepared: ["Bless", "Guiding Bolt", "Inflict Wounds", "Hold Person", "Cure Wounds"],
  known: [],
  cantrips: ["Sacred Flame", "Fire Bolt", "Guidance"],
};
const GEAR = [
  { name: "Longsword", qty: 1, equipped: true },
  { name: "Thieves' tools", qty: 1 },
  { name: "Healer's kit", qty: 1 },
  { name: "Component pouch", qty: 1 },
  { name: "Rope", qty: 1 },
];
// The seat on physical dice.
const hero = world.addHero({
  name: "Dicey", class: "cleric", level: 5, maxHp: 44, abilities: { str: 16, dex: 14, wis: 16 },
  proficiencies: TRAINED, equipment: GEAR, spellcasting: CASTING, gold: 500,
});
// A second player on the server's dice: someone to stabilize, to stand beside.
const ally = world.addHero({ name: "Ally", class: "fighter", level: 5, maxHp: 44, abilities: { str: 14 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
const HERO_BASE = { features: world.sheet(hero.id).features, resources: world.sheet(hero.id).resources };

const realDice = (on) => setMemberRealDice(world.campaignId, hero.userId, on);
const dropParked = () => getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);

async function reset(stage) {
  realDice(false);
  dropParked();
  await kit.endFight();
  // A scene a row started outlives it; so does a fast march's pace.
  await world.invoke("end_scene", {});
  for (const sheet of [hero, ally]) {
    world.patch(sheet.id, { currentHp: 44, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, concentration: null, exhaustion: 0 });
  }
  world.patch(hero.id, { spellcasting: CASTING, equipment: GEAR, gold: 500, hitDice: { die: "d8", total: 5, spent: 0 }, ...HERO_BASE });
  if (stage.startsWith("fight")) {
    const first = stage === "fight" ? hero : ally;
    const second = stage === "fight" ? ally : hero;
    await kit.fight(1, { heroFaces: { [first.id]: 19, [second.id]: 5 } });
    const [enemy] = world.enemies();
    kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400 });
    kit.place(hero.id, 5, 5);
    kit.place(enemy.id, 5, 6);
    kit.place(ally.id, 4, 5);
    if (stage === "fight-enemy-turn") {
      const encounter = world.encounter();
      kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.kind === "enemy"), turnBudget: null });
    }
  }
  dropParked();
  realDice(true);
  spy.take();
  world.clearDice();
  world.diceLog();
}

let doorNow = "console";
const ctx = () => ({ heroId: hero.id, allyId: ally.id, enemyId: world.enemies()[0]?.id, door: doorNow });
const entryOf = (name) => {
  const entry = adjudication(name);
  if (!entry) throw new Error(`no console form called ${name}`);
  return entry;
};
const optionsOf = (tool, field) => entryOf(tool).fields.find((entry) => entry.name === field)?.options?.map((option) => option.value) ?? [];

// ---- the rows ----
//
// { id, tool, stage, args(ctx), setup?(ctx) }. `stage`: "out" (no fight),
// "fight" (the seat's turn, a creature beside them), "fight-ally-first" (the
// other player's turn), "fight-enemy-turn" (the creature's), "none" (the row
// opens its own fight). `say`: who declares what before the AI's call, since
// the AI acts for a character only on their player's word
// (src/lib/dm/player-word.ts); the seat by default.
const rows = [];
const row = (id, tool, stage, args, setup, say) => rows.push({ id, tool, stage, args, setup, say });
// A creature's own act: the AI's door gives a creature its turn only through
// end_turn's hand-off, so these rows go by the console's door, and the turn
// loop's suite (test-enforce-sweep-dice-turn.mjs) plays them as the AI does.
const CONSOLE_ONLY = new Set(["opportunity.enemy_walks_off", "cast_at_player.enemy", "aoe_damage.enemy_breath", "enemy_attack.rider_save"]);
// A name no earlier row used: a scene, a shop and a person outlive the row
// that made them.
let made = 0;
let fresh = "Sweep";
const setupCall = (name, args) => async () => {
  made += 1;
  fresh = `Sweep ${made}`;
  realDice(false);
  const out = await world.invoke(name, typeof args === "function" ? args(ctx()) : args);
  realDice(true);
  if (!out.ok) throw new Error(`set-up ${name} refused: ${out.error}`);
};
const named = (tool, c) => ({ ...formArgs(entryOf(tool), c), name: fresh, title: fresh });

// request_roll: every kind the form offers, behind every screen it offers.
const ROLL_ARGS = {
  skill_check: { skill: "perception", dc: 10 },
  saving_throw: { ability: "dex", dc: 10 },
  ability_check: { ability: "str", dc: 10 },
  attack: { expression: "1d20+5" },
  damage: { expression: "1d8+3" },
  initiative: {},
  custom: { expression: "1d20" },
};
for (const kind of optionsOf("request_roll", "kind")) {
  for (const visibility of optionsOf("request_roll", "visibility")) {
    row(`request_roll.${kind}.${visibility}`, "request_roll", "out", (c) => ({ characterId: c.heroId, kind, visibility, reason: "the sweep asks", ...(ROLL_ARGS[kind] ?? {}) }));
  }
}
row("request_roll.tool", "request_roll", "out", (c) => ({ characterId: c.heroId, kind: "ability_check", ability: "dex", tool: "thieves' tools", dc: 10, reason: "a lock" }));
row("request_roll.contest", "request_roll", "fight", (c) => ({ characterId: c.heroId, kind: "skill_check", skill: "stealth", againstEnemyId: c.enemyId, reason: "slipping past" }));
row("request_roll.save.in_fight", "request_roll", "fight", (c) => ({ characterId: c.heroId, kind: "saving_throw", ability: "con", dc: 12, reason: "a gas" }));

// Attacks.
row("pc_attack.weapon", "pc_attack", "fight", (c) => ({ characterId: c.heroId, targetEnemyId: c.enemyId, weapon: "Longsword" }));
row("pc_attack.spell", "pc_attack", "fight", (c) => ({ characterId: c.heroId, targetEnemyId: c.enemyId, spell: "Fire Bolt" }));
row("cast_at_enemy.save_spell", "cast_at_enemy", "fight", (c) => ({ characterId: c.heroId, targetEnemyId: c.enemyId, spell: "Sacred Flame" }));
row("damage_object.weapon", "damage_object", "out", (c) => ({ name: "a door", material: "wood", size: "medium", characterId: c.heroId, weapon: "Longsword", reason: "breaking in" }));
row("opportunity.enemy_walks_off", "move_token", "fight-enemy-turn", (c) => ({ token: c.enemyId, x: 5, y: 12, reason: "it runs" }));
row("use_reaction.opportunity_attack", "use_reaction", "fight-ally-first", (c) => ({ characterId: c.heroId, feature: "Opportunity attack", targetEnemyId: c.enemyId, reason: "it turned its back" }));

// Saves something forces on the seat.
row("cast_at_player.hazard", "cast_at_player", "out", (c) => ({ characterId: c.heroId, saveAbility: "dex", dc: 12, damage: "2d6", damageType: "fire", halfOnSave: true, source: "a gout of flame" }));
row("cast_at_player.enemy", "cast_at_player", "fight-enemy-turn", (c) => ({ characterId: c.heroId, casterEnemyId: c.enemyId, enemyAbility: "Web", saveAbility: "dex", dc: 12, condition: "restrained" }));
row("aoe_damage.enemy_breath", "aoe_damage", "fight-enemy-turn", (c) => ({ casterEnemyId: c.enemyId, enemyAbility: "Fire Breath", damage: "2d6", saveAbility: "dex", dc: 12, type: "fire", halfOnSave: true, characterIds: [c.heroId] }));
const HAZARD = {
  falling: { feet: 30 },
  trap: { trap: "Poison Needle" },
  generic: { damage: "2d6", damageType: "fire", saveAbility: "dex", dc: 12, halfOnSave: true },
  suffocation: { roundsWithoutAir: 6 },
  drowning: { roundsWithoutAir: 6 },
  extreme_cold: { hours: 2 },
  extreme_heat: { hours: 2 },
};
for (const type of optionsOf("apply_hazard", "type")) {
  row(`apply_hazard.${type}`, "apply_hazard", "out", (c) => ({ type, characterIds: [c.heroId], reason: "the sweep", ...(HAZARD[type] ?? {}) }));
}
for (const trap of optionsOf("apply_hazard", "trap")) {
  row(`apply_hazard.trap.${trap}`, "apply_hazard", "out", (c) => ({ type: "trap", trap, characterIds: [c.heroId], reason: "the sweep" }));
}
row("enemy_attack.rider_save", "enemy_attack", "fight-enemy-turn", (c) => ({ enemyId: c.enemyId, targetCharacterId: c.heroId }), (c) => {
  const enemy = kit.enemy(c.enemyId);
  kit.setEnemy(c.enemyId, { stats: { ...enemy.stats, attacks: [{ name: "Bite", toHit: 30, damage: "1d4", type: "piercing", onHit: { save: "con", dc: 11, damage: "2d6", damageType: "poison" } }] } });
});
row("death_save.turn_pass", "end_turn", "fight-ally-first", (c) => ({ characterId: c.allyId }), () => {
  world.patch(hero.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0 } });
}, () => ["That's my turn.", ally]);
row("concentration.damage", "apply_hazard", "fight", (c) => ({ type: "generic", characterIds: [c.heroId], damage: "2d6", damageType: "fire", reason: "a burst pipe" }), setupCall("cast_buff", (c) => ({ characterId: c.heroId, spell: "Bless", targetCharacterIds: [c.heroId, c.allyId] })));
const AFFLICT = {
  // One disease a door: a character keeps the one they caught.
  disease: (c) => ({ name: c.door === "ai" ? "Sight Rot" : "Sewer Plague" }),
  poison: { name: "Serpent Venom" },
  madness: { duration: "short", save: true, saveDc: 12, saveAbility: "wis" },
};
for (const kind of optionsOf("afflict", "kind")) {
  const extra = AFFLICT[kind];
  row(`afflict.${kind}`, "afflict", "out", (c) => ({ characterId: c.heroId, kind, reason: "the sweep", ...(typeof extra === "function" ? extra(c) : extra ?? {}) }));
}

// Contests and actions: every action the form offers.
const ACTION = {
  hide: {},
  search: { skill: "perception" },
  grapple: (c) => ({ targetEnemyId: c.enemyId }),
  shove: (c) => ({ targetEnemyId: c.enemyId, shove: "prone" }),
  escape: {},
  pin: (c) => ({ targetEnemyId: c.enemyId }),
  improvise: (c) => ({ skill: "athletics", difficulty: "moderate", targetEnemyId: c.enemyId, scene: "the chandelier", distanceFt: 5, reason: "swinging from the chandelier" }),
  help: (c) => ({ targetCharacterId: c.allyId, targetEnemyId: c.enemyId }),
  ready: (c) => ({ readied: "attack", trigger: "it steps closer", targetEnemyId: c.enemyId }),
  use_object: { item: "Rope" },
  dash: {},
  dodge: {},
  disengage: {},
};
const ACTION_SETUP = {
  hide: (c) => kit.setEnemy(c.enemyId, { conditions: ["blinded"] }),
  escape: (c) => world.patch(hero.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: c.enemyId, sourceName: "Goblin", escapeDc: 12 } } }),
  pin: (c) => {
    world.patch(hero.id, { feats: ["Grappler"] });
    const enemy = kit.enemy(c.enemyId);
    kit.setEnemy(c.enemyId, { conditions: [...enemy.conditions, "grappled"], conditionMeta: { ...(enemy.conditionMeta ?? {}), grappled: { source: hero.id, sourceName: hero.name } } });
  },
};
for (const action of optionsOf("take_action", "action")) {
  const extra = ACTION[action];
  row(`take_action.${action}`, "take_action", "fight", (c) => ({ characterId: c.heroId, action, reason: "the sweep", ...(typeof extra === "function" ? extra(c) : extra ?? {}) }), ACTION_SETUP[action]);
}

// Checks other tools make for a character.
row("group_check.one", "group_check", "out", (c) => ({ skill: "athletics", dc: 10, characterIds: [c.heroId], reason: "over the wall" }));
row("group_check.party", "group_check", "out", (c) => ({ skill: "stealth", dc: 10, characterIds: [c.heroId, c.allyId], reason: "creeping by" }));
row("check_notice.active", "check_notice", "out", (c) => ({ dc: 12, sense: "perception", characterIds: [c.heroId], reason: "a tripwire" }));
row("scene_check.skill", "scene_check", "out", (c) => ({ characterId: c.heroId, skill: "athletics", dc: 10, approach: "vaulting the cart" }), setupCall("start_scene", (c) => named("start_scene", c)));
for (const approach of optionsOf("social_check", "approach")) {
  row(`social_check.${approach}`, "social_check", "out", (c) => ({ characterId: c.heroId, npc: fresh, approach, reason: "talking the guard round" }), setupCall("set_npc", (c) => named("set_npc", c)));
}
for (const skill of optionsOf("haggle", "skill")) {
  row(`haggle.${skill}`, "haggle", "out", (c) => ({ characterId: c.heroId, shop: fresh, skill }), setupCall("open_shop", (c) => named("open_shop", c)));
}
for (const beat of optionsOf("relationship_beat", "beat")) {
  row(`relationship_beat.${beat}`, "relationship_beat", "out", (c) => ({ characterId: c.heroId, subject: fresh, beat, note: "by the fire" }), setupCall("set_npc", (c) => named("set_npc", c)));
}
for (const method of optionsOf("stabilize", "method")) {
  row(`stabilize.${method}`, "stabilize", "out", (c) => ({ characterId: c.allyId, healerId: c.heroId, method, reason: "stopping the bleeding" }), () => {
    world.patch(ally.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 1 } });
  });
}
const DOWNTIME = {
  crafting: { item: "Rope", tool: "weaver's tools" },
  profession: {},
  recuperating: { recover: "advantage" },
  research: { topic: "the old keep" },
  training: { kind: "language", subject: "Elvish" },
};
for (const activity of optionsOf("downtime", "activity")) {
  row(`downtime.${activity}`, "downtime", "out", (c) => ({ days: 5, characterId: c.heroId, activity, reason: "the sweep", ...(DOWNTIME[activity] ?? {}) }));
}
row("take_rest.hit_dice", "take_rest", "out", (c) => ({ kind: "short", spend: [{ characterId: c.heroId, dice: 1 }], reason: "an hour by the fire" }), () => world.patch(hero.id, { currentHp: 20 }));
row("lift.push", "lift", "out", (c) => ({ characterId: c.heroId, weightLb: 400, how: "push", reason: "the stone lid" }));

// Initiative, on each way a call opens a fight or brings someone into one.
row("start_encounter.plain", "start_encounter", "none", () => ({ enemies: [{ monster: "goblin", count: 1 }] }));
row("start_encounter.party_ambush", "start_encounter", "none", () => ({ enemies: [{ monster: "goblin", count: 1 }], ambush: "party" }));
row("start_encounter.enemies_ambush", "start_encounter", "none", () => ({ enemies: [{ monster: "goblin", count: 1 }], ambush: "enemies" }));
// Last: a march leaves the party's pace and the clock where it ends.
row("travel.forced_march", "travel", "out", () => ({ hours: 11, pace: "normal", reason: "a hard road" }));

// ---- what each row is expected to do ----

// Roll sites that throw a seat's d20 by the scope's own words. A row whose
// only throws are from these is RULED. The scope once named the saves the
// engine forces, death saves and concentration as the table's; the
// maintainer's decision R5 (2026-11-09 gap sweep) overturned that: "A seat on
// physical dice rolls its own saves, including saves the engine forces
// (forced-save.ts and its callers)". Every one of them now parks, so none is
// ruled thrown.
const RULED_SITES = {};

// Thrown by the server against the scope: none since every site throws a
// character's d20 through src/lib/dm/character-roll.ts.
const KNOWN = {
};

// Refused, and why that is the row working.
const REFUSED_OK = {
  "use_reaction.opportunity_attack": "the engine takes opportunity attacks itself on the board (reaction-tools.ts), so the tool refuses one: see opportunity.enemy_walks_off",
  "take_action.use_object": "a consumable goes through use_item",
  "stabilize.spell": "the healer does not know Spare the Dying",
  "downtime.crafting": "the character has no tool proficiency",
  "relationship_beat.compliment": "a courtship beat before any courtship",
  "relationship_beat.grand_gesture": "a courtship beat before any courtship",
  "relationship_beat.intimacy": "a courtship beat before any courtship",
};

// ---- the run ----

// Roll sites that throw a character's d20 without saying whose it is: a d20
// from one of these, in a row whose only roller is the seat, is the seat's.
// None now: every one throws through src/lib/dm/character-roll.ts, which
// tags the die as the character's.
const UNTAGGED_HERO_SITES = new Set([]);
// And those whose untagged d20 is a creature's or the world's.
const UNTAGGED_OTHER_SITES = new Set([
  "lib/dm/roll-gates.ts#rollContest",
  "lib/dm/action-common.ts#rollEnemyContest",
  "lib/dm/roll-card.ts#rollCard",
  "lib/dm/roll-card.ts#dmRoll",
  "lib/dm/social-tools.ts#handleNpcReaction",
]);

const sites = staticRollSites();
const siteAt = (die) => sites.find((site) => site.file === die.file && site.line === die.line);
const reached = new Map();
const unclassified = new Set();

async function run(entry, door) {
  doorNow = door;
  await reset(entry.stage);
  if (entry.setup) {
    await entry.setup(ctx());
    dropParked();
    spy.take();
  }
  const args = entry.args(ctx());
  if (door === "ai" && entry.stage.startsWith("fight")) {
    const [words, who] = entry.say?.() ?? [`I ${entry.tool === "take_action" ? `use my action to ${args.action}` : "attack the goblin"}, now.`, hero];
    // An improvised action uses a thing the narration has shown.
    world.say("dm", "A chandelier hangs low over the goblin, its rope tied off within reach.");
    world.say("player", words, world.sheet(who.id));
  }
  let out;
  try {
    out = await (door === "ai" ? (ai.fresh(), ai.invoke(entry.tool, args)) : world.invoke(entry.tool, args));
  } catch (error) {
    out = { ok: false, error: `THREW ${error?.message}` };
  }
  const dice = spy.take();
  for (const die of dice) {
    const site = siteAt(die);
    if (site) reached.set(site.id, (reached.get(site.id) ?? 0) + 1);
    if (die.sides === 20 && !die.purpose && !UNTAGGED_HERO_SITES.has(site?.id) && !UNTAGGED_OTHER_SITES.has(site?.id)) {
      unclassified.add(site?.id ?? `${die.file}:${die.line}`);
    }
  }
  const heroD20s = d20sOf(dice).filter((die) => taggedFor(die, hero.name) || (!die.purpose && UNTAGGED_HERO_SITES.has(siteAt(die)?.id)));
  const where = [...new Set(heroD20s.map((die) => siteAt(die)?.id ?? `${die.file}:${die.line}`))];
  const parked = listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === hero.userId && pending.parkedFor === "real_dice");
  const verdict = heroD20s.length
    ? where.every((id) => RULED_SITES[id]) ? "RULED" : "THROWN"
    : parked.length ? "PARKED" : out.ok ? "QUIET" : "REFUSED";
  if (DEBUG) {
    console.log(`  ${verdict.padEnd(7)} ${entry.id}@${door} ${out.ok ? "" : `[${String(out.error).slice(0, 140)}] `}sites=${where.join(",")} parked=${parked.map((pending) => pending.kind).join(",")}`);
  }
  return { verdict, where: where.filter((id) => !RULED_SITES[id]), out, parked, dice };
}

const tally = { PARKED: 0, RULED: 0, THROWN: 0, QUIET: 0, REFUSED: 0 };
const ruledRows = {};
for (const entry of rows) {
  for (const door of CONSOLE_ONLY.has(entry.id) ? ["console"] : ["console", "ai"]) {
    const id = `${entry.id}@${door}`;
    const known = KNOWN[id] ?? KNOWN[entry.id];
    const refusedOk = REFUSED_OK[id] ?? REFUSED_OK[entry.id];
    const play = async () => {
      const got = await run(entry, door);
      tally[got.verdict] += 1;
      if (got.verdict === "RULED") {
        for (const die of got.dice) {
          const site = siteAt(die)?.id;
          if (RULED_SITES[site]) (ruledRows[site] ??= new Set()).add(entry.id);
        }
      }
      return got;
    };
    if (known) {
      await gap(`sites.${id}`, known, async () => {
        const got = await play();
        if (got.verdict !== "THROWN" && got.verdict !== "PARKED") {
          throw new Error(`${id} is a known gap and its row no longer reaches the roll (${got.verdict}${got.out.ok ? "" : `: ${got.out.error}`})`);
        }
        assert.equal(got.verdict, "PARKED", `${entry.tool} threw the seat's d20 on the server's dice (${got.where.join(", ")}) and parked ${got.parked.length} roll(s) for the seat`);
      });
    } else if (refusedOk) {
      await test(`${id}: refused (${refusedOk})`, async () => {
        const got = await play();
        assert.equal(got.verdict, "REFUSED", `${id} was expected to be refused and ${got.verdict}`);
      });
    } else {
      await test(`${id}: none of the seat's d20s is thrown by the server outside the written scope`, async () => {
        const got = await play();
        assert.ok(["PARKED", "RULED", "QUIET"].includes(got.verdict), `${id}: ${got.verdict}${got.out.ok ? "" : ` [${String(got.out.error).slice(0, 200)}]`} ${got.where.join(", ")}`);
      });
    }
  }
}

await test("every untagged d20 the rows met comes from a site this suite has classified", () => {
  assert.deepEqual([...unclassified], [], `untagged d20s from sites in neither list: ${[...unclassified].join(", ")}`);
});

// ---- the registries ----

// Every console form is driven by a row above, or says here why none of the
// seat's d20s can come out of it. The reason is checked by a blind call: the
// form filled from its own field list with the seat's character in every
// character field throws no d20 of theirs.
const NO_ROW = {
  // Fights, creatures and the board: the creature's dice, or none.
  add_enemies: "adds creatures; their initiative is the GM's die",
  enemy_flees: "a creature leaves", legendary_action: "a creature's action", declare_intent: "a creature's intent",
  legendary_resist: "a creature's resistance", lair_action: "the lair's action", set_movement: "the board's movement budget",
  end_encounter: "ends the fight",
  // Player spells and features whose d20, if any, is the creature's save.
  cast_buff: "a spell on allies; no d20 of the caster's", heal: "healing dice, no d20", use_resource: "151 authored spends: the spends package walks them",
  use_spell_slot: "spends a slot", learn_spell: "adds a spell",
  // Pets and mounts.
  summon_pet: "calls a creature", pet_attack: "a bound creature's attack: listed in UNREACHED below", dismiss_pet: "sends it away", mount_up: "mounts", dismount: "dismounts",
  // Sheets, items and coin.
  apply_damage: "damage the GM states; a concentrating target's save is concentration.damage's row", party_stash: "the stash", party_award: "an award", modify_gold: "coin",
  grant_item: "an item", reveal_item: "an item", remove_item: "an item", handle_item: "an item", use_item: "potions and scrolls: listed in UNREACHED below",
  purchase: "a purchase", set_condition: "a condition", set_effect: "an effect", clear_effect: "an effect", clear_condition: "a condition", update_sheet: "the sheet",
  add_companion: "a companion", dismiss_companion: "a companion",
  // The world.
  move_party: "the party's place", update_location: "the place", start_scene: "opens a scene", end_scene: "closes a scene", set_weather: "the weather",
  pass_time: "the clock", roll_treasure: "the GM's treasure dice", check_notice: "passive scores, no dice: check_notice.active is its row", set_npc: "a person", npc_reaction: "the person's 2d6",
  romance_advance: "a courtship stage", relationship_end: "ends a bond", relationship_scheme: "an NPC's scheme", request_player_input: "a question",
  send_whisper: "a whisper", record_event: "the chronicle", complete_beat: "the arc", write_campaign_note: "a note", recall_story: "memory", search_lore: "lore",
  read_card: "prep", generate_image: "a picture", set_ambience: "sound", show_title: "a title", play_sting: "sound", show_handout: "a handout", dismiss_handout: "a handout",
  set_quest: "a quest", tick_objective: "a quest", adjust_reputation: "a faction", faction_note: "a faction", generate_settlement: "a town", open_shop: "a shop",
  set_lifestyle: "a lifestyle", move_token: "a token: opportunity.enemy_walks_off is its row", enemy_attack: "the creature's dice: enemy_attack.rider_save is its row",
};
await test("every console form has a row or a reason, and a form with a reason throws no d20 of the seat's when filled blind", async () => {
  const driven = new Set(rows.map((entry) => entry.tool));
  const missing = ADJUDICATIONS.map((entry) => entry.name).filter((name) => !driven.has(name) && !NO_ROW[name]);
  assert.deepEqual(missing, [], `console forms with no row and no reason: ${missing.join(", ")}`);
  const stale = Object.keys(NO_ROW).filter((name) => !adjudication(name));
  assert.deepEqual(stale, [], `reasons for forms that no longer exist: ${stale.join(", ")}`);
  const threw = [];
  for (const stage of ["out", "fight"]) {
    await reset(stage);
    for (const name of Object.keys(NO_ROW)) {
      if (["end_encounter", "add_enemies", "end_scene", "start_scene"].includes(name)) continue;
      const form = entryOf(name);
      const args = formArgs(form, ctx(), { fill: form.fields.filter((field) => field.kind === "character" || field.kind === "characters").map((field) => field.name).slice(0, 1) });
      spy.take();
      try {
        await world.invoke(name, args);
      } catch {
        // A blind form the engine cannot read is a refusal like any other.
      }
      const mine = d20sOf(spy.take()).filter((die) => taggedFor(die, hero.name) || (!die.purpose && UNTAGGED_HERO_SITES.has(siteAt(die)?.id)));
      if (mine.some((die) => !RULED_SITES[siteAt(die)?.id])) threw.push(`${name} (${stage})`);
      dropParked();
    }
  }
  assert.deepEqual(threw, [], `forms said to throw nothing of the seat's that did: ${threw.join(", ")}`);
});

// Every call in src/ that throws dice, classified. "H": a character's d20
// (a row must reach it, or UNREACHED says why this sweep cannot). "S": the
// seat's own answer to a card. "D": a character's other dice. "F": a
// creature's, an NPC's or the world's.
const SITES = {
  "app/api/campaigns/[campaignId]/dm/roll-tables/[tableId]/roll/route.ts#POST": "F the GM's roll table",
  "app/api/campaigns/[campaignId]/pending-rolls/[pendingRollId]/portent/route.ts#POST": "S Portent's number on a parked roll",
  "app/api/campaigns/[campaignId]/pending-rolls/[pendingRollId]/route.ts#POST": "S Roll digitally, a held roll let go (test-enforce-sweep-dice-paths.mjs)",
  "app/api/campaigns/[campaignId]/rolls/route.ts#POST": "S the player's own dice tray",
  // Cosmic Omen's d6, rolled with a roll it was set on at the watch stop
  // (foresight-before.ts): a character's die beside another's d20.
  "lib/db/dice-scripts.ts#takeArmedBefore": "D Cosmic Omen's d6 on a roll set at the watch stop (test-enforce-before-roll.mjs)",
  "lib/db/sheets.ts#capAttunement": "F an item's starting charges, rolled as it is granted (item-charge-rules.ts withStartingCharges): the item's dice, not a throw of the wearer's",
  "lib/dice/tray-rules.ts#trayExpressionProblem": "F reads an expression",
  "lib/dm/action-common.ts#rollEnemyContest": "F the creature's side of a contest",
  "lib/dm/advance-tick.ts#tickAdvances": "F d100",
  "lib/dm/after-roll.ts#rerollD20s": "H an extra d20 on the after-the-roll card (Lucky, Chronal Shift)",
  "lib/dm/after-roll.ts#spendAfterRoll": "H the die or d20 a choice on the after-the-roll card adds",
  "lib/dm/mt-fb-runes.ts#spendPropheticState": "H the d20 the Storm Rune's prophetic state adds on the after-the-roll card",
  "lib/dm/aoe-damage.ts#handleAoeDamage": "D area damage",
  "lib/dm/mt-mr-offers.ts#dieOf": "H the Psionic Energy die a choice on the after-the-roll card adds (Homing Strikes, Psi-Bolstered Knack)",
  "lib/dm/mt-mr-offers.ts#rerolled": "H a d20 thrown again from the after-the-roll card (Unerring Accuracy, Draconic Presence)",
  "lib/dm/ar-ws-bombardment.ts#spellBombardment": "D a spell's exploded damage die (Spell Bombardment), where the area roll's own card carries it",
  "lib/dm/attack-blow.ts#throwDamage": "D an attack's damage on the server's dice",
  "lib/dm/attack-onhit.ts#hurlReturn": "D", "lib/dm/attack-onhit.ts#poisonOnHit": "D",
  "lib/dm/between-io.ts#publicDie": "F a table die",
  "lib/dm/character-roll.ts#initiativeWaits": "F no die: the lowest initiative, to read what the after-the-roll card would offer",
  "lib/dm/character-roll.ts#rollAtDoor": "H the one door a character's d20 is thrown through (src/lib/dm/character-roll.ts rollCharacterD20)",
  "lib/dm/chronal-shift.ts#takeSaveHelp": "D Flash of Genius and Favored by the Gods' dice",
  "lib/dm/combat-features.ts#divineIntervention": "D d100",
  "lib/dm/companion-agenda.ts#agendaRounds": "F a companion's own agenda",
  "lib/dm/contest-roll.ts#checkCeiling": "F no die: the highest the check could reach",
  "lib/dm/death.ts#rollStableTimer": "F 1d4 hours",
  "lib/dm/encounter-tools.ts#ensureInitiativeProgress": "H",
  // A foe's blow the Cloud Rune turned onto another creature, its damage rolled for them.
  "lib/dm/cloud-rune.ts#landTurnedBlow": "F",
  "lib/dm/enemy-attack.ts#handleEnemyAttack": "F", "lib/dm/enemy-fall.ts#enemyFalls": "F", "lib/dm/enemy-hit-rows.ts#resolveRowOnHit": "F",
  "lib/dm/enemy-hit.ts#resolveOnHit": "F", "lib/dm/enemy-strike.ts#enemyStrikesEnemy": "F",
  "lib/dm/feat-reactions.ts#lucky": "H the Lucky feat's d20 against an attacker", "lib/dm/feat-reactions.ts#reservesRecovery": "D a hit die",
  "lib/dm/forced-save.ts#rollCharacterSave": "H", "lib/dm/forced-save.ts#rollEnemySave": "F", "lib/dm/forced-save.ts#settleHeldDie": "D a held Bardic die",
  "lib/dm/foresight-more.ts#damageCeiling": "F no die: the most a blow could deal, to read whether it could drop the hero before the watch stop",
  "lib/dm/foretold-logic.ts#rollForetold": "H Portent's two d20s at the long rest",
  "lib/dm/rest-logic.ts#longRestPatch": "D Cosmic Omen's die at the long rest: its parity is the omen, never a roll's d20",
  "lib/dm/gear-weapon-hit.ts#enemyExtinguish": "F", "lib/dm/hazard-tools.ts#resolveHazard": "F which target a trap picks",
  "lib/dm/hit-dice.ts#spendHitDice": "D hit dice",
  "lib/dm/invoke-roll.ts#handleRequestRoll": "H",
  "lib/dm/item-charges.ts#rechargeAtDawn": "F", "lib/dm/item-charges.ts#spendChargesMath": "H the d20 on an item's last charge",
  "lib/dm/mount-combat.ts#strikeMount": "F", "lib/dm/natural-onhit.ts#landNaturalOnHit": "D", "lib/dm/npc-agency.ts#advanceNpcAgency": "F",
  "lib/dm/object-damage.ts#damageObject": "F the damage the GM names for an object, which no character's roll dealt",
  "lib/dm/opportunity-sides.ts#enemiesStrikeWalker": "F", "lib/dm/opportunity.ts#resolveOpportunityAttacks": "F",
  "lib/dm/pc-attack-resolve.ts#throwToHit": "H",
  "lib/dm/pet-tools.ts#handlePetAttack": "H a bound creature's attack, which its player rolls",
  "lib/dm/prismatic.ts#rollRays": "D",
  "lib/dm/roll-card.ts#dmRoll": "F the GM's dice", "lib/dm/roll-card.ts#rollCard": "D a helper for damage, healing and creature dice", "lib/dm/roll-card.ts#secretRoll": "F",
  "lib/dm/roll-gates.ts#rollContest": "F",
  "lib/dm/slow-cast.ts#slowHoldsCast": "H the d20 a slowed caster rolls",
  "lib/dm/social-tools.ts#handleNpcReaction": "F",
  "lib/dm/zone-quake.ts#quakeFissures": "F",
  "lib/dm/fate-turn.ts#turned": "D Bend Luck's d4 on another creature's roll (a call already rolled)",
  "lib/dm/mount-area.ts#areaOnMount": "F a mount's own Dexterity save against an area that caught its rider",
};
// A character's d20 no row of this suite reaches, and what it would take.
const UNREACHED = {
  "lib/dm/after-roll.ts#rerollD20s": "thrown from the after-the-roll card: test-enforce-sweep-dice-windows.mjs",
  "lib/dm/after-roll.ts#spendAfterRoll": "thrown from the after-the-roll card: test-enforce-sweep-dice-windows.mjs",
  "lib/dm/mt-mr-offers.ts#dieOf": "thrown from the after-the-roll card: test-enforce-sweep-clauses-martial-rogue.mjs (homing-strikes, psi-bolstered-knack)",
  "lib/dm/mt-fb-runes.ts#spendPropheticState": "thrown from the after-the-roll card: test-enforce-sweep-clauses-martial-fighter.mjs (rune-storm-prophetic-allies)",
  "lib/dm/mt-mr-offers.ts#rerolled": "thrown from the after-the-roll card: test-enforce-sweep-clauses-martial-monk.mjs (unerring-accuracy, draconic-presence)",
  "lib/dm/encounter-tools.ts#ensureInitiativeProgress": "skips held seats by its own filter (encounter-tools.ts: !held.has(sheet.userId)); test-real-dice-initiative.mjs holds it",
  "lib/dm/feat-reactions.ts#lucky": "needs the Lucky feat and an open hit on the seat",
  "lib/dm/foretold-logic.ts#rollForetold": "needs a Divination wizard's long rest",
  "lib/dm/forced-save.ts#rollCharacterSave": "the server's own throw of a forced save, which a seat on physical dice never reaches now (character-roll.ts parks it, as cast_at_player.hazard shows); test-enforce-sweep-dice-afterroll.mjs reaches it on the server's dice",
  "lib/dm/item-charges.ts#spendChargesMath": "needs a wand's last charge",
  "lib/dm/pc-attack-resolve.ts#throwToHit": "pc_attack parks for the seat, so the server's throw is never reached (pc_attack.weapon, pc_attack.spell)",
  "lib/dm/pet-tools.ts#handlePetAttack": "needs a bound creature",
  "lib/dm/slow-cast.ts#slowHoldsCast": "needs a slowed caster",
};
await test("every roll site in src/ is classified, and every site that throws a character's d20 is reached by a row or says why not", () => {
  const ids = [...new Set(sites.map((site) => site.id))];
  const unknown = ids.filter((id) => !SITES[id]);
  assert.deepEqual(unknown, [], `roll sites this suite has not classified: ${unknown.join(", ")}`);
  const gone = Object.keys(SITES).filter((id) => !ids.includes(id));
  assert.deepEqual(gone, [], `classified sites no longer in src/: ${gone.join(", ")}`);
  const hero = ids.filter((id) => SITES[id].startsWith("H"));
  const cold = hero.filter((id) => !reached.has(id) && !UNREACHED[id]);
  assert.deepEqual(cold, [], `sites that throw a character's d20 and no row reached: ${cold.join(", ")}`);
  const warm = Object.keys(UNREACHED).filter((id) => reached.has(id));
  assert.deepEqual(warm, [], `sites said to be unreached that a row now reaches: ${warm.join(", ")}`);
});

console.log(`rows: ${rows.length} (${Object.values(tally).reduce((sum, count) => sum + count, 0)} runs over two doors) ${JSON.stringify(tally)}; forms with a reason and no row: ${Object.keys(NO_ROW).length}; roll sites classified: ${Object.keys(SITES).length}, unreached: ${Object.keys(UNREACHED).length}`);
for (const [site, ids] of Object.entries(ruledRows)) {
  console.log(`  RULED ${site} (${RULED_SITES[site]}): ${ids.size} rows`);
}

world.close();
finish();
