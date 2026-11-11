// The engine hooks of the authored subclass features, barbarian to fighter
// (the rest: authored-effects-data2.ts). One entry per feature whose rules
// text states a number or a state, keyed "class::Feature Name" as
// src/lib/srd/subclasses.json names it. Each entry says what the engine does
// with the feature: passive effects the readers apply, a use_resource spend,
// a use_reaction reaction, or, for pure roleplay and for a mechanic another
// engine must hold first, a `narrated` line saying why.
//
// Numbers follow the feature's own text; where the text names a benefit
// without a number (Mantle of Inspiration's temporary hit points, Storm
// Aura's damage) the published subclass's table is used.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const RAGING = { raging: true } as const;
const TOTEMS = ["Bear", "Eagle", "Elk", "Tiger", "Wolf"];
// Elemental Cleaver's elements: the option name and its damage type.
const ELEMENTS: Array<[string, string]> = [["Acid", "acid"], ["Cold", "cold"], ["Fire", "fire"], ["Lightning", "lightning"], ["Thunder", "thunder"]];
const STORM_DAMAGE: Array<[number, string]> = [[3, "2"], [5, "3"], [10, "4"], [15, "5"], [20, "6"]];

export const AUTHORED_DATA_A: Record<string, AuthoredEntry> = {
  // ---- barbarian ----
  "barbarian::Totem Spirit": {
    subclass: "Path of the Totem Warrior",
    spends: [{ name: "Totem Spirit", fight: "out", does: { kind: "choose", options: TOTEMS } }],
    effects: [
      { kind: "resist", types: "all", except: ["psychic"], gate: { ...RAGING, choice: "bear" } },
      { kind: "bonus_route", action: "dash", gate: { ...RAGING, choice: "eagle" } },
      { kind: "oa_disadv", gate: { ...RAGING, choice: "eagle" } },
      { kind: "speed", amount: 15, gate: { ...RAGING, choice: "elk" } },
      { kind: "jump", long: 10, high: 3, gate: { ...RAGING, choice: "tiger" } },
      { kind: "pack_adv", rangeFt: 5, gate: { ...RAGING, choice: "wolf" } },
    ],
  },
  "barbarian::Aspect of the Beast": {
    subclass: "Path of the Totem Warrior",
    spends: [{ name: "Aspect of the Beast", fight: "out", does: { kind: "choose", options: TOTEMS } }],
    effects: [
      // "Bear. ... your carrying capacity (including maximum load and maximum
      // lift) is doubled": read by the one carry reader (carry-jump-effects.ts
      // authoredCarryFactor), so the load refusal, the encumbrance tiers and
      // the lift all double. The lift alone doubled before.
      { kind: "carry_factor", factor: 2, gate: { choice: "bear" } },
      {
        kind: "check_adv",
        abilities: ["str"],
        about: "push_pull_lift_break",
        gate: { choice: "bear" },
        note: "Eagle's mile-away sight is narrated; Tiger's two skills are picked with the subclass's training (subclass-training.ts).",
      },
      // "Dim light doesn't impose disadvantage on your Wisdom (Perception) checks."
      { kind: "dim_sight", gate: { choice: "eagle" } },
      // "the travel pace of you and up to ten companions within 60 feet of you
      // is doubled". The party travels together, so a party of eleven or
      // fewer is within the 60 feet the march keeps.
      { kind: "travel", doubles: { companions: 10 }, gate: { choice: "elk" } },
      // "you can track other creatures while traveling at a fast pace, and you
      // can move stealthily while traveling at a normal pace". Tracking is a
      // Survival check no pace refuses; the normal pace is the one to lift.
      { kind: "travel", stealthAt: "normal", gate: { choice: "wolf" } },
    ],
  },
  "barbarian::Totemic Attunement": {
    subclass: "Path of the Totem Warrior",
    spends: [
      { name: "Totemic Attunement", fight: "out", does: { kind: "choose", options: TOTEMS } },
      // Elk: a bonus action during the move, through a Large or smaller
      // creature's space: STR save (8 + proficiency + Strength) or prone and
      // 1d12 + Strength bludgeoning.
      {
        name: "Elk Trample",
        aliases: ["Totemic Attunement Elk"],
        action: "bonus",
        gate: { ...RAGING, choice: "elk" },
        does: { kind: "save_effect", save: "str", dcAbility: "str", dice: "1d12+str", type: "bludgeoning", condition: "prone", rangeFt: 5, maxSize: "Large" },
      },
      // Wolf: a bonus action after a melee weapon hit knocks a Large or
      // smaller creature prone.
      {
        name: "Wolf Takedown",
        aliases: ["Totemic Attunement Wolf"],
        action: "bonus",
        gate: { ...RAGING, choice: "wolf" },
        // "knock a Large or smaller creature prone as a bonus action when you
        // hit it with a melee weapon attack": the creature a melee weapon
        // attack hit this turn, no save.
        afterWeaponHit: true,
        does: { kind: "buff", target: "enemy", condition: "prone", rounds: 10, rangeFt: 5, maxSize: "Large" },
      },
    ],
    effects: [
      { kind: "guard_aura", rangeFt: 5, gate: { ...RAGING, choice: "bear" } },
      { kind: "move", fly: "walk", gate: { ...RAGING, choice: "eagle" }, note: "Ending the turn in the air with nothing else holding the barbarian up, they fall prone (src/lib/dm/fall-landing.ts eagleBurstFalls)." },
      {
        kind: "bonus_attack",
        after: "attack",
        gate: { ...RAGING, choice: "tiger" },
        run: { feet: 20, maxSize: "Large" },
      },
    ],
  },
  "barbarian::Ancestral Protectors": {
    subclass: "Path of the Ancestral Guardian",
    effects: [
      { kind: "mark", condition: "ancestral protectors", effect: "disadv_others", oncePerTurn: true, halve: true, gate: RAGING },
    ],
  },
  "barbarian::Spirit Shield": {
    subclass: "Path of the Ancestral Guardian",
    reactions: [
      {
        name: "Spirit Shield",
        gate: RAGING,
        // "an ally you can see within 30 feet".
        sees: "target",
        does: {
          kind: "reduce",
          amount: [[6, "2d6"], [10, "3d6"], [14, "4d6"]],
          who: "ally",
          rangeFt: 30,
          reflect: { feature: "Vengeful Ancestors", type: "force" },
        },
      },
    ],
  },
  "barbarian::Storm Aura": {
    subclass: "Path of the Storm Herald",
    spends: [
      // The environment, chosen once and changed at a new level: "Storm Aura
      // (Desert)", read by the aura, Storm Soul and Raging Storm.
      { name: "Storm Environment", aliases: ["Storm Aura environment"], fight: "out", does: { kind: "choose", options: ["Desert", "Sea", "Tundra"], changeAt: "level" } },
      { name: "Storm Aura", action: "bonus", gate: RAGING, does: { kind: "storm_aura" } },
    ],
  },
  "barbarian::Storm Soul": {
    subclass: "Path of the Storm Herald",
    effects: [
      { kind: "resist", types: ["fire"], gate: { choiceOf: { feature: "Storm Aura", value: "desert" } } },
      { kind: "resist", types: ["lightning"], gate: { choiceOf: { feature: "Storm Aura", value: "sea" } } },
      { kind: "move", swim: 30, gate: { choiceOf: { feature: "Storm Aura", value: "sea" } }, note: "Breathing underwater is narrated." },
      { kind: "resist", types: ["cold"], gate: { choiceOf: { feature: "Storm Aura", value: "tundra" } }, note: "Shrugging off extreme heat or cold, lighting objects and freezing water are narrated." },
    ],
  },
  "barbarian::Shielding Storm": {
    subclass: "Path of the Storm Herald",
    effects: [
      {
        kind: "aura_resist",
        rangeFt: 10,
        typeFrom: { condition: "storm aura", map: { desert: "fire", sea: "lightning", tundra: "cold" } },
      },
    ],
  },
  // Desert: a reaction right after a creature in the aura hits the barbarian,
  // DEX save or fire equal to half the barbarian level. Sea: a reaction on
  // hitting a creature in the aura, STR save or prone. Tundra rides the
  // aura's own activation (Storm Aura with targetEnemyId, src/lib/dm/
  // authored-spend-effects.ts), STR save or speed 0.
  "barbarian::Raging Storm": {
    subclass: "Path of the Storm Herald",
    reactions: [
      {
        name: "Raging Storm",
        gate: { ...RAGING, condition: "storm aura (desert)" },
        does: {
          kind: "strike_back",
          amount: (level) => Math.floor(level / 2),
          type: "fire",
          melee: false,
          rangeFt: 10,
          save: { ability: "dex", dcAbility: "con" },
        },
      },
      {
        name: "Raging Storm",
        gate: { ...RAGING, condition: "storm aura (sea)" },
        does: { kind: "save_condition", save: "str", dcAbility: "con", condition: "prone" },
      },
    ],
  },
  "barbarian::Fanatical Focus": {
    subclass: "Path of the Zealot",
    spends: [
      { name: "Fanatical Focus", gate: RAGING, oncePer: { marker: "fanatical focus spent", rounds: 10 }, does: { kind: "reroll_save" } },
    ],
  },
  "barbarian::Form of the Beast": {
    subclass: "Path of the Beast",
    // pc_attack weapon "bite", "claws" or "tail" while raging
    // (src/lib/srd/authored-effects-more.ts authoredNaturalWeapon).
    effects: [
      { kind: "natural_weapon", gate: RAGING, weapon: { name: "Bite", aliases: ["fangs", "teeth"], dice: "1d8", type: "piercing", onHit: "bite_heal" } },
      { kind: "natural_weapon", gate: RAGING, weapon: { name: "Claws", aliases: ["claw"], dice: "1d6", type: "slashing", extraAttack: true } },
      {
        kind: "natural_weapon",
        gate: RAGING,
        weapon: { name: "Tail", dice: "1d8", type: "piercing", reach: true },
      },
    ],
    // "when a creature you can see within 10 feet hits you, a reaction adds
    // 1d8 to your AC against that attack": the tail's, so it is the weapon
    // this rage grew (or grows now).
    reactions: [
      {
        name: "Form of the Beast",
        aliases: ["Tail", "Tail Swipe"],
        gate: RAGING,
        sees: "attacker",
        does: { kind: "ac_vs_hit", amount: { die: "1d8" }, attackerWithinFt: 10, beastForm: "Tail" },
      },
    ],
  },
  // Unstable Backlash: src/lib/srd/authored-effects-w2-mt-fb.ts.
  // Bigby Presents: Giant's Power and Giant's Havoc at 3rd, Elemental Cleaver
  // at 6th, Mighty Impel at 10th, Demiurgic Colossus at 14th. Giant's Power's
  // cantrip is the option chosen; a barbarian keeps no spell list, so the
  // feature's name carries it, as a non-caster's racial cantrip does.
  "barbarian::Giant's Power": {
    subclass: "Path of the Giant",
    spends: [{ name: "Giant's Power Cantrip", aliases: ["Giant's Power"], fight: "out", does: { kind: "choose", options: ["Druidcraft", "Thaumaturgy"] } }],
  },
  "barbarian::Giant's Havoc": {
    subclass: "Path of the Giant",
    effects: [
      {
        kind: "reach",
        tiles: 1,
        gate: RAGING,
        note: "Crushing Throw's Rage damage on a Strength thrown hit, and growing Large, are the GM's to add.",
      },
    ],
  },
  "barbarian::Elemental Cleaver": {
    subclass: "Path of the Giant",
    // Chosen on entering the rage, and changed with a bonus action in it.
    // "a bonus action changes the element": free at a rest, a bonus action in
    // a fight.
    spends: [{ name: "Elemental Cleaver", action: "bonus", does: { kind: "choose", options: ELEMENTS.map(([name]) => name) } }],
    effects: ELEMENTS.flatMap(([name, type]) => [
      {
        kind: "rider" as const,
        dice: [[6, "1d6"], [14, "2d6"]] as Array<[number, string]>,
        type,
        when: "weapon" as const,
        requiresCondition: "raging",
        gate: { choice: name },
      },
      // "its damage becomes that type ... and it gains the thrown property
      // (20/60), returning to your hand after a throw".
      { kind: "infuse" as const, type, rangeFt: 20, longRangeFt: 60, gate: { ...RAGING, choice: name } },
    ]),
  },
  "barbarian::Mighty Impel": {
    subclass: "Path of the Giant",
    spends: [
      {
        name: "Mighty Impel",
        action: "bonus",
        gate: RAGING,
        does: {
          kind: "save_effect",
          save: "str",
          dcAbility: "str",
          rangeFt: 10,
          // "Medium or smaller creature", Large or smaller from 14th level
          // (Demiurgic Colossus), thrown "to an unoccupied space you can see
          // within 30 feet of you": mt-fb-spend.ts throwFoe.
          maxSize: [[10, "Medium"], [14, "Large"]],
          throws: { feet: 30 },
        },
      },
    ],
  },
  "barbarian::Demiurgic Colossus": {
    subclass: "Path of the Giant",
    effects: [
      {
        kind: "reach",
        tiles: 2,
        gate: RAGING,
        note: "Growing Large or Huge is the GM's to place; Elemental Cleaver's 2d6 is its own rider.",
      },
    ],
  },

  // ---- bard ----
  // The die on a damage roll is its holder's choice on the card their hit
  // waits on (src/lib/dm/ar-wbf-bard-dice-logic.ts); the reaction is the AC.
  "bard::Combat Inspiration": {
    subclass: "College of Valor",
    reactions: [{ name: "Combat Inspiration", usedBy: "inspired", does: { kind: "ac_vs_hit", amount: "bardic" } }],
  },
  "bard::Battle Magic": {
    subclass: "College of Valor",
    effects: [{ kind: "bonus_attack", after: "spell" }],
  },
  "bard::Mantle of Inspiration": {
    subclass: "College of Glamour",
    spends: [
      {
        name: "Mantle of Inspiration",
        pool: { id: "bardic_inspiration" },
        action: "bonus",
        does: {
          kind: "temp_hp",
          formula: [[3, "5"], [5, "8"], [10, "11"], [15, "14"]],
          allies: { rangeFt: 60, count: (_level, mods) => Math.max(1, mods.cha ?? 0) },
        },
      },
    ],
  },
  "bard::Blade Flourish": {
    subclass: "College of Swords",
    effects: [{ kind: "attack_turn_speed", feet: 10 }],
    spends: [
      // "when you hit a creature with a weapon attack" (XGtE): after the hit.
      // Master's Flourish (14): with no die left, a d6 pays.
      { name: "Blade Flourish", pool: { id: "bardic_inspiration", freeDie: { feature: "Master's Flourish", die: "d6" } }, oncePerTurn: true, afterWeaponHit: true, does: { kind: "flourish" } },
    ],
  },
  "bard::Psychic Blades": {
    subclass: "College of Whispers",
    spends: [
      {
        name: "Psychic Blades",
        pool: { id: "bardic_inspiration" },
        oncePerTurn: true,
        // "Spend a Bardic Inspiration die on a weapon hit": only after the
        // bard's weapon hit this turn, on the creature it struck.
        afterWeaponHit: true,
        does: { kind: "die_damage", dice: [[3, "2d6"], [5, "3d6"], [10, "5d6"], [15, "8d6"]], type: "psychic" },
      },
    ],
  },
  "bard::Unsettling Words": {
    subclass: "College of Eloquence",
    spends: [
      {
        name: "Unsettling Words",
        pool: { id: "bardic_inspiration" },
        action: "bonus",
        does: { kind: "buff", target: "enemy", condition: "unsettled ({bardic})", rounds: 10 },
      },
    ],
  },
  "bard::Mote of Potential": {
    subclass: "College of Creation",
    // The die this bard gives carries the mote: a check rolls the die twice
    // and keeps the higher, a save gives the roller temporary hit points,
    // an attack's burst deals the die in thunder (rolls.ts, forced-save.ts,
    // attack-swing.ts through src/lib/dm/authored-mote.ts).
    effects: [{ kind: "mote" }],
  },

  // ---- cleric ----
  "cleric::Corona of Light": {
    subclass: "Light Domain",
    spends: [
      {
        // An action of its own, as often as the cleric likes: neither the
        // feature's words nor the published feature make it a Channel
        // Divinity option, and it took a use of one.
        name: "Corona of Light",
        action: "action",
        does: { kind: "buff", condition: "corona of light", rounds: 10 },
      },
    ],
    effects: [{ kind: "enemy_save", when: "near", rangeFt: 60, anyCaster: true, damageTypes: ["fire", "radiant"], gate: { condition: "corona of light" } }],
  },
  "cleric::Dampen Elements": {
    subclass: "Nature Domain",
    reactions: [
      {
        name: "Dampen Elements",
        does: { kind: "resist_instance", types: ["acid", "cold", "fire", "lightning", "thunder"], who: "either", rangeFt: 30 },
      },
    ],
  },
  "cleric::Master of Nature": {
    subclass: "Nature Domain",
    narrated: "Commanding a charmed creature is the GM's narration of what it does; no number changes.",
  },
  "cleric::Stormborn": {
    subclass: "Tempest Domain",
    effects: [{ kind: "move", fly: "walk", note: "Only while not underground or indoors." }],
  },
  "cleric::Blessing of the Trickster": {
    subclass: "Trickery Domain",
    spends: [
      {
        name: "Blessing of the Trickster",
        action: "action",
        // "Touch a willing creature other than yourself": within 5 feet.
        does: { kind: "buff", target: "ally", othersOnly: true, condition: "blessing of the trickster", rounds: 600, rangeFt: 5 },
      },
    ],
  },
  "cleric::Inescapable Destruction": {
    subclass: "Death Domain",
    effects: [{ kind: "ignore_resist", types: ["necrotic"] }],
  },
  // cast_at_enemy's second target (src/lib/dm/authored-reaper.ts): a
  // necromancy cantrip from 1st level, a 1st to 5th level necromancy spell
  // from 17th, at no further cost.
  "cleric::Reaper": {
    subclass: "Death Domain",
    effects: [{ kind: "twin_spell", school: "necromancy", minLevel: 0, maxLevel: 0, note: "The necromancy cantrip it teaches is picked with the cleric's cantrips." }],
  },
  "cleric::Improved Reaper": {
    subclass: "Death Domain",
    effects: [{ kind: "twin_spell", school: "necromancy", minLevel: 1, maxLevel: 5 }],
  },
  "cleric::Blessing of the Forge": {
    subclass: "Forge Domain",
    counter: "sub_blessing_of_the_forge",
    spends: [
      {
        // "After a long rest ... until you use the feature again": once a
        // long rest (its counter), and the new blessing takes the old one off
        // (src/lib/dm/authored-spend-divine.ts forgeBlessing).
        name: "Blessing of the Forge",
        fight: "out",
        pool: { id: "sub_blessing_of_the_forge" },
        does: {
          kind: "variants",
          options: {
            armor: { does: { kind: "forge_blessing", condition: "blessing of the forge (armor)", family: "blessing of the forge", rounds: 14400 } },
            weapon: { does: { kind: "forge_blessing", condition: "blessing of the forge (+1)", family: "blessing of the forge", rounds: 14400 } },
          },
        },
      },
    ],
  },
  "cleric::Soul of the Forge": {
    subclass: "Forge Domain",
    effects: [
      { kind: "resist", types: ["fire"] },
      { kind: "ac", amount: 1, gate: { heavyArmor: true } },
    ],
  },
  "cleric::Saint of Forge and Fire": {
    subclass: "Forge Domain",
    effects: [
      { kind: "immune_damage", types: ["fire"] },
      { kind: "resist", types: ["bludgeoning", "piercing", "slashing"], nonmagical: true, gate: { heavyArmor: true } },
    ],
  },
  "cleric::Circle of Mortality": {
    subclass: "Grave Domain",
    // Spare the Dying at 30 feet as a bonus action: src/lib/dm/stabilize.ts.
    effects: [{ kind: "heal_max" }],
  },
  "cleric::Keeper of Souls": {
    subclass: "Grave Domain",
    effects: [{ kind: "death_heal", rangeFt: 60 }],
  },
  "cleric::Voice of Authority": {
    subclass: "Order Domain",
    reactions: [{ name: "Voice of Authority", usedBy: "party", does: { kind: "attack", rangeFt: 5 } }],
  },
  "cleric::Embodiment of the Law": {
    subclass: "Order Domain",
    counter: "sub_embodiment_of_the_law",
  },
  "cleric::Order's Wrath": {
    subclass: "Order Domain",
    effects: [
      { kind: "mark", condition: "order's wrath", effect: "ally_bonus_dice", oncePerTurn: true, dice: "2d8", damageType: "psychic" },
    ],
  },
  "cleric::Emboldening Bond": {
    subclass: "Peace Domain",
    counter: "sub_emboldening_bond",
    spends: [
      {
        name: "Emboldening Bond",
        pool: { id: "sub_emboldening_bond" },
        action: "action",
        does: {
          kind: "buff",
          target: "allies",
          condition: "emboldening bond",
          rounds: 100,
          rangeFt: 30,
          // The cleric and one fewer than their proficiency bonus of others.
          count: (level) => 1 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4),
        },
      },
    ],
  },
  // Range 30 feet, 60 with Expansive Bond (17th), which also gives the
  // creature taking the damage resistance to it.
  "cleric::Protective Bond": {
    subclass: "Peace Domain",
    reactions: [
      {
        name: "Protective Bond",
        usedBy: "party",
        does: { kind: "take_for_ally", rangeFt: [[6, 30], [17, 60]], resistFrom: 17, bond: "emboldening bond", teleport: true },
      },
    ],
  },
  "cleric::Expansive Bond": {
    subclass: "Peace Domain",
    // Protective Bond's 60-foot reach and the resistance to what it takes
    // from 17th level (its reaction's rangeFt ladder and resistFrom).
    heldBy: { file: "src/lib/dm/authored-reactions.ts", call: "resistFrom" },
  },
  "cleric::Vigilant Blessing": {
    subclass: "Twilight Domain",
    spends: [
      {
        name: "Vigilant Blessing",
        action: "action",
        does: { kind: "buff", target: "ally", condition: "vigilant blessing", rounds: 14400 },
      },
    ],
  },
};

// The Storm Aura's numbers by barbarian level, for the spend.
export const STORM_AURA = {
  desert: STORM_DAMAGE,
  sea: [[3, "1d6"], [10, "2d6"], [15, "3d6"], [20, "4d6"]] as Array<[number, string]>,
  tundra: STORM_DAMAGE,
};
