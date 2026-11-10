// The rows of the blocking matrix (scripts/test-enforce-sweep-doors-block*.mjs):
// one for every way the catalog (src/lib/dm/invoke-catalog.ts) lets a
// creature ACT, built from the catalog itself. A tool with a select of
// actions (take_action, handle_item, stabilize) gives one row per option, so
// an option added next month is a row the day it lands; a tool with an
// actor's picker that has no builder here fails the suite until it is given
// one or a written reason in NOT_AN_ACTOR.
//
// kind: what the act spends, in the words of src/lib/dm/can-act.ts:
//   attack / cast / action   the turn's action
//   bonus                    the bonus action
//   reaction                 the reaction, off the actor's turn
//   move                     speed
//   free                     nothing, but it is the actor's turn's to do
//   pass                     ending the turn the pointer rests on
//   command                  the actor's word to a creature they command
// reaches: the act names another creature of the fight (an ally it heals or
//   helps), so it cannot be done from somewhere else.
// harms: the creature the act attacks or targets with a harmful effect (the
//   charmer a charmed actor cannot aim at), as a key of the stage.

const adj = (t) => t.foes[0].id;
const far = (t) => t.foes[1].id;

// ---- a hero acts ----

const TAKE_ACTION = {
  dodge: { args: () => ({}) },
  dash: { args: () => ({}) },
  disengage: { args: () => ({}) },
  // Out of every enemy's sight first: a corner walled off from the field.
  hide: { prelude: (t) => { t.kit.openField([[1, 0, "#"], [0, 1, "#"], [1, 1, "#"]]); t.kit.place(t.brom.id, 0, 0); }, args: () => ({}) },
  help: { reaches: true, args: (t) => ({ targetCharacterId: t.sera.id }) },
  grapple: { harms: "foe0", prelude: (t) => freeHand(t), args: (t) => ({ targetEnemyId: adj(t) }) },
  shove: { harms: "foe0", args: (t) => ({ targetEnemyId: adj(t), shove: "prone" }) },
  ready: { args: (t) => ({ trigger: "the goblin steps closer", readied: "attack", targetEnemyId: adj(t) }) },
  search: { args: () => ({}) },
  use_object: { args: () => ({ reason: "pulls the lever by the door" }) },
  improvise: { prelude: (t) => t.world.say("dm", "A brazier burns beside the door, its coals bright."), args: () => ({ skill: "athletics", difficulty: "easy", scene: "the brazier", distanceFt: 5, reason: "kicks the brazier over" }) },
  escape: { prelude: (t) => grab(t), args: () => ({}) },
};

const HANDLE_ITEM = {
  equip: { kind: "action", prelude: (t) => freeHand(t), args: () => ({ item: "Shield" }) },
  pick_up: {
    kind: "free",
    prelude: async (t) => {
      // Sera drops it on her own turn (a drop is the turn's, gear-ground.ts),
      // and the pointer goes back to where the stage had it.
      const { saveEncounter } = await import("../../src/lib/db/encounters.ts");
      const was = t.world.encounter();
      t.kit.giveTurn(t.sera.id);
      const dropped = await t.world.invoke("handle_item", { characterId: t.sera.id, action: "drop", item: "Mace" });
      saveEncounter(was);
      if (!dropped.ok) {
        throw new Error(`the stage's dropped mace: ${dropped.error}`);
      }
      t.kit.place(t.sera.id, 6, 5);
      t.kit.place(t.brom.id, 4, 5);
    },
    args: () => ({ item: "Mace" }),
  },
  unequip: { kind: "action", args: () => ({ item: "Shield" }) },
  drop: { kind: "free", args: () => ({ item: "Dagger" }) },
  hand: { kind: "free", reaches: true, args: (t) => ({ item: "Dagger", toCharacterId: t.sera.id }) },
};

// The shield off Brom's arm, so a hand is free.
function freeHand(t) {
  const sheet = t.world.sheet(t.brom.id);
  t.world.patch(t.brom.id, { equipment: sheet.equipment.map((item) => (item.name === "Shield" ? { ...item, equipped: false } : item)) });
}

// The first goblin has Brom grappled.
async function grab(t) {
  const out = await t.world.invoke("set_condition", { characterId: t.brom.id, condition: "grappled", sourceEnemyId: t.foes[0].id });
  if (!out.ok) {
    throw new Error(`the stage's grapple: ${out.error}`);
  }
}

export function heroRows(catalog) {
  const entry = (name) => {
    const found = catalog.find((candidate) => candidate.name === name);
    if (!found) {
      throw new Error(`the catalog has no ${name}`);
    }
    return found;
  };
  const options = (name, field) => entry(name).fields.find((candidate) => candidate.name === field)?.options?.map((option) => option.value) ?? [];
  const rows = [
    { id: "pc_attack", tool: "pc_attack", actor: "brom", kind: "attack", harms: "foe0", args: (t) => ({ characterId: t.brom.id, targetEnemyId: adj(t), weapon: "Longsword" }) },
    { id: "pc_attack:spell", tool: "pc_attack", actor: "wren", kind: "cast", harms: "foe1", args: (t) => ({ characterId: t.wren.id, targetEnemyId: far(t), spell: "Fire Bolt" }) },
    { id: "cast_at_enemy:save", tool: "cast_at_enemy", actor: "sera", kind: "cast", harms: "foe0", args: (t) => ({ characterId: t.sera.id, targetEnemyId: adj(t), spell: "Sacred Flame" }) },
    { id: "cast_at_enemy:hold", tool: "cast_at_enemy", actor: "wren", kind: "cast", harms: "foe0", args: (t) => ({ characterId: t.wren.id, targetEnemyId: adj(t), spell: "Hold Person" }) },
    { id: "cast_at_enemy:darts", tool: "cast_at_enemy", actor: "wren", kind: "cast", harms: "foe1", args: (t) => ({ characterId: t.wren.id, targetEnemyId: far(t), spell: "Magic Missile" }) },
    { id: "cast_buff", tool: "cast_buff", actor: "sera", kind: "cast", reaches: true, args: (t) => ({ characterId: t.sera.id, spell: "Bless", targetCharacterIds: [t.brom.id] }) },
    { id: "cast_buff:self", tool: "cast_buff", actor: "wren", kind: "cast", args: (t) => ({ characterId: t.wren.id, spell: "Blur" }) },
    { id: "aoe_damage", tool: "aoe_damage", actor: "wren", kind: "cast", harms: "foe1", args: (t) => ({ casterCharacterId: t.wren.id, spell: "Fireball", enemyIds: [far(t)] }) },
    { id: "heal:spell", tool: "heal", actor: "sera", kind: "cast", reaches: true, prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }), args: (t) => ({ characterId: t.brom.id, casterId: t.sera.id, spell: "Cure Wounds" }) },
    { id: "heal:bonus", tool: "heal", actor: "sera", kind: "bonus", reaches: true, prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }), args: (t) => ({ characterId: t.brom.id, casterId: t.sera.id, spell: "Healing Word" }) },
    { id: "use_spell_slot", tool: "use_spell_slot", actor: "wren", kind: "cast", args: (t) => ({ characterId: t.wren.id, level: 1, spell: "Mage Armor" }) },
    { id: "use_resource:bonus", tool: "use_resource", actor: "brom", kind: "bonus", prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }), args: (t) => ({ characterId: t.brom.id, resource: "Second Wind" }) },
    { id: "use_resource:free", tool: "use_resource", actor: "brom", kind: "free", args: (t) => ({ characterId: t.brom.id, resource: "Action Surge" }) },
    { id: "use_item", tool: "use_item", actor: "brom", kind: "action", prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }), args: (t) => ({ characterId: t.brom.id, item: "Potion of Healing" }) },
    { id: "use_item:other", tool: "use_item", actor: "brom", kind: "action", reaches: true, prelude: (t) => t.world.patch(t.sera.id, { currentHp: 10 }), args: (t) => ({ characterId: t.brom.id, item: "Potion of Healing", targetCharacterId: t.sera.id }) },
    { id: "pet_attack", tool: "pet_attack", actor: "brom", kind: "command", harms: "foe0", args: (t) => ({ characterId: t.brom.id, petName: "Biter", targetEnemyId: adj(t) }) },
    { id: "move_token", tool: "move_token", actor: "wren", kind: "move", args: (t) => ({ token: t.wren.id, x: 2, y: 4 }) },
    { id: "move_token:disengage", tool: "move_token", actor: "wren", kind: "move", args: (t) => ({ token: t.wren.id, x: 2, y: 4, disengage: true }) },
    { id: "mount_up", tool: "mount_up", actor: "wren", kind: "move", args: (t) => ({ characterId: t.wren.id, mount: "Riding Horse" }) },
    {
      id: "dismount", tool: "dismount", actor: "wren", kind: "move",
      // In the saddle since an earlier turn: this turn's move is whole.
      // Laid on the record, not by mount_up: on the held stage mount_up is
      // refused (it is the rider's move), and the saddle is from before.
      prelude: async (t) => {
        const { checkMount } = await import("../../src/lib/srd/mounts.ts");
        const { setMount } = await import("../../src/lib/db/mounts.ts");
        const up = checkMount({ ref: "Riding Horse", riderSize: "medium" });
        if ("error" in up) {
          throw new Error(`the stage's mount: ${up.error}`);
        }
        setMount(t.world.campaignId, t.wren.id, up.state);
        t.kit.freshTurn();
        if (t.kit.token(t.wren.id)) {
          t.kit.place(t.wren.id, 3, 5, 0);
        }
      },
      args: (t) => ({ characterId: t.wren.id, cause: "voluntary" }),
    },
    { id: "end_turn", tool: "end_turn", actor: "brom", kind: "pass", args: (t) => ({ characterId: t.brom.id }) },
    {
      id: "use_reaction:Shield", tool: "use_reaction", actor: "wren", kind: "reaction",
      // The hit lands after the state is laid: a reaction is judged as the
      // reactor stood before the hit (last-hit.ts), so a state laid after
      // it would read as the hit's own doing.
      trigger: (t) => t.world.hitBy(t.wren.id, { enemyId: adj(t), name: "Goblin 1", total: 13, vsAc: 10, raw: 0 }),
      args: (t) => ({ characterId: t.wren.id, feature: "Shield" }),
    },
    {
      id: "use_reaction:Opportunity Attack", tool: "use_reaction", actor: "sera", kind: "reaction", harms: "foe0",
      args: (t) => ({ characterId: t.sera.id, feature: "Opportunity Attack", targetEnemyId: adj(t) }),
    },
  ];
  for (const action of options("take_action", "action")) {
    const built = TAKE_ACTION[action];
    rows.push({
      id: `take_action:${action}`, tool: "take_action", actor: "brom", kind: "action", option: true, harms: built?.harms, reaches: built?.reaches, prelude: built?.prelude,
      args: built ? (t) => ({ characterId: t.brom.id, action, ...built.args(t) }) : null,
    });
  }
  for (const action of options("handle_item", "action")) {
    const built = HANDLE_ITEM[action];
    rows.push({
      id: `handle_item:${action}`, tool: "handle_item", actor: "brom", kind: built?.kind ?? "free", option: true, reaches: built?.reaches, prelude: built?.prelude,
      args: built ? (t) => ({ characterId: t.brom.id, action, ...built.args(t) }) : null,
    });
  }
  for (const method of options("stabilize", "method")) {
    rows.push({
      id: `stabilize:${method}`, tool: "stabilize", actor: "sera", kind: method === "spell" ? "cast" : "action", option: true, reaches: true,
      prelude: (t) => t.world.patch(t.wren.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } }),
      args: (t) => ({ characterId: t.wren.id, healerId: t.sera.id, method }),
    });
  }
  return rows;
}

// Catalog entries with a character, enemy or token picker that name nobody
// who acts: the GM does it to them, or for them, whatever state they are in.
export const NOT_AN_ACTOR = {
  start_encounter: "the absent list names who is not there",
  add_enemies: "no picker",
  cast_at_player: "the character is the target; the caster is an enemy (the enemy matrix)",
  enemy_attack: "the enemy matrix",
  enemy_flees: "the enemy matrix",
  legendary_action: "the enemy matrix",
  declare_intent: "the enemy matrix",
  legendary_resist: "the enemy matrix",
  apply_hazard: "a hazard acts on them",
  summon_pet: "the story gives a creature; the spell that calls one is cast_buff",
  dismiss_pet: "the GM's bookkeeping",
  set_movement: "the GM sets how a token moves",
  apply_damage: "damage lands on them",
  party_stash: "the party's shared stash, out of turn order",
  party_award: "the GM gives",
  modify_gold: "the GM gives or takes",
  grant_item: "the GM gives",
  reveal_item: "the GM reveals",
  remove_item: "the GM takes",
  purchase: "trade, outside a turn (the quiet matrix)",
  set_condition: "a condition lands on them",
  set_effect: "an effect lands on them",
  clear_effect: "the GM's bookkeeping",
  clear_condition: "the GM's bookkeeping",
  learn_spell: "the GM's bookkeeping",
  update_sheet: "the GM's correction",
  dismiss_companion: "the GM's bookkeeping",
  move_party: "the party travels between places",
  travel: "the party travels",
  start_scene: "the scene's cast",
  scene_check: "a check in a scene (the quiet matrix)",
  roll_treasure: "the GM gives",
  damage_object: "an attack on an object: the quiet matrix",
  group_check: "the quiet matrix",
  check_notice: "the quiet matrix",
  social_check: "the quiet matrix",
  relationship_beat: "the story's record",
  romance_advance: "the story's record",
  relationship_end: "the story's record",
  relationship_scheme: "the story's record",
  request_roll: "the quiet matrix",
  request_player_input: "a question to players",
  send_whisper: "a message to players",
  record_event: "the story's record",
  generate_image: "a picture",
  haggle: "the quiet matrix",
  lift: "the quiet matrix",
  set_lifestyle: "the GM's bookkeeping",
  downtime: "the quiet matrix",
  afflict: "an affliction lands on them",
};

const PICKERS = new Set(["character", "characters", "enemy", "enemies", "combatant"]);

// Every catalog entry with a picker is a row's tool or has its reason above.
export function unclassified(catalog, rows) {
  const tools = new Set(rows.map((row) => row.tool));
  return catalog
    .filter((entry) => entry.fields.some((field) => PICKERS.has(field.kind)))
    .map((entry) => entry.name)
    .filter((name) => !tools.has(name) && !NOT_AN_ACTOR[name]);
}

// ---- an enemy acts ----

const ENEMY_ACTION = {
  dodge: { args: () => ({}) },
  dash: { args: () => ({}) },
  disengage: { args: () => ({}) },
  escape: {
    // Brom has it grappled.
    prelude: async (t) => {
      const out = await t.world.invoke("set_condition", { enemyId: t.foes[0].id, condition: "grappled", sourceCharacterId: t.brom.id });
      if (!out.ok) {
        throw new Error(`the stage's grapple: ${out.error}`);
      }
    },
    args: () => ({}),
  },
};

export function enemyRows(catalog) {
  const actions = catalog.find((entry) => entry.name === "take_action").fields.find((field) => field.name === "action").options.map((option) => option.value);
  const rows = [
    { id: "enemy_attack", tool: "enemy_attack", kind: "action", harms: "brom", args: (t) => ({ enemyId: adj(t), targetCharacterId: t.brom.id }) },
    { id: "cast_at_player", tool: "cast_at_player", kind: "action", harms: "brom", args: (t) => ({ characterId: t.brom.id, casterEnemyId: adj(t), saveAbility: "dex", dc: 12, damage: "1d6", damageType: "fire", halfOnSave: true, source: "a flask of fire" }) },
    { id: "aoe_damage:enemy", tool: "aoe_damage", kind: "action", harms: "brom", args: (t) => ({ casterEnemyId: adj(t), damage: "2d6", saveAbility: "dex", dc: 12, type: "fire", halfOnSave: true, characterIds: [t.brom.id], reason: "a flask of fire" }) },
    { id: "move_token:enemy", tool: "move_token", kind: "move", args: (t) => ({ token: far(t), x: 9, y: 6 }) },
    { id: "enemy_flees", tool: "enemy_flees", kind: "move", args: (t) => ({ enemyId: far(t), reason: "it runs" }) },
    { id: "declare_intent", tool: "declare_intent", kind: "intent", args: (t) => ({ actor: adj(t), verb: "raises its club", kind: "melee", target: t.brom.id }) },
  ];
  for (const action of actions) {
    const built = ENEMY_ACTION[action];
    rows.push({
      id: `take_action:enemy:${action}`, tool: "take_action", kind: "action", option: true, prelude: built?.prelude,
      args: built ? (t) => ({ enemyId: adj(t), action, ...built.args(t) }) : null,
    });
  }
  return rows;
}

// The enemy a row acts with (the state is laid on it).
export function enemyActorOf(row, t) {
  const args = row.args(t);
  return args.enemyId ?? args.casterEnemyId ?? args.actor ?? args.token;
}

// ---- a hero acts with no fight on ----
//
// The catalog's entries that roll or spend for one character outside a
// fight. `kind` is "deed": something the character does, which the dead and
// the unconscious cannot.
export function quietRows() {
  const deed = (id, tool, actor, args, extra = {}) => ({ id, tool, actor, kind: "deed", args, ...extra });
  return [
    deed("social_check", "social_check", "brom", (t) => ({ characterId: t.brom.id, npc: "Marla the Fence", approach: "persuade", reason: "asks for the key" })),
    deed("haggle", "haggle", "brom", (t) => ({ characterId: t.brom.id, shop: "The Rusty Anchor", skill: "persuasion" })),
    deed("purchase:buy", "purchase", "brom", (t) => ({ characterId: t.brom.id, action: "buy", item: "Torch", qty: 1, shop: "The Rusty Anchor" })),
    deed("purchase:sell", "purchase", "brom", (t) => ({ characterId: t.brom.id, action: "sell", item: "Dagger", qty: 1, shop: "The Rusty Anchor" })),
    deed("lift", "lift", "brom", (t) => ({ characterId: t.brom.id, weightLb: 100, how: "lift", reason: "the portcullis" })),
    deed("request_roll:skill", "request_roll", "brom", (t) => ({ characterId: t.brom.id, kind: "skill_check", skill: "athletics", difficulty: "easy", reason: "climbs the wall" })),
    deed("request_roll:ability", "request_roll", "brom", (t) => ({ characterId: t.brom.id, kind: "ability_check", ability: "str", difficulty: "easy", reason: "forces the door" })),
    deed("group_check", "group_check", "brom", (t) => ({ skill: "stealth", difficulty: "easy", characterIds: [t.brom.id], reason: "creeps past" }), {
      countsOut: (result, t, d20s) => d20s === 0 && (result.results ?? []).some((entry) => entry.name === "Brom" && entry.success === false),
    }),
    deed("check_notice", "check_notice", "brom", (t) => ({ difficulty: "easy", sense: "perception", characterIds: [t.brom.id], reason: "a trip wire" }), {
      countsOut: (result, t, d20s) => d20s === 0 && (result.missedBy ?? []).includes("Brom") && !(result.noticedBy ?? []).includes("Brom"),
    }),
    deed("damage_object", "damage_object", "brom", (t) => ({ name: "the door", material: "wood", size: "medium", characterId: t.brom.id, weapon: "Longsword" })),
    deed("use_item", "use_item", "brom", (t) => ({ characterId: t.brom.id, item: "Potion of Healing", targetCharacterId: t.sera.id }), { prelude: (t) => t.world.patch(t.sera.id, { currentHp: 10 }) }),
    deed("use_resource", "use_resource", "brom", (t) => ({ characterId: t.brom.id, resource: "Action Surge" })),
    deed("handle_item:hand", "handle_item", "brom", (t) => ({ characterId: t.brom.id, action: "hand", item: "Dagger", toCharacterId: t.sera.id })),
    deed("handle_item:drop", "handle_item", "brom", (t) => ({ characterId: t.brom.id, action: "drop", item: "Dagger" })),
    deed("party_stash:stow", "party_stash", "brom", (t) => ({ do: "stow", characterId: t.brom.id, item: "Dagger", qty: 1 })),
    deed("mount_up", "mount_up", "brom", (t) => ({ characterId: t.brom.id, mount: "Riding Horse" })),
    deed("cast_buff", "cast_buff", "sera", (t) => ({ characterId: t.sera.id, spell: "Bless", targetCharacterIds: [t.brom.id] })),
    deed("heal:spell", "heal", "sera", (t) => ({ characterId: t.brom.id, casterId: t.sera.id, spell: "Cure Wounds" }), { prelude: (t) => t.world.patch(t.brom.id, { currentHp: 20 }) }),
    deed("use_spell_slot", "use_spell_slot", "wren", (t) => ({ characterId: t.wren.id, level: 1, spell: "Mage Armor" })),
    deed("stabilize:check", "stabilize", "sera", (t) => ({ characterId: t.wren.id, healerId: t.sera.id, method: "check" }), { prelude: (t) => t.world.patch(t.wren.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } }) }),
    deed("downtime", "downtime", "brom", (t) => ({ days: 1, characterId: t.brom.id, activity: "profession", reason: "works the docks" })),
    deed("scene_check", "scene_check", "brom", (t) => ({ characterId: t.brom.id, approach: "shoulders the crowd aside", skill: "athletics", difficulty: "easy" }), {
      prelude: async (t) => {
        const started = await t.world.invoke("start_scene", { kind: "chase", title: "Through the market", successesNeeded: 3, failuresAllowed: 3, characterIds: [t.brom.id, t.sera.id, t.wren.id] });
        if (!started.ok) {
          throw new Error(`the stage's scene: ${started.error}`);
        }
      },
    }),
  ];
}
