// The engine hooks of the authored subclass features, druid and fighter
// (the shape of an entry: authored-effects-data.ts).

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";


// The mark an Echo Knight's manifested echo leaves on them (Manifest Echo).
export const ECHO_OUT = "echo manifested";
export const AUTHORED_DATA_A2: Record<string, AuthoredEntry> = {
  // ---- druid ----
  // Combat Wild Shape spends Wild Shape's own uses: the change as a bonus
  // action (src/lib/dm/resource-turn.ts) and a slot burned for 1d8 per
  // level while transformed (src/lib/dm/mutations.ts).
  "druid::Combat Wild Shape": {
    subclass: "Circle of the Moon",
    counter: "wild_shape",
  },
  // The Circle of the Land's terrain, chosen when the druid joins it: its
  // circle spells are the chosen land's (class-features.json choiceSpells).
  "druid::Circle Spells": {
    subclass: "Circle of the Land",
    spends: [
      {
        name: "Circle Land",
        aliases: ["Circle Spells", "Land"],
        fight: "out",
        does: { kind: "choose", options: ["Arctic", "Coast", "Desert", "Forest", "Grassland", "Mountain", "Swamp", "Underdark"] },
      },
    ],
  },
  "druid::Halo of Spores": {
    subclass: "Circle of Spores",
    reactions: [
      {
        name: "Halo of Spores",
        // "a creature you can see": the creature struck (authored-reactions.ts strike_back).
        sees: "attacker",
        // Spreading Spores: "you can't use Halo of Spores' reaction while the
        // cube lasts" (the druid carries "spreading spores" while it does).
        gate: { notCondition: "spreading spores" },
        does: {
          kind: "strike_back",
          amount: [[2, "1d4"], [6, "1d6"], [10, "1d8"], [14, "1d10"]],
          type: "necrotic",
          rangeFt: 10,
          save: { ability: "con", dcAbility: "spell" },
        },
      },
    ],
  },
  "druid::Symbiotic Entity": {
    subclass: "Circle of Spores",
    spends: [
      {
        name: "Symbiotic Entity",
        pool: { id: "wild_shape" },
        action: "action",
        does: { kind: "buff", condition: "symbiotic entity", rounds: 100, tempHp: (level) => 4 * level },
      },
    ],
  },
  "druid::Fungal Body": {
    subclass: "Circle of Spores",
    effects: [
      { kind: "immune_condition", conditions: ["blinded", "deafened", "frightened", "poisoned"] },
      { kind: "crit_immune" },
    ],
  },
  "druid::Twinkling Constellations": {
    subclass: "Circle of Stars",
    effects: [
      {
        kind: "move",
        fly: 20,
        gate: { condition: "starry form: dragon" },
        note: "The Archer's 2d8 is the Starry Form row's own; changing constellation each turn is narrated.",
      },
    ],
  },
  "druid::Summon Wildfire Spirit": {
    subclass: "Circle of Wildfire",
    spends: [
      {
        name: "Summon Wildfire Spirit",
        aliases: ["Wildfire Spirit"],
        pool: { id: "wild_shape" },
        action: "action",
        // The spirit joins the table as a creature beside the druid and burns
        // what stands around its arrival (src/lib/dm/feature-summons-dra.ts);
        // the condition is what Enhanced Bond and Blazing Revival read.
        does: { kind: "wildfire_spirit", condition: "wildfire spirit", rounds: 600 },
      },
    ],
  },
  "druid::Enhanced Bond": {
    subclass: "Circle of Wildfire",
    effects: [
      {
        kind: "spell_rider",
        dice: "1d8",
        damageTypes: ["fire"],
        healing: true,
        gate: { condition: "wildfire spirit" },
        note: "A fire or healing spell that does not reach from the druid is cast from the spirit's space (cast-origin.ts).",
      },
    ],
  },
  "druid::Cauterizing Flames": {
    subclass: "Circle of Wildfire",
    counter: "sub_cauterizing_flames",
    spends: [
      {
        name: "Cauterizing Flames",
        pool: { id: "sub_cauterizing_flames" },
        action: "reaction",
        // On a creature standing in one of the druid's spectral flames
        // (src/lib/dm/cauterizing-flames.ts): heal it or burn it.
        does: {
          kind: "variants",
          options: {
            heal: { does: { kind: "cauterizing", mode: "heal", formula: (_level, mods) => `2d10+${mods.wis ?? 0}`, type: "fire" } },
            burn: { does: { kind: "cauterizing", mode: "burn", formula: (_level, mods) => `2d10+${mods.wis ?? 0}`, type: "fire" } },
          },
        },
      },
    ],
  },
  // XGtE: a bonus action to teleport the druid, an action to teleport a
  // willing creature they touch.
  "druid::Hidden Paths": {
    subclass: "Circle of Dreams",
    counter: "sub_hidden_paths",
    spends: [
      {
        name: "Hidden Paths",
        pool: { id: "sub_hidden_paths" },
        does: {
          kind: "variants",
          options: {
            self: { does: { kind: "teleport", feet: 60 }, action: "bonus" },
            touch: { does: { kind: "teleport", feet: 30, touched: true }, action: "action" },
          },
        },
      },
    ],
  },

  // ---- fighter ----
  "fighter::Know Your Enemy": {
    subclass: "Battle Master",
    narrated: "Information the GM gives after a minute of watching: nothing on a sheet changes.",
  },
  "fighter::Relentless": {
    subclass: "Battle Master",
    effects: [{ kind: "init_refill", resource: "sub_superiority_dice" }],
  },
  "fighter::Weapon Bond": {
    subclass: "Eldritch Knight",
    narrated: "Not being disarmed and calling the bonded weapon to hand are inventory narration.",
  },
  "fighter::War Magic": {
    subclass: "Eldritch Knight",
    effects: [{ kind: "bonus_attack", after: "cantrip" }],
  },
  "fighter::Eldritch Strike": {
    subclass: "Eldritch Knight",
    effects: [{ kind: "mark", condition: "eldritch strike", effect: "save_disadv" }],
  },
  // Curving Shot (XGtE): "When you make an attack roll with a magic arrow and
  // miss, you can use a bonus action to reroll the attack roll against a
  // different target within 60 feet of the original target" (issue 233).
  "fighter::Curving Shot": {
    subclass: "Arcane Archer",
    effects: [{ kind: "bonus_attack", after: "missed_arrow" }],
  },
  "fighter::Ever-Ready Shot": {
    subclass: "Arcane Archer",
    effects: [{ kind: "init_refill", resource: "sub_arcane_shot" }],
  },
  "fighter::Born to the Saddle": {
    subclass: "Cavalier",
    effects: [{ kind: "save_adv", against: ["dismount"] }],
  },
  "fighter::Unwavering Mark": {
    subclass: "Cavalier",
    counter: "sub_unwavering_mark",
    // "until the end of your next turn. While it is within 5 feet of you".
    effects: [{ kind: "mark", condition: "unwavering mark", effect: "disadv_others", melee: true, untilNextTurnEnds: true, rangeFt: 5 }],
  },
  // "Creatures provoke an opportunity attack from you when they move 5 feet or
  // more while within your reach, and a creature you hit with an opportunity
  // attack has its speed reduced to 0": the opportunity engine's own trigger
  // and hit (opportunity.ts, opportunity-strike.ts). It was a reaction taken
  // on the call's word, with no creature having moved.
  "fighter::Hold the Line": {
    subclass: "Cavalier",
    heldBy: { file: "src/lib/dm/opportunity.ts", call: "movesWithinReachAt(" },
  },
  "fighter::Vigilant Defender": {
    subclass: "Cavalier",
    effects: [{ kind: "oa_each_turn" }],
  },
  "fighter::Elegant Courtier": {
    subclass: "Samurai",
    // "Add your Wisdom modifier to Persuasion checks and gain proficiency in
    // Wisdom saving throws (Intelligence or Charisma if you already have it)":
    // the row swapped Charisma in for Wisdom on the save and added nothing to
    // the check. The option is for a fighter who already saves on Wisdom.
    spends: [{ name: "Elegant Courtier", fight: "out", does: { kind: "choose", options: ["Intelligence", "Charisma"] } }],
    effects: [
      { kind: "check_bonus", skills: ["persuasion"], ability: "wis" },
      { kind: "save_prof", abilities: ["wis"], elseOneOf: ["int", "cha"] },
    ],
  },
  "fighter::Tireless Spirit": {
    subclass: "Samurai",
    effects: [{ kind: "init_refill", resource: "sub_fighting_spirit" }],
  },
  "fighter::Rapid Strike": {
    subclass: "Samurai",
    // "one more attack against the same target": the last attack left of the
    // action is owed to that creature (authored-attacks.ts rapidStrikeOwed).
    effects: [{ kind: "rapid_strike" }],
  },
  // The echo is a token on the board and a mark on the knight while it lasts
  // (src/lib/dm/mt-fb-echo.ts): the mark is what needs it out asks (Shadow
  // Martyr sends it into a hit only while it is out, and the hit that destroys
  // it takes the mark off, authored-reactions.ts echo_takes_hit), the token is
  // its square, the 30 feet it may stray and where its attacks reach from.
  "fighter::Manifest Echo": {
    subclass: "Echo Knight",
    spends: [{ name: "Manifest Echo", action: "bonus", does: { kind: "echo" } }],
  },
  "fighter::Shadow Martyr": {
    subclass: "Echo Knight",
    counter: "sub_shadow_martyr",
    reactions: [{ name: "Shadow Martyr", pool: { id: "sub_shadow_martyr" }, sees: "target", gate: { condition: ECHO_OUT }, does: { kind: "echo_takes_hit" } }],
  },
  "fighter::Legion of One": {
    subclass: "Echo Knight",
    effects: [{ kind: "init_refill", resource: "sub_unleash_incarnation" }],
  },
  // Every Psionic Energy die returns on a long rest; once per short or long
  // rest a bonus action regains one (Tasha's).
  "fighter::Psionic Power (Psi Warrior)": {
    subclass: "Psi Warrior",
    counter: "sub_psionic_energy",
    spends: [
      {
        name: "Psionic Recovery",
        aliases: ["Regain Psionic Energy"],
        pool: { id: "sub_psionic_recovery" },
        action: "bonus",
        does: { kind: "restore", pool: "sub_psionic_energy", amount: 1 },
      },
    ],
  },
  "fighter::Protective Field": {
    subclass: "Psi Warrior",
    reactions: [
      {
        name: "Protective Field",
        pool: { id: "sub_psionic_energy" },
        does: { kind: "reduce", amount: "psionic_int", who: "either", rangeFt: 30 },
      },
    ],
  },
  "fighter::Telekinetic Adept": {
    subclass: "Psi Warrior",
    spends: [
      {
        name: "Telekinetic Adept",
        aliases: ["Telekinetic Thrust", "Psi-Powered Leap"],
        does: {
          kind: "variants",
          options: {
            // "When you deal damage to a target with your Psionic Strike"
            // (TCoE): it follows the hit, on the creature hit.
            thrust: {
              does: { kind: "save_effect", save: "str", dcAbility: "int", condition: "prone", rangeFt: 5 },
              action: "none",
              afterWeaponHit: true,
            },
            // "or pushed 10 feet": the same save, the creature moved instead.
            push: {
              does: { kind: "save_effect", save: "str", dcAbility: "int", rangeFt: 5, pushes: { feet: 10 } },
              action: "none",
              afterWeaponHit: true,
            },
            leap: { does: { kind: "buff", condition: "flying", rounds: 1 }, action: "bonus" },
          },
        },
      },
    ],
  },
  "fighter::Bulwark of Force": {
    subclass: "Psi Warrior",
    counter: "sub_bulwark_of_force",
    spends: [
      {
        name: "Bulwark of Force",
        pool: { id: "sub_bulwark_of_force", fallback: "sub_psionic_energy" },
        action: "bonus",
        does: {
          kind: "buff",
          target: "allies",
          condition: "bulwark of force",
          rounds: 10,
          rangeFt: 30,
          count: (_level, mods) => Math.max(1, mods.int ?? 0),
        },
      },
    ],
  },
  "fighter::Telekinetic Master": {
    subclass: "Psi Warrior",
    counter: "sub_telekinetic_master",
    effects: [{ kind: "bonus_attack", after: "telekinesis" }],
  },
  // Spent its use and changed nothing: the hit on an ally now answers to it.
  "fighter::Runic Shield": {
    subclass: "Rune Knight",
    counter: "sub_runic_shield",
    reactions: [{ name: "Runic Shield", pool: { id: "sub_runic_shield" }, sees: "target", does: { kind: "reroll_hit", rangeFt: 60 } }],
  },
  "fighter::Great Stature": {
    subclass: "Rune Knight",
    spends: [
      {
        name: "Giant's Might",
        pool: { id: "sub_giants_might" },
        action: "bonus",
        does: { kind: "buff", condition: "giant's might (1d8)", rounds: 10 },
      },
    ],
  },
  "fighter::Runic Juggernaut": {
    subclass: "Rune Knight",
    spends: [
      {
        name: "Giant's Might",
        pool: { id: "sub_giants_might" },
        action: "bonus",
        does: { kind: "buff", condition: "giant's might (1d10)", rounds: 10 },
      },
    ],
    // "can make you Huge with 5 extra feet of reach", while the might lasts.
    effects: [{ kind: "reach", tiles: 1, gate: { condition: "giant's might (1d10)" } }],
  },
  "fighter::Inspiring Surge": {
    subclass: "Banneret",
    // "use a reaction to make one weapon attack; two allies from 18th level".
    reactions: [{ name: "Inspiring Surge", usedBy: "party", does: { kind: "attack", rangeFt: 5, weaponRange: true, answers: [[10, "1"], [18, "2"]] } }],
  },
};
