// The engine hooks of the authored subclass features, monk, paladin and
// ranger (the shape of an entry: authored-effects-data.ts).

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const AURA_REACH: Array<[number, number]> = [[7, 10], [18, 30]];

export const AUTHORED_DATA_B: Record<string, AuthoredEntry> = {
  // ---- monk ----
  "monk::Shadow Step": {
    subclass: "Way of Shadow",
    spends: [
      {
        name: "Shadow Step",
        action: "bonus",
        // "Between two patches of dim light or darkness": the square left
        // (here) and the one landed on (map-tools.ts featureLandingRefusal).
        needs: "shadows",
        does: { kind: "buff", condition: "shadow step", rounds: 1, teleportFeet: 60 },
      },
    ],
  },
  "monk::Opportunist": {
    subclass: "Way of Shadow",
    reactions: [{ name: "Opportunist", does: { kind: "attack", rangeFt: 5 } }],
  },
  "monk::Tipsy Sway": {
    subclass: "Way of the Drunken Master",
    effects: [{ kind: "stand_cost", feet: 5 }],
    reactions: [{ name: "Tipsy Sway", aliases: ["Redirect Attack"], pool: { id: "ki", amount: 1 }, does: { kind: "redirect_miss", rangeFt: 5 } }],
  },
  "monk::Drunkard's Luck": {
    subclass: "Way of the Drunken Master",
    spends: [
      {
        name: "Drunkard's Luck",
        pool: { id: "ki", amount: 2 },
        does: {
          kind: "buff",
          condition: "drunkard's luck (attack)",
          variants: { attack: "drunkard's luck (attack)", check: "drunkard's luck (check)", save: "drunkard's luck (save)" },
          rounds: 10,
        },
      },
    ],
  },
  "monk::Intoxicated Frenzy": {
    subclass: "Way of the Drunken Master",
    // Each strike past the flurry's own two goes to a creature no other
    // strike of it was aimed at (src/lib/dm/mt-mr-turn.ts flurryStrikeRefusal).
    effects: [{ kind: "flurry", strikes: 5 }],
  },
  // Agile Parry: after an unarmed strike in the Attack action while holding a
  // kensei melee weapon, +2 AC until the monk's next turn, for no action.
  "monk::Path of the Kensei": {
    subclass: "Way of the Kensei",
    spends: [{ name: "Agile Parry", aliases: ["Path of the Kensei"], action: "none", fight: "in", needs: "unarmed_in_action", does: { kind: "buff", condition: "agile parry", rounds: 1 } }],
  },
  "monk::Kensei's Shot": {
    subclass: "Way of the Kensei",
    spends: [{ name: "Kensei's Shot", action: "bonus", does: { kind: "buff", condition: "kensei's shot", rounds: 1 } }],
  },
  "monk::Sharpen the Blade": {
    subclass: "Way of the Kensei",
    spends: [
      {
        name: "Sharpen the Blade",
        pool: { id: "ki", perUnit: true, max: 3 },
        action: "bonus",
        does: { kind: "buff", condition: "sharpen the blade (+{units})", rounds: 10 },
      },
    ],
  },
  "monk::Radiant Sun Bolt": {
    subclass: "Way of the Sun Soul",
    effects: [
      {
        kind: "natural_weapon",
        weapon: { name: "Radiant Sun Bolt", aliases: ["sun bolt"], dice: [[1, "1d4"], [5, "1d6"], [11, "1d8"], [17, "1d10"]], type: "radiant", ranged: true, rangeFt: 30 },
        // Its bonus-action pair of bolts for 1 ki after the Attack action is
        // Flurry of Blows' place: a flurry strike may be a bolt
        // (src/lib/dm/mt-mr-turn.ts sunBoltStrike).
      },
    ],
  },
  "monk::Searing Arc Strike": {
    subclass: "Way of the Sun Soul",
    spends: [
      {
        name: "Searing Arc Strike",
        // "After the Attack action, spend 2 ki or more."
        pool: { id: "ki", perUnit: true, min: 2, max: 11 },
        action: "bonus",
        needs: "attack_action",
        does: {
          kind: "aoe_report",
          dice: "3d6",
          perUnit: "1d6",
          baseUnits: 2,
          save: "dex",
          dcAbility: "wis",
          type: "fire",
          area: "a 15-foot cone (burning hands)",
        },
      },
    ],
  },
  "monk::Searing Sunburst": {
    subclass: "Way of the Sun Soul",
    spends: [
      {
        name: "Searing Sunburst",
        pool: { id: "ki", perUnit: true, max: 3, optional: true },
        action: "action",
        does: {
          kind: "aoe_report",
          dice: "2d6",
          perUnit: "2d6",
          baseUnits: 0,
          save: "con",
          dcAbility: "wis",
          type: "radiant",
          area: "a 20-foot sphere within 150 feet",
          noHalf: true,
          rangeFt: 150,
        },
      },
    ],
  },
  "monk::Touch of Death": {
    subclass: "Way of the Long Death",
    effects: [{ kind: "kill_temp_hp", formula: (level, mods) => Math.max(1, (mods.wis ?? 0) + level) }],
  },
  "monk::Touch of the Long Death": {
    subclass: "Way of the Long Death",
    spends: [
      {
        name: "Touch of the Long Death",
        pool: { id: "ki", perUnit: true, max: 10 },
        action: "action",
        does: { kind: "save_effect", save: "con", dcAbility: "wis", perUnit: "2d10", type: "necrotic", half: true, rangeFt: 5 },
      },
    ],
  },
  "monk::Arms of the Astral Self": {
    subclass: "Way of the Astral Self",
    // While the arms last: unarmed strikes reach 5 feet farther, and a
    // Strength save uses Wisdom when it is higher.
    effects: [
      { kind: "reach", tiles: 1, unarmed: true, gate: { condition: "arms of the astral self" } },
      { kind: "save_swap", save: "str", use: "wis", checks: true, gate: { condition: "arms of the astral self" } },
    ],
    spends: [
      {
        name: "Arms of the Astral Self",
        pool: { id: "ki", amount: 1 },
        action: "bonus",
        does: {
          kind: "buff",
          condition: "arms of the astral self",
          rounds: 100,
          burst: { save: "dex", dcAbility: "wis", rangeFt: 10, dice: (level) => `2${martialDie(level)}`, type: "force" },
        },
      },
    ],
  },
  "monk::Visage of the Astral Self": {
    subclass: "Way of the Astral Self",
    spends: [
      {
        name: "Visage of the Astral Self",
        pool: { id: "ki", amount: 1 },
        action: "bonus",
        does: { kind: "buff", condition: "visage of the astral self", rounds: 100 },
      },
    ],
  },
  "monk::Body of the Astral Self": {
    subclass: "Way of the Astral Self",
    // Empowered Arms: one more roll of the martial arts die, once a turn.
    effects: [
      {
        kind: "rider",
        dice: [[11, "1d8"], [17, "1d10"]],
        type: "",
        when: "weapon",
        oncePerTurn: true,
        requiresCondition: "arms of the astral self",
        // "While both your arms and visage are summoned."
        gate: { condition: "visage of the astral self" },
      },
    ],
    reactions: [
      {
        name: "Body of the Astral Self",
        aliases: ["Deflect Energy"],
        gate: { condition: "arms of the astral self", conditions: ["visage of the astral self"], because: "needs the arms and the visage of the astral self both summoned" },
        does: {
          kind: "reduce",
          amount: (_level, mods) => `1d10+${mods.wis ?? 0}`,
          who: "self",
          types: ["acid", "cold", "fire", "force", "lightning", "thunder"],
        },
      },
    ],
  },
  "monk::Awakened Astral Self": {
    subclass: "Way of the Astral Self",
    spends: [
      {
        name: "Awakened Astral Self",
        pool: { id: "ki", amount: 5 },
        action: "bonus",
        does: { kind: "buff", condition: "awakened astral self", rounds: 10 },
      },
    ],
  },

  // ---- paladin ----
  "paladin::Aura of Warding": {
    subclass: "Oath of the Ancients",
    effects: [{ kind: "aura_resist", rangeFt: AURA_REACH, spells: true }],
  },
  "paladin::Elder Champion": {
    subclass: "Oath of the Ancients",
    counter: "sub_elder_champion",
    spends: [
      { name: "Elder Champion", pool: { id: "sub_elder_champion" }, action: "action", does: { kind: "buff", condition: "elder champion", rounds: 10 } },
    ],
    effects: [
      { kind: "turn_heal", when: "start", formula: "10", gate: { condition: "elder champion" } },
      { kind: "enemy_save", when: "near", rangeFt: 10, channel: true, gate: { condition: "elder champion" } },
    ],
  },
  "paladin::Relentless Avenger": {
    subclass: "Oath of Vengeance",
    reactions: [{ name: "Relentless Avenger", does: { kind: "move", trigger: "oa_hit", free: true } }],
  },
  "paladin::Soul of Vengeance": {
    subclass: "Oath of Vengeance",
    reactions: [{ name: "Soul of Vengeance", does: { kind: "attack", rangeFt: 5, vowed: true } }],
  },
  "paladin::Avenging Angel": {
    subclass: "Oath of Vengeance",
    counter: "sub_avenging_angel",
    spends: [
      {
        name: "Avenging Angel",
        pool: { id: "sub_avenging_angel" },
        action: "action",
        does: {
          kind: "buff",
          condition: "avenging angel",
          rounds: 600,
          burst: { save: "wis", dcAbility: "spell", rangeFt: 30, condition: "frightened", mark: "menaced by an avenging angel", rounds: 10, endsOnDamage: true, aura: true },
        },
      },
    ],
    // A creature the aura frightened also carries "menaced by an avenging
    // angel": every attack roll against it has advantage, the paladin's or
    // anyone's (src/lib/srd/authored-conditions.ts).
    effects: [{ kind: "move", fly: 60, gate: { condition: "avenging angel" } }],
  },
  "paladin::Aura of Conquest": {
    subclass: "Oath of Conquest",
    effects: [
      {
        kind: "enemy_turn_damage",
        formula: (level) => Math.floor(level / 2),
        type: "psychic",
        rangeFt: AURA_REACH,
        frightenedOnly: true,
        // Its speed is 0 while it stands in the aura (src/lib/dm/aura-hold.ts).
        holdsSpeed: true,
      },
    ],
  },
  "paladin::Invincible Conqueror": {
    subclass: "Oath of Conquest",
    counter: "sub_invincible_conqueror",
    spends: [
      {
        name: "Invincible Conqueror",
        pool: { id: "sub_invincible_conqueror" },
        action: "action",
        does: { kind: "buff", condition: "invincible conqueror", rounds: 10 },
      },
    ],
  },
  "paladin::Aura of the Guardian": {
    subclass: "Oath of Redemption",
    reactions: [{ name: "Aura of the Guardian", does: { kind: "take_for_ally", rangeFt: AURA_REACH } }],
  },
  "paladin::Channel Divinity: Rebuke the Violent": {
    subclass: "Oath of Redemption",
    reactions: [
      {
        name: "Rebuke the Violent",
        aliases: ["Channel Divinity: Rebuke the Violent"],
        pool: { id: "channel_divinity" },
        does: { kind: "echo_hit", type: "radiant", rangeFt: 30, save: { ability: "wis", dcAbility: "spell" } },
      },
    ],
  },
  "paladin::Protective Spirit": {
    subclass: "Oath of Redemption",
    effects: [{ kind: "turn_heal", when: "end", belowHalf: true, formula: (level) => `1d6+${Math.floor(level / 2)}` }],
  },
  "paladin::Emissary of Redemption": {
    subclass: "Oath of Redemption",
    effects: [
      { kind: "resist", types: "all", fromCreatures: true, gate: { notCondition: "emissary lapsed" } },
      { kind: "retaliate", formula: "half_dealt", type: "radiant", gate: { notCondition: "emissary lapsed" } },
    ],
  },
  "paladin::Aura of Alacrity": {
    subclass: "Oath of Glory",
    effects: [
      {
        kind: "speed",
        amount: 10,
        allies: { rangeFt: [[7, 5], [18, 10]], condition: "aura of alacrity" },
        note: "An ally who starts their turn within 5 feet of the paladin (10 from 18th level), while the paladin is up, has 10 more feet of speed that turn; the server lays it.",
      },
    ],
  },
  "paladin::Glorious Defense": {
    subclass: "Oath of Glory",
    counter: "sub_glorious_defense",
    reactions: [
      { name: "Glorious Defense", pool: { id: "sub_glorious_defense" }, sees: "target", does: { kind: "ac_vs_hit", amount: "cha", rangeFt: 10, strikeOnMiss: true } },
    ],
  },
  // Advantage on Charisma checks (the condition), once a turn a missed
  // weapon attack hits instead (src/lib/dm/attack-swing.ts judgeSwing), and a
  // reaction that rerolls a failed save. Once a long rest, or again for a
  // 5th-level spell slot (the pool's slotFallback).
  "paladin::Living Legend": {
    subclass: "Oath of Glory",
    counter: "sub_living_legend",
    spends: [
      { name: "Living Legend", pool: { id: "sub_living_legend", slotFallback: 5 }, action: "bonus", does: { kind: "buff", condition: "living legend", rounds: 10 } },
      { name: "Living Legend Reroll", aliases: ["Living Legend save"], action: "reaction", gate: { condition: "living legend" }, does: { kind: "reroll_save" } },
    ],
  },
  // Reactions that spent their use and changed nothing: the hit now answers to them.
  "cleric::Warding Flare": {
    subclass: "Light Domain",
    counter: "sub_warding_flare",
    reactions: [{ name: "Warding Flare", pool: { id: "sub_warding_flare" }, sees: "both", does: { kind: "disadv_vs_hit", allyWith: "improved flare", rangeFt: 30 } }],
  },
  "warlock::Entropic Ward": {
    subclass: "The Great Old One",
    counter: "sub_entropic_ward",
    reactions: [{ name: "Entropic Ward", pool: { id: "sub_entropic_ward" }, does: { kind: "disadv_vs_hit", advantageOnMiss: true } }],
  },
  "wizard::Illusory Self": {
    subclass: "School of Illusion",
    counter: "sub_illusory_self",
    reactions: [{ name: "Illusory Self", pool: { id: "sub_illusory_self" }, does: { kind: "force_miss", exhaustion: 0 } }],
  },
  "cleric::Wrath of the Storm": {
    subclass: "Tempest Domain",
    counter: "sub_wrath_of_the_storm",
    reactions: [
      {
        name: "Wrath of the Storm",
        pool: { id: "sub_wrath_of_the_storm" },
        does: { kind: "strike_back", amount: "2d8", type: "lightning", orType: "thunder", melee: true, save: { ability: "dex", dcAbility: "spell", half: true } },
      },
    ],
  },
  "cleric::Sentinel at Death's Door": {
    subclass: "Grave Domain",
    counter: "sub_sentinel_at_deaths_door",
    reactions: [{ name: "Sentinel at Death's Door", pool: { id: "sub_sentinel_at_deaths_door" }, sees: "target", does: { kind: "uncrit", rangeFt: 30 } }],
  },
  "paladin::Vigilant Rebuke": {
    subclass: "Oath of the Watchers",
    reactions: [
      { name: "Vigilant Rebuke", does: { kind: "strike_back", afterSave: true, amount: (_level, mods) => `2d8+${mods.cha ?? 0}`, type: "force", rangeFt: 30 } },
    ],
  },
  "paladin::Mortal Bulwark": {
    subclass: "Oath of the Watchers",
    counter: "sub_mortal_bulwark",
    spends: [
      { name: "Mortal Bulwark", pool: { id: "sub_mortal_bulwark" }, action: "bonus", does: { kind: "buff", condition: "mortal bulwark", rounds: 10 } },
    ],
    effects: [
      {
        kind: "attack_adv",
        vs: "types",
        types: ["aberration", "celestial", "elemental", "fey", "fiend"],
        gate: { condition: "mortal bulwark" },
      },
    ],
  },
  "paladin::Divine Allegiance": {
    subclass: "Oath of the Crown",
    reactions: [{ name: "Divine Allegiance", does: { kind: "take_for_ally", rangeFt: 5 } }],
  },
  "paladin::Unyielding Spirit": {
    subclass: "Oath of the Crown",
    effects: [{ kind: "save_adv", against: ["paralyzed", "stunned"] }],
  },
  "paladin::Exalted Champion": {
    subclass: "Oath of the Crown",
    counter: "sub_exalted_champion",
    spends: [
      { name: "Exalted Champion", pool: { id: "sub_exalted_champion" }, action: "action", does: { kind: "buff", condition: "exalted champion", rounds: 600 } },
    ],
  },
  "paladin::Dread Lord": {
    subclass: "Oathbreaker",
    counter: "sub_dread_lord",
    // The 30-foot gloom that dims bright light goes on the board with the
    // condition and follows the paladin (src/lib/battlemap/zones-features.ts).
    spends: [
      { name: "Dread Lord", pool: { id: "sub_dread_lord" }, action: "action", does: { kind: "buff", condition: "dread lord", rounds: 10, zone: "Dread Lord" } },
    ],
    // Only an enemy frightened of the oathbreaker takes the aura's 4d10.
    effects: [
      { kind: "enemy_turn_damage", formula: "4d10", type: "psychic", rangeFt: 30, frightenedOnly: true, gate: { condition: "dread lord" } },
    ],
  },

  // ---- ranger ----
  "ranger::Ranger's Companion": {
    subclass: "Beast Master",
    narrated:
      "The beast is a companion record the GM fields (pet-tools); its proficiency bonus (AC, attacks, damage, its saves and skills) and hit points are set when it is made (pet-build.ts), and it dodges until commanded (pet-command.ts).",
  },
  "ranger::Shadowy Dodge": {
    subclass: "Gloom Stalker",
    reactions: [{ name: "Shadowy Dodge", does: { kind: "disadv_vs_hit", notVsAdvantage: true } }],
  },
  "ranger::Planar Warrior": {
    subclass: "Horizon Walker",
    spends: [
      {
        name: "Planar Warrior",
        action: "bonus",
        // "Choose one creature you can see": the mark names it (quarry), so the
        // force rides the hit on that creature alone.
        does: { kind: "buff", condition: [[3, "planar warrior"], [11, "planar warrior (2d8)"]], rounds: 1, quarry: true },
      },
    ],
  },
  "ranger::Spectral Defense": {
    subclass: "Horizon Walker",
    reactions: [{ name: "Spectral Defense", does: { kind: "reduce", amount: "half", who: "self" } }],
  },
  "ranger::Slayer's Prey": {
    subclass: "Monster Slayer",
    // The ranger's condition names the creature (quarry), so the 1d6 rides
    // only "your first hit against it" (attack-damage-riders.ts onQuarry).
    spends: [{ name: "Slayer's Prey", action: "bonus", does: { kind: "buff", condition: "slayer's prey", mark: "slayer's prey (marked)", rounds: 600, quarry: true } }],
    effects: [
      { kind: "rider", dice: "1d6", type: "", when: "weapon", oncePerTurn: true, requiresCondition: "slayer's prey" },
    ],
  },
  "ranger::Supernatural Defense": {
    subclass: "Monster Slayer",
    effects: [{ kind: "save_die_vs", die: "1d6", mark: "slayer's prey (marked)", note: "Its 1d6 on a check to escape the prey's grapple rides a check named against that hold (src/lib/dm/prey-escape.ts)." }],
  },
  "ranger::Slayer's Counter": {
    subclass: "Monster Slayer",
    // "If the attack hits, your save automatically succeeds."
    reactions: [{ name: "Slayer's Counter", does: { kind: "attack", rangeFt: 5, turnsSave: true } }],
  },
  "ranger::Beguiling Twist": {
    subclass: "Fey Wanderer",
    effects: [{ kind: "save_adv", against: ["charmed", "frightened"], note: "Redirecting the charm is narrated." }],
  },
  "ranger::Gathered Swarm": {
    subclass: "Swarmkeeper",
    effects: [
      { kind: "rider", dice: [[3, "1d6"], [11, "1d8"]], type: "piercing", when: "weapon", oncePerTurn: true },
    ],
    // In place of the damage, once a turn: the swarm moves the creature hit
    // (use_resource "Gathered Swarm", variant "push"), after the hit, its die
    // taken back off (src/lib/dm/authored-spend-more.ts swarmPush).
    spends: [
      { name: "Gathered Swarm", aliases: ["Swarm Push"], oncePerTurn: true, onceKey: "gathered swarm:moved", afterWeaponHit: true, does: { kind: "swarm_push", feet: 15 } },
    ],
  },
  "ranger::Mighty Swarm": {
    subclass: "Swarmkeeper",
    effects: [{ kind: "swarm_prone", note: "Its damage step is Gathered Swarm's 1d8 from 11th level; the half cover when the swarm moves the ranger is the GM's." }],
  },
  "ranger::Perfected Bond": {
    subclass: "Drakewarden",
    counter: "sub_reflexive_resistance",
    reactions: [
      {
        name: "Reflexive Resistance",
        aliases: ["Perfected Bond"],
        pool: { id: "sub_reflexive_resistance" },
        does: {
          kind: "resist_instance",
          types: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"],
          who: "either",
          rangeFt: 30,
          bond: "drake",
        },
      },
    ],
  },
};

function martialDie(level: number): string {
  if (level >= 17) return "d10";
  if (level >= 11) return "d8";
  if (level >= 5) return "d6";
  return "d4";
}
