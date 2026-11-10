// Lifecycle sweep, part 4: the revert differential.
//
// "Revert this turn" promises the table as the turn found it (issue 685;
// src/app/api/campaigns/[campaignId]/audit/revert-turn/route.ts: "so each
// field lands back on its pre-turn value", "the fight and the board as the
// turn found them"). The property, for ONE call of EVERY tool in the
// adjudication catalog (src/lib/dm/invoke-catalog.ts ADJUDICATIONS):
//
//   snapshot every table -> make the call from the console -> revert the
//   call's turn -> snapshot again: no state table differs.
//
// A tool that writes a sheet with no audit row, or a table the turn's kept
// rows do not cover, leaves residue and shows here. The suite walks the
// catalog: a tool added tomorrow with no recipe below fails it (a row is
// never skipped silently), and a tool whose residue is fixed fails it until
// its KNOWN entry is removed.
//
// Record tables (the audit, the turns, the transcript, the dice rolled) are
// not state (scripts/lib/sweep-lifecycle.mjs LOG_TABLES).
import assert from "node:assert/strict";
import fs from "node:fs";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";
import { stage } from "./lib/sweep-lifecycle-stage.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-lifecycle-revert");
const { ADJUDICATIONS } = await import("../src/lib/dm/invoke-catalog.ts");
const { insertFaction } = await import("../src/lib/db/factions.ts");

const REPORT = process.env.SWEEP_REPORT ?? null;
const report = [];

const RULE =
  "Revert this turn: \"Party lead reverts every live sheet change from one DM turn, newest first, so each field lands back on its pre-turn value ... the fight and the board as the turn found them\" (revert-turn/route.ts, issue 685)";

// ---- one recipe per tool --------------------------------------------------
//
// stage: "fight" (on the fighter's turn, beside the first dummy) or "calm".
// before(ctx): staging the call needs, made before the first snapshot.
// args(ctx): the call. dice: faces queued for it.
// A tool may have several named variants (hero and enemy, hit and miss).
const one = (stageKind, args, extra = {}) => [{ variant: "", stage: stageKind, args, ...extra }];

const goblin = [{ monster: "goblin", count: 1 }];

async function must(ctx, name, args, dice = []) {
  ctx.world.clearDice();
  ctx.world.dice(...dice);
  const out = await ctx.world.invoke(name, args);
  ctx.world.clearDice();
  if (!out.ok) {
    throw new Error(`staging ${name} refused: ${out.error}`);
  }
  return out;
}

const guild = (c) => insertFaction(c.world.campaignId, { name: "Millers' Guild", description: "Grain and gossip.", standing: 0 });
const MILL = { name: "The Old Mill", layoutDescription: "A leaning mill by a slow river.", visionClear: true };

const RECIPES = {
  start_encounter: one("calm", () => ({ enemies: goblin }), { dice: [3, 15, 15] }),
  add_enemies: one("fight", () => ({ enemies: goblin }), { dice: [10] }),
  pc_attack: [
    { variant: "hit", stage: "fight", args: (c) => ({ characterId: c.hero.id, targetEnemyId: c.e1.id, weapon: "Longsword" }), dice: [15, 4] },
    {
      // The blow that ends the fight: what the turn kept must have been kept before it.
      variant: "kills the last foe",
      stage: "fight",
      before: async (c) => {
        await must(c, "enemy_flees", { enemyId: c.e2.id, reason: "routed" });
        c.kit.setEnemy(c.e1.id, { currentHp: 1 });
        c.kit.giveTurn(c.hero.id);
      },
      args: (c) => ({ characterId: c.hero.id, targetEnemyId: c.e1.id, weapon: "Longsword" }),
      dice: [15, 4],
    },
    { variant: "kill", stage: "fight", before: (c) => c.kit.setEnemy(c.e1.id, { currentHp: 1 }), args: (c) => ({ characterId: c.hero.id, targetEnemyId: c.e1.id, weapon: "Longsword" }), dice: [15, 4] },
  ],
  enemy_attack: [
    { variant: "hit", stage: "fight", args: (c) => ({ enemyId: c.e1.id, targetCharacterId: c.hero.id }), dice: [15, 3] },
    { variant: "drop", stage: "fight", before: (c) => c.world.patch(c.hero.id, { currentHp: 2 }), args: (c) => ({ enemyId: c.e1.id, targetCharacterId: c.hero.id }), dice: [15, 6] },
  ],
  cast_at_enemy: [
    { variant: "hold person", stage: "fight", before: (c) => c.kit.giveTurn(c.mage.id), args: (c) => ({ characterId: c.mage.id, targetEnemyId: c.e1.id, spell: "Hold Person", saveAbility: "wis", level: 2 }), dice: [1] },
    { variant: "magic missile", stage: "fight", before: (c) => c.kit.giveTurn(c.mage.id), args: (c) => ({ characterId: c.mage.id, targetEnemyId: c.e1.id, spell: "Magic Missile", level: 1 }), dice: [3, 3, 3] },
  ],
  cast_at_player: one("fight", (c) => ({ characterId: c.hero.id, saveAbility: "dex", dc: 13, damage: "2d6", damageType: "fire", halfOnSave: true, casterEnemyId: c.e1.id, condition: "poisoned", rounds: 3 }), { dice: [1, 3, 3] }),
  cast_buff: [
    { variant: "bless", stage: "fight", before: (c) => c.kit.giveTurn(c.mage.id), args: (c) => ({ characterId: c.mage.id, spell: "Bless", targetCharacterIds: [c.hero.id, c.mage.id], level: 1 }) },
    { variant: "mage armor", stage: "calm", args: (c) => ({ characterId: c.mage.id, spell: "Mage Armor", targetCharacterIds: [c.mage.id], level: 1 }) },
  ],
  aoe_damage: one("fight", (c) => ({ casterCharacterId: c.mage.id, spell: "Fireball", level: 3, enemyIds: [c.e1.id, c.e2.id] }), { before: (c) => c.kit.giveTurn(c.mage.id), dice: [1, 1, 3, 3, 3, 3, 3, 3, 3, 3] }),
  enemy_flees: one("fight", (c) => ({ enemyId: c.e2.id, reason: "routed" })),
  take_action: [
    { variant: "dodge", stage: "fight", args: (c) => ({ characterId: c.hero.id, action: "dodge" }) },
    { variant: "ready", stage: "fight", args: (c) => ({ characterId: c.hero.id, action: "ready", trigger: "the goblin moves", readied: "attack", targetEnemyId: c.e1.id }) },
    { variant: "grapple", stage: "fight", args: (c) => ({ characterId: c.hero.id, action: "grapple", targetEnemyId: c.e1.id }), dice: [18, 2] },
  ],
  use_reaction: one("fight", (c) => ({ characterId: c.mage.id, feature: "Shield", hit: c.e1.id }), {
    before: async (c) => {
      c.world.patch(c.mage.id, { currentHp: c.world.sheet(c.mage.id).currentHp - 6 });
      await c.world.hitBy(c.mage.id, { enemyId: c.e1.id, name: c.e1.displayName, total: 14, vsAc: 12, raw: 6 });
    },
  }),
  apply_hazard: one("calm", (c) => ({ type: "falling", characterIds: [c.hero.id], feet: 20 }), { dice: [3, 3] }),
  end_turn: one("fight", (c) => ({ characterId: c.hero.id })),
  end_encounter: one("fight", () => ({ outcome: "victory" })),
  summon_pet: one("calm", (c) => ({ characterId: c.hero.id, kind: "other", form: "clockwork crow", name: "Patch", hp: 6, ac: 13 })),
  pet_attack: one("fight", (c) => ({ characterId: c.hero.id, petName: "Patch", targetEnemyId: c.e1.id }), {
    before: (c) => must(c, "summon_pet", { characterId: c.hero.id, kind: "other", form: "wolf", name: "Patch", hp: 11, ac: 13 }),
    dice: [15, 3, 3],
  }),
  dismiss_pet: one("calm", (c) => ({ characterId: c.hero.id, petName: "Patch" }), {
    before: (c) => must(c, "summon_pet", { characterId: c.hero.id, kind: "other", form: "clockwork crow", name: "Patch", hp: 6, ac: 13 }),
  }),
  move_token: [
    { variant: "enemy", stage: "fight", args: (c) => ({ token: c.e1.id, x: 7, y: 5 }) },
    { variant: "hero pushed", stage: "fight", before: (c) => c.kit.giveTurn(c.mage.id), args: (c) => ({ token: c.hero.id, x: 5, y: 7, forced: true, reason: "a shove" }) },
  ],
  declare_intent: one("fight", (c) => ({ actor: c.e1.id, verb: "raises its club", kind: "melee", target: c.hero.id })),
  set_movement: one("fight", (c) => ({ token: c.hero.id, movement: "fly" })),
  apply_damage: [
    { variant: "hero", stage: "fight", args: (c) => ({ characterId: c.hero.id, amount: 7, type: "fire" }) },
    { variant: "hero to 0", stage: "fight", args: (c) => ({ characterId: c.hero.id, amount: 50, type: "fire" }) },
    { variant: "enemy", stage: "fight", args: (c) => ({ enemyId: c.e1.id, amount: 7, type: "fire" }) },
    { variant: "enemy killed", stage: "fight", args: (c) => ({ enemyId: c.e1.id, amount: 70, type: "fire" }) },
    {
      variant: "kills the last foe",
      stage: "fight",
      before: (c) => must(c, "enemy_flees", { enemyId: c.e2.id, reason: "routed" }),
      args: (c) => ({ enemyId: c.e1.id, amount: 70, type: "fire" }),
    },
    {
      variant: "concentrating",
      stage: "fight",
      before: async (c) => {
        c.kit.giveTurn(c.mage.id);
        await must(c, "cast_buff", { characterId: c.mage.id, spell: "Bless", targetCharacterIds: [c.hero.id, c.mage.id], level: 1 });
      },
      args: (c) => ({ characterId: c.mage.id, amount: 9, type: "fire" }),
      dice: [1],
    },
  ],
  heal: one("fight", (c) => ({ characterId: c.hero.id, amount: 5 }), { before: (c) => c.world.patch(c.hero.id, { currentHp: 10 }) }),
  stabilize: one("fight", (c) => ({ characterId: c.hero.id, healerId: c.mage.id }), {
    before: (c) => {
      c.world.patch(c.hero.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 1, stable: false, dead: false } });
      c.kit.giveTurn(c.mage.id);
    },
    dice: [15],
  }),
  party_stash: one("calm", (c) => ({ do: "deposit", characterId: c.hero.id, gold: 5 })),
  party_award: one("calm", (c) => ({ characterIds: [c.hero.id, c.mage.id], xp: 50, gold: 5 })),
  modify_gold: one("calm", (c) => ({ characterId: c.hero.id, delta: 5 })),
  grant_item: one("calm", (c) => ({ characterId: c.hero.id, item: "Dagger", qty: 1 })),
  reveal_item: one("calm", (c) => ({ characterId: c.hero.id, item: "Strange ring", revealedName: "Ring of Protection" }), {
    before: (c) => must(c, "grant_item", { characterId: c.hero.id, item: "Strange ring", unidentified: true, srdName: "Ring of Protection" }),
  }),
  remove_item: one("calm", (c) => ({ characterId: c.hero.id, item: "Longbow", qty: 1 })),
  handle_item: [
    { variant: "drop in a fight", stage: "fight", args: (c) => ({ characterId: c.hero.id, action: "drop", item: "Longbow" }) },
    { variant: "hand", stage: "calm", args: (c) => ({ characterId: c.hero.id, action: "hand", item: "Longbow", toCharacterId: c.mage.id }) },
  ],
  use_item: one("fight", (c) => ({ characterId: c.hero.id, item: "Potion of Healing" }), { before: (c) => c.world.patch(c.hero.id, { currentHp: 10 }), dice: [2, 2] }),
  purchase: one("calm", (c) => ({ characterId: c.hero.id, action: "buy", item: "Dagger", qty: 1 })),
  use_resource: [
    { variant: "second wind", stage: "fight", before: (c) => c.world.patch(c.hero.id, { currentHp: 10 }), args: (c) => ({ characterId: c.hero.id, resource: "Second Wind" }), dice: [4] },
    { variant: "action surge", stage: "fight", args: (c) => ({ characterId: c.hero.id, resource: "Action Surge" }) },
  ],
  set_condition: [
    { variant: "hero", stage: "fight", args: (c) => ({ characterId: c.hero.id, condition: "poisoned", rounds: 3 }) },
    { variant: "enemy", stage: "fight", args: (c) => ({ enemyId: c.e1.id, condition: "frightened", rounds: 3, sourceCharacterId: c.hero.id }) },
    { variant: "exhaustion", stage: "calm", args: (c) => ({ characterId: c.hero.id, condition: "exhaustion", level: 2 }) },
  ],
  set_effect: one("fight", (c) => ({ characterId: c.hero.id, name: "Probe ward", field: "ac", mode: "add", value: 1, duration: "rounds", remaining: 3 })),
  clear_effect: one("fight", (c) => ({ characterId: c.hero.id, name: "Probe ward" }), {
    before: (c) => must(c, "set_effect", { characterId: c.hero.id, name: "Probe ward", field: "ac", mode: "add", value: 1, duration: "rounds", remaining: 3 }),
  }),
  clear_condition: [
    { variant: "hero", stage: "fight", before: (c) => must(c, "set_condition", { characterId: c.hero.id, condition: "poisoned", rounds: 3 }), args: (c) => ({ characterId: c.hero.id, condition: "poisoned" }) },
    { variant: "enemy", stage: "fight", before: (c) => must(c, "set_condition", { enemyId: c.e1.id, condition: "frightened", rounds: 3, sourceCharacterId: c.hero.id }), args: (c) => ({ enemyId: c.e1.id, condition: "frightened" }) },
  ],
  use_spell_slot: one("calm", (c) => ({ characterId: c.mage.id, level: 2, spell: "Detect Thoughts" })),
  learn_spell: one("calm", (c) => ({ characterId: c.mage.id, action: "add", spell: "Thunderwave" })),
  update_sheet: [
    { variant: "gold", stage: "calm", args: (c) => ({ characterId: c.hero.id, field: "gold", value: "75" }) },
    { variant: "maxHp", stage: "calm", args: (c) => ({ characterId: c.hero.id, field: "maxHp", value: "50" }) },
    { variant: "conditions", stage: "calm", args: (c) => ({ characterId: c.hero.id, field: "conditions", value: "poisoned" }) },
    { variant: "level", stage: "calm", args: (c) => ({ characterId: c.hero.id, field: "level", value: "6" }) },
  ],
  take_rest: [
    { variant: "short", stage: "calm", before: (c) => c.world.patch(c.hero.id, { currentHp: 10 }), args: (c) => ({ kind: "short", spend: [{ characterId: c.hero.id, dice: 1 }] }), dice: [5] },
    { variant: "long", stage: "calm", before: (c) => c.world.patch(c.hero.id, { currentHp: 10 }), args: () => ({ kind: "long" }) },
  ],
  add_companion: one("calm", () => ({ name: "Dorn", class: "fighter", race: "human", gender: "male", level: 3, kind: "party", personality: "Gruff and loyal." })),
  dismiss_companion: one("calm", (c) => ({ characterId: c.companionId, reason: "paid off" }), {
    before: async (c) => {
      const out = await must(c, "add_companion", { name: "Dorn", class: "fighter", race: "human", gender: "male", level: 3, kind: "party", personality: "Gruff and loyal." });
      c.companionId = out.result?.characterId ?? out.result?.id ?? c.world.sheets().find((sheet) => sheet.name === "Dorn")?.id;
    },
  }),
  move_party: one("calm", () => MILL),
  update_location: one("calm", () => ({ layoutDescription: "The mill's wheel has stopped.", visionClear: true }), { before: (c) => must(c, "move_party", MILL) }),
  travel: one("calm", () => ({ hours: 4, terrain: "normal", pace: "normal" })),
  start_scene: one("calm", (c) => ({ kind: "chase", title: "Over the rooftops", successesNeeded: 3, failuresAllowed: 3, characterIds: [c.hero.id, c.mage.id] })),
  scene_check: one("calm", (c) => ({ characterId: c.hero.id, approach: "leaps the gap", skill: "athletics", difficulty: "moderate" }), {
    before: (c) => must(c, "start_scene", { kind: "chase", title: "Over the rooftops", successesNeeded: 3, failuresAllowed: 3, characterIds: [c.hero.id, c.mage.id] }),
    dice: [15],
  }),
  end_scene: one("calm", () => ({ reason: "they got away" }), {
    before: (c) => must(c, "start_scene", { kind: "chase", title: "Over the rooftops", successesNeeded: 3, failuresAllowed: 3, characterIds: [c.hero.id, c.mage.id] }),
  }),
  mount_up: one("calm", (c) => ({ characterId: c.hero.id, mount: "Riding Horse" })),
  dismount: one("calm", (c) => ({ characterId: c.hero.id }), { before: (c) => must(c, "mount_up", { characterId: c.hero.id, mount: "Riding Horse" }) }),
  set_weather: one("calm", () => ({ sky: "clear", temperature: "hot" })),
  pass_time: one("calm", () => ({ amount: 2, unit: "hours" })),
  roll_treasure: one("calm", (c) => ({ cr: 2, characterIds: [c.hero.id], individual: true }), { dice: [50, 3, 3, 3, 3] }),
  damage_object: one("calm", (c) => ({ name: "Oak door", material: "wood", size: "medium", characterId: c.hero.id, weapon: "Longsword" }), { dice: [15, 5] }),
  group_check: one("calm", (c) => ({ skill: "stealth", difficulty: "moderate", characterIds: [c.hero.id, c.mage.id] }), { dice: [12, 12] }),
  check_notice: one("calm", (c) => ({ difficulty: "moderate", characterIds: [c.hero.id, c.mage.id] })),
  set_npc: one("calm", () => ({ name: "Old Marta", attitude: "friendly", trait: "hums while she works", gender: "female" })),
  npc_reaction: one("calm", () => ({ name: "Gate Sergeant", gender: "male" }), { dice: [4, 4] }),
  social_check: one("calm", (c) => ({ characterId: c.hero.id, npc: "Old Marta", approach: "persuade" }), {
    before: (c) => must(c, "set_npc", { name: "Old Marta", attitude: "indifferent", trait: "hums while she works", gender: "female" }),
    dice: [15],
  }),
  relationship_beat: one("calm", (c) => ({ characterId: c.hero.id, subject: "Old Marta", beat: "helped", note: "Carried her water." }), {
    before: (c) => must(c, "set_npc", { name: "Old Marta", attitude: "indifferent", trait: "hums while she works", gender: "female" }),
  }),
  romance_advance: one("calm", (c) => ({ characterId: c.hero.id, subject: "Old Marta", to: "interested" }), {
    before: (c) => must(c, "set_npc", { name: "Old Marta", attitude: "friendly", trait: "hums while she works", gender: "female" }),
  }),
  relationship_end: one("calm", (c) => ({ characterId: c.hero.id, subject: "Old Marta", reason: "parting" }), {
    before: async (c) => {
      await must(c, "set_npc", { name: "Old Marta", attitude: "friendly", trait: "hums while she works", gender: "female" });
      await must(c, "relationship_beat", { characterId: c.hero.id, subject: "Old Marta", beat: "helped", note: "Carried her water." });
    },
  }),
  request_roll: [
    { variant: "check", stage: "calm", args: (c) => ({ characterId: c.hero.id, kind: "skill_check", skill: "athletics", difficulty: "moderate", reason: "climb" }), dice: [12] },
    { variant: "save", stage: "fight", args: (c) => ({ characterId: c.hero.id, kind: "saving_throw", ability: "con", dc: 12, reason: "poison" }), dice: [5] },
  ],
  request_player_input: one("calm", (c) => ({ characterIds: [c.hero.id], prompt: "Which door?" })),
  send_whisper: one("calm", (c) => ({ characterIds: [c.hero.id], message: "You notice the ring is warm." })),
  record_event: one("calm", (c) => ({ characterId: c.hero.id, kind: "story", summary: "Held the bridge alone." })),
  write_campaign_note: one("calm", () => ({ title: "The mill", body: "The miller owes the baron." })),
  search_lore: one("calm", () => ({ query: "the mill" })),
  set_ambience: one("calm", () => ({ bed: "tavern" })),
  show_title: one("calm", () => ({ title: "The Old Mill", tone: "gold" })),
  play_sting: one("calm", () => ({ cue: "thunder" })),
  dismiss_handout: one("calm", () => ({})),
  set_quest: one("calm", () => ({ title: "Find the miller", objectives: "Ask at the inn\nSearch the mill", status: "active" })),
  tick_objective: one("calm", () => ({ quest: "Find the miller", objective: "Ask at the inn", done: true }), {
    before: (c) => must(c, "set_quest", { title: "Find the miller", objectives: "Ask at the inn\nSearch the mill", status: "active" }),
  }),
  adjust_reputation: one("calm", () => ({ faction: "Millers' Guild", delta: 1, reason: "returned the ledger" }), { before: guild }),
  faction_note: one("calm", () => ({ faction: "Millers' Guild", note: "They keep two sets of books." }), { before: guild }),
  generate_settlement: one("calm", () => ({ size: "village" }), { before: (c) => must(c, "move_party", MILL) }),
  open_shop: one("calm", () => ({ name: "Marta's Goods", kind: "general" })),
  haggle: one("calm", (c) => ({ characterId: c.hero.id, shop: "Marta's Goods" }), {
    before: (c) => must(c, "open_shop", { name: "Marta's Goods", kind: "general" }),
    dice: [15],
  }),
  lift: one("calm", (c) => ({ characterId: c.hero.id, weightLb: 100 })),
  set_lifestyle: one("calm", (c) => ({ lifestyle: "modest", characterIds: [c.hero.id] })),
  downtime: one("calm", (c) => ({ days: 1, characterId: c.hero.id, activity: "profession" }), { dice: [12] }),
  afflict: one("calm", (c) => ({ characterId: c.hero.id, kind: "disease", name: "Sewer Plague", save: false })),
};

// A row not walked, and why. The suite prints the count.
const SKIP = {
  generate_image: "queues a picture render: no image backend in a suite, and the brief forbids queueing one",
  legendary_action: "needs a legendary creature's stat block from the content pack; its spends are held by test-enforce-legendary-* and test-revert-fight-rows",
  legendary_resist: "needs a legendary creature that has just failed a save (as above)",
  lair_action: "needs a lair fight (as above)",
  complete_beat: "needs a story arc, which a storyteller model writes",
  recall_story: "a lookup that writes nothing, and needs a closed chapter",
  read_card: "a lookup that writes nothing, and needs an imported storyboard",
  show_handout: "needs a lore entry to show; table dressing",
  relationship_scheme: "needs the player's own opt-in to romance on the sheet, which only the player's settings route writes",
};

// Residue known today, by "tool" or "tool/variant". Each is a finding in
// /tmp/odm-gapstudy/findings/lifecycle.jsonl with the same id.
const KNOWN = {
  // ---- inside what the revert says it takes back: sheets, the fight, the board, the clock ----
  "take_action/dodge": { severity: "high", where: "src/lib/dm/action-common.ts addSheetCondition (Dodge writes the sheet with no audit row, so the revert gives the action back and leaves \"dodging\")" },
  "take_action/ready": { severity: "high", where: "src/lib/dm/action-common.ts addSheetCondition (Ready: \"readied\" and its trigger stay, the action comes back)" },
  use_reaction: { severity: "high", where: "src/lib/dm/reaction-spells.ts castShield -> addSheetCondition (\"shielded\" stays: +5 AC kept, the slot and the reaction given back)" },
  "apply_damage/concentrating": { severity: "high", where: "src/lib/dm/concentration.ts breakConcentration (the conditions it strips from every sheet the spell was on, and concentration_rounds, have no audit row: the revert gives back the hit points and the caster's concentration on a Bless nobody has)" },
  summon_pet: { severity: "medium", where: "src/lib/dm/pet-tools.ts (pets_json is written with no audit row: \"Nothing left to revert for that turn\")" },
  dismiss_pet: { severity: "medium", where: "src/lib/dm/pet-tools.ts (as summon_pet: the pet stays gone)" },
  party_stash: { severity: "medium", where: "party_stash's handler (the depositor's gold and campaigns.party_json are written with no audit row: the gold stays in the stash)" },
  "update_sheet/level": { severity: "low", where: "update_sheet (level): the xp it raises with the level is not in the audit row, so the level goes back and the xp stays" },
  start_encounter: { severity: "medium", where: "src/lib/db/campaigns.ts setFloor / ambience: campaigns.floor_json and ambience_json are not among the rows a turn keeps (src/lib/dm/turn-rows-logic.ts FIGHT_TABLES): the fight goes and the floor stays in initiative, naming an encounter that no longer exists" },
  end_turn: { severity: "medium", where: "setFloor (as start_encounter): the order goes back to Kara, the floor still names Mira" },
  "pc_attack/kills the last foe": {
    severity: "medium",
    where: "src/lib/dm/turn-revert.ts takeBackTurnChanges (\"a fight that has ended since stays\"): the fight this very turn's blow ended is treated as ended since. The revert answers ok, takes the sheets' rows back (the XP the kill paid) and leaves the foe dead, the fight ended and the action spent",
    note: "written ruling to confirm: docs/issue-685-audit-2026-11-01.md \"a fight that has ended stays ended\"",
  },
  "apply_damage/kills the last foe": { severity: "medium", where: "src/lib/dm/turn-revert.ts (as pc_attack/kills the last foe)", note: "the same written ruling" },
  end_encounter: { severity: "medium", where: "setFloor (as start_encounter): the fight is back and the floor stays open" },
  request_player_input: { severity: "low", where: "setFloor: a spotlight question stays asked after its turn is reverted" },
  grant_item: { severity: "low", where: "character_events: the timeline row of an item the revert took back stays" },
  reveal_item: { severity: "low", where: "character_events (as grant_item)" },
  purchase: { severity: "low", where: "character_events (as grant_item)" },
  record_event: { severity: "low", where: "character_events: a recorded deed has no revert" },
  learn_spell: { severity: "low", where: "character_events (as grant_item): the spell and the gold go back, the timeline row stays" },
  "take_rest/long": { severity: "low", where: "src/lib/db/clock.ts rewindTurnClock: the hours go back, the weather the rest rolled and the world tick's counters do not" },
  travel: { severity: "low", where: "rewindTurnClock (as take_rest/long): weather, travel pace and the ambience bed stay as the march left them" },
  romance_advance: { severity: "low", where: "romance_advance: refused (\"They barely know them\") after it stamped npcs.met_at and wrote two relationships rows" },
  // ---- not on the route's list of what a revert takes back (its header comment; recorded with that ruling) ----
  add_companion: { severity: "low", where: "revert-turn/route.ts: companions are outside the revert (\"a companion's leaving stay[s]: the chapter rewind is what takes those back\")" },
  dismiss_companion: { severity: "low", where: "revert-turn/route.ts: written ruling, a companion's leaving stays" },
  move_party: { severity: "low", where: "revert-turn/route.ts: the scene and locations are not kept by a turn" },
  update_location: { severity: "low", where: "as move_party" },
  start_scene: { severity: "low", where: "campaigns.scene_tracker_json is not kept by a turn" },
  scene_check: { severity: "low", where: "campaigns.scene_tracker_json: a skill challenge's success counted by a reverted turn stays counted" },
  end_scene: { severity: "low", where: "campaigns.scene_tracker_json" },
  mount_up: { severity: "low", where: "campaigns.mounts_json is not kept by a turn" },
  dismount: { severity: "low", where: "campaigns.mounts_json" },
  damage_object: { severity: "low", where: "campaigns.clock_json.objects: damage to an object is not kept by a turn" },
  set_npc: { severity: "low", where: "npcs" },
  npc_reaction: { severity: "low", where: "npcs, relationships" },
  social_check: { severity: "low", where: "npcs.met_at, relationships" },
  relationship_beat: { severity: "low", where: "relationships" },
  relationship_end: { severity: "low", where: "relationships" },
  send_whisper: { severity: "low", where: "dm_whispers" },
  write_campaign_note: { severity: "low", where: "campaign_notes" },
  set_ambience: { severity: "low", where: "campaigns.ambience_json" },
  set_weather: { severity: "low", where: "campaigns.clock_json.weather" },
  set_quest: { severity: "low", where: "quests" },
  tick_objective: { severity: "low", where: "quests.objectives_json" },
  adjust_reputation: { severity: "low", where: "campaigns.party_json standing, world_facts" },
  faction_note: { severity: "low", where: "world_facts" },
  generate_settlement: { severity: "low", where: "npcs, lore_entries" },
  open_shop: { severity: "low", where: "shops" },
  haggle: { severity: "low", where: "shops.haggled_json: a haggle taken back can not be tried again" },
  set_lifestyle: { severity: "low", where: "campaigns.clock_json.lifestyles" },
  afflict: { severity: "medium", where: "campaigns.clock_json.afflictions: a disease or poison a reverted turn gave a character stays on them (\"Nothing left to revert for that turn\")" },
};

// A difference that is not the game's state.
const ignore = (table, column) =>
  // Who the console last acted as, and its bookkeeping.
  (table === "campaigns" && ["next_seq", "updated_at"].includes(column));

let walked = 0;
let silent = 0;
for (const entry of ADJUDICATIONS) {
  const recipes = RECIPES[entry.name];
  if (!recipes) {
    if (SKIP[entry.name]) {
      continue;
    }
    await test(`${entry.name}: a recipe`, () => {
      assert.fail(`the catalog has a tool this sweep has no recipe for: ${entry.name}. Add one to RECIPES (or a written reason to SKIP).`);
    });
    continue;
  }
  for (const recipe of recipes) {
    const id = recipe.variant ? `${entry.name}/${recipe.variant}` : entry.name;
    walked += 1;
    let refused = null;
    let residue = [];
    let changed = [];
    let revert = null;
    const run = async () => {
      const ctx = await stage(recipe.stage);
      await recipe.before?.(ctx);
      ctx.world.clearDice();
      const before = snapshot();
      ctx.world.dice(...(recipe.dice ?? []));
      const out = await ctx.world.invoke(entry.name, recipe.args(ctx));
      ctx.world.clearDice();
      if (!out.ok) {
        refused = out.error;
        // A refusal changes nothing: the same differential, with no revert.
        residue = diff(before, snapshot(), { ignore });
        return;
      }
      changed = diff(before, snapshot(), { ignore });
      revert = await revertTurn(ctx.world, out.turnId);
      residue = diff(before, snapshot(), { ignore });
    };
    const check = async () => {
      await run();
      if (REPORT) {
        report.push({ id, refused, changed: changed.slice(0, 30), revert, residue: residue.slice(0, 30) });
      }
      if (refused !== null) {
        // A recipe the engine refuses walks nothing: that is the suite
        // breaking (not an assertion), unless the refusal itself left marks.
        if (!residue.length) {
          throw new Error(`the recipe for ${id} was refused, so the row was not walked: ${refused}`);
        }
        assert.deepEqual(residue, [], `${id} was refused (${refused}) and still changed the table`);
      }
      if (!changed.length) {
        silent += 1;
      }
      assert.deepEqual(residue, [], `${id}: after Revert this turn (${revert?.status} ${JSON.stringify(revert?.json).slice(0, 120)}) the table differs from the one the turn found`);
    };
    const known = KNOWN[id];
    if (known) {
      await gap(`sweep-lifecycle-revert:${id}`, { rule: RULE, where: known.where, severity: known.severity, note: known.note }, check);
    } else {
      await test(`${id}: nothing is left after Revert this turn`, check);
    }
  }
}

if (REPORT) {
  fs.writeFileSync(REPORT, report.map((row) => JSON.stringify(row)).join("\n"));
}
console.log(`sweep-lifecycle-revert: ${walked} calls of ${ADJUDICATIONS.length} tools walked, ${Object.keys(SKIP).length} tools skipped with a reason, ${silent} calls changed no state table`);
finish();
