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
//
// Then the row's record (issue #915). The seat enters its own dice for every
// card the row parked, so the call runs to its end, and every roll the call
// stored is held to six things:
//
//   home    it is on one turn once, or on the one line its site posted for
//           it: a roll on neither is thrown on the dice stage and never shown
//           in the chronicle (scripts/lib/roll-homes.mjs);
//   sent    it is sent as it was made: dice the seat entered are on record
//           and sent as physical, so the stage does not throw them again, and
//           the server's own as digital;
//   roller  it names who rolled it: an attack or damage roll with no roller
//           reads as the roll of the character it lands on (a fall, a trap).
//           A roll nobody made names its source (src/lib/roll-sources.ts),
//           which goes in front of its card: its words do not say the source
//           a second time, and they name the character it lands on.
//   asked   it is marked as a roll an AI GM asked for only where that GM's
//           own request_roll made it (issue #1073). The gate that holds an
//           AI GM's damage and healing numbers takes a total from the turn's
//           asked list and from nowhere else (src/lib/dm/ai-gate.ts), so a
//           site that marked its own dice would let the model send their
//           total as a number of its own. Every other row, at either door,
//           leaves the list empty: that holds for every site here at once,
//           and for a site added later. An AI GM's request_roll marks the
//           one roll it asked for, whether the server threw it or the seat
//           entered it for the card.
//   parts   it says in its fields what a rule reads back from it (issue
//           #1064, src/lib/roll-parts.ts): a rule no longer reads a roll's
//           words, so a check, save or attack whose words name a skill, an
//           ability, the save that keeps concentration or a carried weapon,
//           and whose fields do not, is one the rule has stopped seeing.
//   words   it says its words in its fields where its family has moved
//           (issue #1064, step 2, src/lib/roll-words.ts). A roll whose
//           parts make its words stores the sentence they make and no
//           other, names every target in it, carries only notes that are
//           the engine's own, and a key that is a real row. The one
//           typed note a moved family writes is a damage type of a stat
//           block's own making (roll-parts.ts riderNote), which no row here
//           has, so one stored here is an engine's words in a person's
//           field. And the rows of a family that has moved (WORDED_ROWS)
//           store no attack or damage roll of that family's (the seat's
//           own, or a creature's: FAMILY_ROLLS) whose site wrote its own
//           sentence, nor deal a card for one: a site there that goes back
//           to writing its sentence fails its row. A missing French line
//           fails nothing: the words read in English.
//
// One function does all of these (src/lib/dm/roll-record.ts recordRoll), and
// every row passes all six. `rows` in scripts/roll-record-sites.json held
// the rows whose site recorded its roll by hand and missed one, with the
// checks each failed; it is empty now. A row that fails a check it is not
// listed there for fails this suite, and so does a row listed for a check
// it passes.
// The dice the server throws are seeded row by row, so a row stores the same
// rolls on every run. `ODM_SWEEP_ROWS=print` prints the list as it stands.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld, seedDice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine } from "./lib/enforce-narrator.mjs";
import { d20sOf, formArgs, installDiceSpy, staticRollSites, taggedFor } from "./lib/sweep-dice.mjs";
import { announced, askedOn, homeProblem, lastSeq, rollHomes, rollMark, rollsAfter } from "./lib/roll-homes.mjs";

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
const { ABILITIES, rollAbility, rollKeepsConcentration, rollPhysical, rollSkill, rollWeaponRow } = await import("../src/lib/roll-parts.ts");
const { makesWords, ROLL_NOTES, rollSentence } = await import("../src/lib/roll-words.ts");
const { UNARMED_STRIKE_KEY, weaponNamed } = await import("../src/lib/srd/weapons.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { spellFactsFor } = await import("../src/lib/content/index.ts");
const { SRD_SKILLS } = await import("../src/lib/srd/index.ts");
const { REAL_DICE_SCOPE } = await import("../src/lib/dice/held-rolls.ts");
const { entryDice } = await import("../src/lib/dice.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
// The rows known to fail a check of their record, and which.
const RECORD_ROWS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "roll-record-sites.json"), "utf8")).rows ?? {};

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
const CONSOLE_ONLY = new Set(["opportunity.enemy_walks_off", "opportunity.enemy_flees", "cast_at_player.enemy", "aoe_damage.enemy_breath", "enemy_attack.rider_save"]);
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
// A creature fleeing the fight draws the same swing as its walk (enemy_flees, PR #930).
row("opportunity.enemy_flees", "enemy_flees", "fight-enemy-turn", (c) => ({ enemyId: c.enemyId, reason: "it runs" }));
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
  wake: (c) => ({ targetCharacterId: c.allyId }),
  ready: (c) => ({ readied: "attack", trigger: "it steps closer", targetEnemyId: c.enemyId }),
  use_object: { item: "Rope" },
  dash: {},
  dodge: {},
  disengage: {},
};
const ACTION_SETUP = {
  // The ally asleep from Sleep beside the hero (shake-awake.ts).
  wake: (c) => world.patch(c.allyId, { conditions: ["unconscious"], conditionMeta: { unconscious: { spell: "Sleep", source: c.enemyId, rounds: 10, endsOnDamage: true } } }),
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

// ---- the row's record ----

// The face the seat enters for a die: a d20 that hits a goblin and passes a
// DC 10, and the middle of any other die.
const faceFor = (sides) => (sides === 20 ? 13 : Math.ceil(sides / 2));

// The seat enters its own dice for every card the row parked, and for each
// card the call parks next (a hit's damage, a second roll), until none waits.
// Returns the cards entered.
async function enterParked() {
  const entered = [];
  for (let round = 0; round < 8; round += 1) {
    const open = listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === hero.userId && pending.parkedFor === "real_dice");
    if (!open.length) {
      break;
    }
    for (const pending of open) {
      world.signIn({ id: hero.userId });
      const landed = await call(submitRoute, "POST", { dice: entryDice(pending.expression).map(faceFor) }, { campaignId: world.campaignId, pendingRollId: pending.id });
      if (landed.status !== 200) {
        throw new Error(`the seat's ${pending.kind} (${pending.expression}) was not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
      }
      entered.push({ id: pending.id, kind: pending.kind });
    }
  }
  return entered;
}

// What is wrong with the record of the rolls stored since `mark`, check by check.
// What a source can say it is (src/lib/db/rolls.ts HazardKind).
const HAZARDS = new Set(["fall", "gm", "trap", "item", "effect", "named"]);

// What a rule read from a roll's words before its parts were stored, and its
// fields do not say: the same roll read both ways, as stored and as a roll
// from before the column would be.
const SKILL_IDS = SRD_SKILLS.map((skill) => skill.id);
function partsGaps(roll) {
  if (roll.parts === null) {
    return ["stored without its parts, so it is read by its words"];
  }
  const sheet = roll.characterId ? world.sheet(roll.characterId) : null;
  if (!sheet) {
    return [];
  }
  const worded = { ...roll, parts: null };
  const gaps = [];
  const differs = (what, read) => {
    const [said, held] = [read(worded), read(roll)];
    if (said && said !== held) {
      gaps.push(`its words say ${what} "${said}", and its fields ${held ? `"${held}"` : "nothing"}`);
    }
  };
  if (roll.kind === "skill_check" || roll.kind === "ability_check") {
    differs("the skill", (read) => rollSkill(read, SKILL_IDS));
  }
  if (roll.kind === "saving_throw" || roll.kind === "ability_check") {
    differs("the ability", (read) => rollAbility(read, ABILITIES));
  }
  if (roll.kind === "saving_throw") {
    differs("it keeps concentration:", (read) => (rollKeepsConcentration(read) ? "yes" : null));
  }
  if (roll.kind === "attack" && roll.attacker?.kind === "sheet" && roll.attacker.id === roll.characterId) {
    differs("the weapon", (read) => rollWeaponRow(read, sheet.equipment)?.name ?? null);
  }
  return gaps;
}

// The families that have moved (scripts/roll-parts-sites.json `moved`), each
// by whose attack and damage rolls it moved: the seat's own, or a
// creature's.
const FAMILY_ROLLS = {
  "a character's attacks and their damage": (said) => (said.attacker ? said.attacker.kind === "sheet" && said.attacker.id === hero.id : said.characterId === hero.id),
  "creatures' attacks and their damage": (said) => said.attacker?.kind === "enemy" || said.attacker?.kind === "pet",
};
// The rows whose call makes such an attack, by its family: its attack and
// damage rolls there say their words in fields.
const WORDED_ROWS = {
  "pc_attack.weapon": "a character's attacks and their damage",
  "pc_attack.spell": "a character's attacks and their damage",
  "damage_object.weapon": "a character's attacks and their damage",
  "opportunity.enemy_walks_off": "a character's attacks and their damage",
  "opportunity.enemy_flees": "a character's attacks and their damage",
  "enemy_attack.rider_save": "creatures' attacks and their damage",
};
// The tables a part's key is checked against, by what it names. A skill's
// or an ability's key is held by `parts` above.
// An unarmed strike is the engine's own row (src/lib/srd/weapons.ts).
// A creature's action has no table of rows: it is stored by its stat block's
// name, and has a key only where it is carried under more than that name
// ("Wolf Bite"), which then ends with the attack the key names.
const REAL_KEY = {
  weapon: (key) => key === UNARMED_STRIKE_KEY || Boolean(weaponNamed(key)),
  spell: (key) => Boolean(spellFactsFor(key)),
  skill: () => true,
  ability: () => true,
  action: (key, used) => textKey(used.name).endsWith(` ${key}`),
};

// What is wrong with the words of a roll, or of a card dealt for one: for
// parts that make the words, their structure; for a row of a family that
// has moved, that they do.
function wordsGaps(said, family) {
  const parts = said.parts;
  const own = (said.kind === "attack" || said.kind === "damage") && Boolean(FAMILY_ROLLS[family]?.(said));
  if (!makesWords(parts)) {
    return family && own ? [`its site wrote its own sentence, and its family ("${family}") says its words in fields (src/lib/roll-parts.ts)`] : [];
  }
  const gaps = [];
  if (said.detail !== rollSentence(said)) {
    gaps.push(`its stored sentence is not the one its parts make, "${rollSentence(said)}"`);
  }
  const used = parts.used;
  if (used?.key && !(REAL_KEY[used.kind] ?? (() => false))(used.key, used)) {
    gaps.push(`its key "${used.key}" is no row of what it says it is (${used.kind})`);
  }
  for (const note of parts.notes ?? []) {
    if (!(note.engine in ROLL_NOTES)) {
      gaps.push(`its note ${JSON.stringify(note)} is not one of the engine's own (src/lib/roll-words.ts ROLL_NOTES): nothing here is typed by a person`);
    }
  }
  if (parts.note !== undefined) {
    gaps.push("it carries a single `note`, which nothing reads: a roll's notes are a list");
  }
  for (const target of parts.targets ?? []) {
    if (target.kind !== "object" && !target.name) {
      gaps.push(`a target of kind ${target.kind} has no name`);
    } else if (target.name && !said.detail.includes(target.name)) {
      gaps.push(`its words do not name ${target.name}, whom it is against`);
    }
  }
  return gaps;
}

function recordProblems(mark, seq, cards, hazardRow = false, askedRow = false, family = null) {
  const rolls = rollsAfter(world.campaignId, mark);
  const problems = { home: [], sent: [], roller: [], asked: [], parts: [], words: [] };
  // The cards the seat was dealt, as they were kept.
  for (const card of cards) {
    const kept = getDatabase().prepare("SELECT detail, parts_json FROM pending_rolls WHERE id = ?").get(card.id);
    const dealt = { kind: card.kind, characterId: hero.id, detail: kept?.detail ?? "", parts: typeof kept?.parts_json === "string" ? JSON.parse(kept.parts_json) : null };
    problems.words.push(...wordsGaps(dealt, family).map((gap) => `the ${card.kind} card "${dealt.detail}": ${gap}`));
  }
  if (family && !rolls.some((roll) => roll.kind === "attack" && FAMILY_ROLLS[family](roll))) {
    problems.words.push(`the row is listed as one of "${family}" and stored no attack roll of that family's`);
  }
  const marked = [];
  const mine = (roll) => roll.characterId === hero.id || roll.attacker?.id === hero.id;
  // The roll each entered card became: the one its card names, else the
  // seat's next roll of that kind.
  const entered = new Set();
  for (const card of cards) {
    const named = getDatabase().prepare("SELECT roll_id FROM pending_rolls WHERE id = ?").get(card.id)?.roll_id;
    const roll = rolls.find((entry) => entry.id === named) ?? rolls.find((entry) => !entered.has(entry.id) && entry.kind === card.kind && mine(entry));
    if (roll) {
      entered.add(roll.id);
    } else {
      problems.sent.push(`the ${card.kind} the seat entered is on no record`);
    }
  }
  for (const roll of rolls) {
    const what = `${roll.kind} "${roll.detail}"`;
    problems.parts.push(...partsGaps(roll).map((gap) => `${what}: ${gap}`));
    problems.words.push(...wordsGaps(roll, family).map((gap) => `${what}: ${gap}`));
    // A roll card's roll (request_roll, an attack's parts) is on its turn
    // from the moment it lands, at either door: this row does not wait for
    // an AI's turn to resume, and no longer has to.
    const home = homeProblem(roll.id);
    if (home) {
      problems.home.push(`${what}: ${home}`);
    }
    // The mark is the turn's own: on the turn the roll is on, or on none.
    const askedTurns = askedOn(roll.id);
    if (askedTurns.length) {
      marked.push(roll);
      if (!askedRow) {
        problems.asked.push(`${what}: marked as a roll an AI GM asked for, and no GM's request_roll made it, so its total would pay for a number the GM sends`);
      } else if (askedTurns.length > 1 || !rollHomes(roll.id).turns.includes(askedTurns[0])) {
        problems.asked.push(`${what}: marked as asked for on a turn it is not on`);
      } else if (!mine(roll)) {
        problems.asked.push(`${what}: marked as asked for, and it is not the roll the GM asked for`);
      }
    }
    // A roll behind the screen is sent seat by seat and is not in the log
    // every seat may replay; what the log holds is read.
    const told = announced(world.campaignId, seq, roll.id).map((payload) => payload.source);
    if (entered.has(roll.id)) {
      if (!rollPhysical(roll)) {
        problems.sent.push(`${what}: the seat's own dice, and the record does not say so`);
      }
      if (told.some((source) => source !== "physical") || (roll.visibility === "public" && !told.length)) {
        problems.sent.push(`${what}: the seat's own dice, sent as [${told.join(", ")}]`);
      }
    } else if (told.some((source) => source !== "digital") || rollPhysical(roll)) {
      problems.sent.push(`${what}: the server's dice, sent as [${told.join(", ")}]`);
    } else if (roll.visibility === "public" && !told.length) {
      problems.sent.push(`${what}: the server's dice, for every seat, sent to none`);
    }
    if (!roll.attacker && roll.characterId && (roll.kind === "attack" || roll.kind === "damage") && !entered.has(roll.id)) {
      problems.roller.push(`${what}: nobody is named as rolling it, so it reads as the roll of the character it lands on`);
    } else if (!roll.attacker && !roll.characterId && roll.requestedBy !== "dm") {
      problems.roller.push(`${what}: names nobody`);
    }
    const lands = roll.characterId ? world.sheet(roll.characterId)?.name : null;
    if (roll.attacker?.kind === "hazard") {
      const by = roll.attacker;
      if (!HAZARDS.has(by.hazard)) {
        problems.roller.push(`${what}: its source, ${by.name}, says it is "${by.hazard}", which is no kind of source`);
      }
      // Whatever the case: the words in front of the card, in its words again.
      const said = roll.detail.toLowerCase();
      const again = by.hazard === "fall" ? "fall" : by.hazard === "gm" ? "the gm" : by.name.toLowerCase();
      if (said.includes(again)) {
        problems.roller.push(`${what}: says its source, ${by.name}, a second time`);
      }
      if (lands && !roll.detail.includes(lands)) {
        problems.roller.push(`${what}: ${by.name}'s roll does not name ${lands}, whom it lands on`);
      }
    } else if (hazardRow && roll.attacker?.kind === "sheet" && roll.attacker.id === roll.characterId && (roll.kind === "attack" || roll.kind === "damage")) {
      // A hazard's own row: what lands on a character there is not their roll.
      problems.roller.push(`${what}: a hazard's roll names ${lands}, whom it lands on, as its roller`);
    }
  }
  // An AI GM's own request_roll: the one roll it asked for is marked, so its
  // total can pay. With none marked the gate would refuse every total the GM
  // rolled, and with two a second one would pay.
  if (askedRow && rolls.some(mine) && marked.length !== 1) {
    problems.asked.push(`the AI GM's request_roll stored ${rolls.filter(mine).length} roll(s) of the seat's and ${marked.length} are marked as asked for, where one is`);
  }
  return { problems, rolls: rolls.length };
}
const CHECKS = ["home", "sent", "roller", "asked", "parts", "words"];
const recordNow = {};

async function run(entry, door, seed) {
  doorNow = door;
  // The server's dice from a seed of the row's own: the row stores the same
  // rolls on every run, so its record is the same.
  seedDice(seed);
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
  const mark = rollMark();
  const seq = lastSeq(world.campaignId);
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
  // The verdict is read before the seat answers: the dice it enters now are
  // its own, and the call runs on with them.
  const record = recordProblems(mark, seq, await enterParked(), /^(apply_hazard|cast_at_player\.hazard|concentration\.damage)/.test(entry.id), door === "ai" && entry.tool === "request_roll", WORDED_ROWS[entry.id] ?? null);
  spy.take();
  return { verdict, where: where.filter((id) => !RULED_SITES[id]), out, parked, dice, record };
}

const tally = { PARKED: 0, RULED: 0, THROWN: 0, QUIET: 0, REFUSED: 0 };
const ruledRows = {};
let stored = 0;
for (const [index, entry] of rows.entries()) {
  for (const door of CONSOLE_ONLY.has(entry.id) ? ["console"] : ["console", "ai"]) {
    const id = `${entry.id}@${door}`;
    const known = KNOWN[id] ?? KNOWN[entry.id];
    const refusedOk = REFUSED_OK[id] ?? REFUSED_OK[entry.id];
    let record = null;
    const play = async () => {
      const got = await run(entry, door, 9150 + index * 2 + (door === "ai" ? 1 : 0));
      record = got.record;
      stored += got.record.rolls;
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
    const listed = RECORD_ROWS[id] ?? [];
    await test(`${id}: every roll the call stored has one home, is sent as it was made, names its roller, is marked as asked for only by an AI GM's own request_roll, says in its fields what a rule reads back and says its words in them where its family has moved${listed.length ? ` (listed as failing: ${listed.join(", ")})` : ""}`, () => {
      assert.ok(record, `${id} did not run to its record`);
      const failing = CHECKS.filter((check) => record.problems[check].length);
      if (failing.length) {
        recordNow[id] = failing;
      }
      const fresh = failing.filter((check) => !listed.includes(check));
      assert.deepEqual(fresh, [], `${id} fails a check of its record it is not listed for. Record the roll through recordRoll (src/lib/dm/roll-record.ts), with its parts (src/lib/roll-parts.ts).\n  ${fresh.flatMap((check) => record.problems[check].map((problem) => `${check}: ${problem}`)).join("\n  ")}`);
      const closed = listed.filter((check) => !failing.includes(check));
      assert.deepEqual(closed, [], `${id} now passes ${closed.join(", ")}: strike it from "rows" in scripts/roll-record-sites.json.`);
    });
  }
}
seedDice(null);
if (process.env.ODM_SWEEP_ROWS === "print") {
  console.log(`ROWS ${JSON.stringify(recordNow)}`);
}
await test("every row listed as one of a family that says its words in fields is a row of this suite", () => {
  const stale = Object.keys(WORDED_ROWS).filter((id) => !rows.some((entry) => entry.id === id));
  assert.deepEqual(stale, [], `listed in WORDED_ROWS and not a row here: ${stale.join(", ")}`);
});
await test("every row listed as failing a check of its record is a row of this suite", () => {
  const stale = Object.keys(RECORD_ROWS).filter((id) => !rows.some((entry) => id === `${entry.id}@console` || id === `${entry.id}@ai`));
  assert.deepEqual(stale, [], `listed in scripts/roll-record-sites.json and not a row here: ${stale.join(", ")}`);
});

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
  legendary_action: "a creature's action", declare_intent: "a creature's intent",
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
  pass_time: "the clock", roll_treasure: "the GM's treasure dice", check_notice: "passive scores, no dice: check_notice.active is its row", set_npc: "a person", npc_state: "an NPC's body, no dice", npc_reaction: "the person's 2d6",
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
  "lib/dm/regeneration-ring.ts#ringHeals": "F a Ring of Regeneration's d6 for every ten minutes the clock moves (test-audit1115-rests.mjs R06): the item's healing dice, not a throw of the wearer",
  "lib/dm/mummy-rot.ts#mummyRotClock": "F the curse's daily 3d6 off the hit point maximum (test-enforce-mummy-rot.mjs): the disease's dice, not a throw of the cursed",
  "lib/dm/after-roll.ts#rerollD20s": "H an extra d20 on the after-the-roll card (Lucky, Chronal Shift)",
  "lib/dm/after-roll.ts#spendAfterRoll": "H the die or d20 a choice on the after-the-roll card adds",
  "lib/dm/mt-fb-runes.ts#spendPropheticState": "H the d20 the Storm Rune's prophetic state adds on the after-the-roll card",
  "lib/dm/aoe-damage.ts#handleAoeDamage": "D area damage",
  "lib/dm/pending-roll-land.ts#settleSkippedStages": "D a hit's owed damage, thrown as the Roll digitally fallback when the lead skips the turn (test-enforce-after-roll-attacks.mjs)",
  // The dirgesinger's inspiration die exploding on its highest face (The
  // Final Movement, genre-cc-a-saves.ts): the die rides a d20 already thrown.
  "lib/dm/genre-cc-a-saves.ts#explodedDie": "D an inspiration die rolled again on its highest face (The Final Movement)",
  "lib/dm/genre-gb-aeronaut.ts#grapnelAce": "F the creature's Strength against Grapnel Ace's trip or disarm",
  "lib/dm/genre-gh-horror-plays.ts#riteOfSeverance": "F the possessing entity's Wisdom against the Rite of Severance",
  "lib/dm/mt-mr-offers.ts#dieOf": "H the Psionic Energy die a choice on the after-the-roll card adds (Homing Strikes, Psi-Bolstered Knack)",
  "lib/dm/mt-mr-offers.ts#rerolled": "H a d20 thrown again from the after-the-roll card (Unerring Accuracy, Draconic Presence)",
  "lib/dm/ar-ws-bombardment.ts#spellBombardment": "D a spell's exploded damage die (Spell Bombardment), where the area roll's own card carries it",
  "lib/dm/attack-damage-dice.ts#throwDamage": "D an attack's damage on the server's dice",
  // An opportunity attack's damage with Great Weapon Fighting's rerolls,
  // thrown through the character's door as its throwIt (audit 1116, A06).
  "lib/dm/opportunity-strike.ts#pcOpportunitySwing": "D an opportunity attack's damage, its 1s and 2s rerolled for Great Weapon Fighting",
  "lib/dm/attack-onhit.ts#poisonOnHit": "D",
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
  "lib/dm/feat-reactions.ts#secondChance": "F the attacker's d20 that a halfling's Second Chance makes it roll again",
  "lib/dm/bountiful-luck.ts#withOneRolledAgain": "H an ally's natural 1 rolled again from the after-the-roll card (Bountiful Luck)",
  "lib/dm/lineage-after-roll.ts#spendLineageAfterRoll": "D Lucky Footwork's d4 added to a failed Dexterity save",
  "lib/dm/forced-save.ts#rollCharacterSave": "H", "lib/dm/forced-save.ts#rollEnemySave": "F", "lib/dm/forced-save.ts#settleHeldDie": "D a held Bardic die",
  "lib/dm/foresight-more.ts#damageCeiling": "F no die: the most a blow could deal, to read whether it could drop the hero before the watch stop",
  "lib/dm/foretold-logic.ts#rollForetold": "H Portent's two d20s at the long rest",
  "lib/dm/rest-logic.ts#longRestPatch": "D Cosmic Omen's die at the long rest: its parity is the omen, never a roll's d20",
  "lib/dm/gear-weapon-hit.ts#enemyExtinguish": "F", "lib/dm/hazard-tools.ts#resolveHazard": "F which target a trap picks",
  "lib/dm/hit-dice.ts#spendHitDice": "D hit dice",
  "lib/dm/invoke-roll.ts#handleRequestRoll": "H",
  "lib/dm/item-charges.ts#rechargeAtDawn": "F", "lib/dm/item-charges.ts#spendChargesMath": "H the d20 on an item's last charge",
  "lib/dm/mount-combat.ts#strikeMount": "F", "lib/dm/natural-onhit.ts#resolveNaturalOnHit": "D", "lib/dm/npc-agency.ts#advanceNpcAgency": "F",
  "lib/dm/object-damage.ts#damageObject": "F the damage the GM names for an object, which no character's roll dealt",
  "lib/dm/opportunity-sides.ts#enemiesStrikeWalker": "F", "lib/dm/opportunity.ts#resolveOpportunityAttacks": "F",
  "lib/dm/opportunity-pets.ts#strikePetsOnWalk": "F",
  "lib/dm/pet-strike.ts#strikePet": "F", "lib/dm/pet-strike.ts#landRider": "F",
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
  "lib/dm/mount-blow.ts#mountRider": "F a mount's own save against the rider a creature's hit carries, and the rider's damage, rolled by the server as a pet's are",
  "lib/dm/pet-save-roll.ts#rollPetSave": "F a pet's own save against an area or an effect that caught it, rolled by the server as a mount's is",
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
  "lib/dm/bountiful-luck.ts#withOneRolledAgain": "thrown from the after-the-roll card: test-enforce-sweep-clauses-feats.mjs (feat.bountiful-luck.reroll)",
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

console.log(`rows: ${rows.length} (${Object.values(tally).reduce((sum, count) => sum + count, 0)} runs over two doors) ${JSON.stringify(tally)}; rolls on record: ${stored}, rows failing a check of their record: ${Object.keys(recordNow).length}; forms with a reason and no row: ${Object.keys(NO_ROW).length}; roll sites classified: ${Object.keys(SITES).length}, unreached: ${Object.keys(UNREACHED).length}`);
for (const [site, ids] of Object.entries(ruledRows)) {
  console.log(`  RULED ${site} (${RULED_SITES[site]}): ${ids.size} rows`);
}

world.close();
finish();
