// The subclass counters whose text states a number, a condition, a save,
// damage or healing, and whose spend was the counter moving and its guidance
// read back (WAVE1 R11: "A counter whose text states a number, a condition, a
// save, damage, healing or a refusal is built, never left as guidance"). Each
// row is the spend that does it, on the counter of the feature's own name
// (src/lib/srd/authored-resources.json), resolved by
// src/lib/dm/authored-spend-effects.ts like every authored spend.
//
// A condition laid here is the record the readers hold: the holder's or the
// ally's sheet carries it for the rounds the feature lasts.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

// Half a rogue's Sneak Attack dice, rounded up (Wails from the Grave).
const HALF_SNEAK: Array<[number, string]> = [[1, "1d6"], [5, "2d6"], [9, "3d6"], [13, "4d6"], [17, "5d6"]];

export const AUTHORED_DATA_COUNTERS: Record<string, AuthoredEntry> = {
  // "advantage on attack rolls and saving throws until the start of your next
  // turn" for up to ten creatures within 60 feet.
  "barbarian::Zealous Presence": {
    subclass: "Path of the Zealot",
    counter: "sub_zealous_presence",
    spends: [
      {
        name: "Zealous Presence",
        pool: { id: "sub_zealous_presence" },
        action: "bonus",
        does: { kind: "buff", target: "allies", condition: "zealous presence", rounds: 1, rangeFt: 60, count: "10" },
      },
    ],
  },
  // A d3 on attacks and checks for 10 minutes, or a spell slot back.
  "barbarian::Bolstering Magic": {
    subclass: "Path of Wild Magic",
    counter: "sub_bolstering_magic",
    spends: [
      {
        name: "Bolstering Magic",
        pool: { id: "sub_bolstering_magic" },
        action: "action",
        does: {
          kind: "variants",
          options: {
            bolster: { does: { kind: "buff", target: "ally", condition: "bolstering magic (d3)", rounds: 100 } },
            slot: { does: { kind: "regain_slot", die: "1d3" } },
          },
        },
      },
    ],
  },
  "bard::Unbreakable Majesty": {
    subclass: "College of Glamour",
    counter: "sub_unbreakable_majesty",
    spends: [{ name: "Unbreakable Majesty", pool: { id: "sub_unbreakable_majesty" }, action: "bonus", does: { kind: "buff", condition: "unbreakable majesty", rounds: 10 } }],
  },
  "bard::Universal Speech": {
    subclass: "College of Eloquence",
    counter: "sub_universal_speech",
    spends: [{ name: "Universal Speech", pool: { id: "sub_universal_speech" }, action: "action", does: { kind: "buff", condition: "universal speech", rounds: 600 } }],
  },
  // "share your darkvision with willing creatures you can see within 10 feet
  // of you, up to a number of creatures equal to your Wisdom modifier".
  "cleric::Eyes of Night": {
    subclass: "Twilight Domain",
    counter: "sub_eyes_of_night",
    spends: [
      {
        name: "Eyes of Night",
        pool: { id: "sub_eyes_of_night" },
        action: "action",
        does: { kind: "buff", target: "allies", condition: "eyes of night (300 ft darkvision)", rounds: 600, rangeFt: 10, count: "wis", sight: true },
      },
    ],
  },
  "rogue::Wails from the Grave": {
    subclass: "Phantom",
    counter: "sub_wails_from_the_grave",
    spends: [
      {
        name: "Wails from the Grave",
        pool: { id: "sub_wails_from_the_grave" },
        action: "none",
        oncePerTurn: true,
        afterWeaponHit: true,
        does: { kind: "die_damage", dice: HALF_SNEAK, type: "necrotic" },
      },
    ],
  },
  "rogue::Ghost Walk": {
    subclass: "Phantom",
    counter: "sub_ghost_walk",
    spends: [{ name: "Ghost Walk", pool: { id: "sub_ghost_walk" }, action: "bonus", does: { kind: "buff", condition: "ghost walk", rounds: 100 } }],
  },
  "sorcerer::Clockwork Cavalcade": {
    subclass: "Clockwork Soul",
    counter: "sub_clockwork_cavalcade",
    spends: [{ name: "Clockwork Cavalcade", pool: { id: "sub_clockwork_cavalcade" }, action: "action", does: { kind: "heal_area", formula: "100", rangeFt: 30, divided: true } }],
  },
  // The phase released: Full Moon blinds on a failed Constitution save, New
  // Moon deals 3d10 necrotic on a failed Dexterity save, Crescent Moon moves
  // the sorcerer 60 feet.
  "sorcerer::Lunar Phenomenon": {
    subclass: "Lunar Sorcery",
    counter: "sub_lunar_phenomenon",
    spends: [
      {
        name: "Lunar Phenomenon",
        pool: { id: "sub_lunar_phenomenon" },
        action: "bonus",
        does: {
          kind: "variants",
          options: {
            // The hostile creatures within 30 feet; the GM leaves out any the
            // sorcerer spares.
            "full moon": { does: { kind: "save_area", save: "con", dcAbility: "spell", rangeFt: 30, condition: "blinded", untilNextTurnEnds: true } },
            "new moon": { does: { kind: "save_area", save: "dex", dcAbility: "spell", rangeFt: 30, dice: "3d10", type: "necrotic" } },
            "crescent moon": { does: { kind: "teleport", feet: 60 } },
          },
        },
      },
    ],
  },
  // One of four senses until the wizard is incapacitated or rests.
  "wizard::The Third Eye": {
    subclass: "School of Divination",
    counter: "sub_third_eye",
    spends: [
      {
        name: "The Third Eye",
        pool: { id: "sub_third_eye" },
        action: "action",
        does: {
          kind: "buff",
          condition: "the third eye (darkvision 60 ft)",
          rounds: 4800,
          variants: {
            darkvision: "the third eye (darkvision 60 ft)",
            ethereal: "the third eye (ethereal sight)",
            languages: "the third eye (reads any language)",
            invisibility: "the third eye (sees invisibility 10 ft)",
          },
        },
      },
    ],
  },
  // A d6 on the table at a long rest; drunk, its one effect.
  "artificer::Experimental Elixir": {
    subclass: "Alchemist",
    counter: "art_experimental_elixir",
    spends: [
      {
        name: "Experimental Elixir",
        pool: { id: "art_experimental_elixir" },
        action: "action",
        does: {
          kind: "variants",
          options: {
            healing: { does: { kind: "flames", formula: "2d4+int", type: "", healOnly: true } },
            swiftness: { does: { kind: "buff", target: "ally", condition: "elixir of swiftness (+10 ft speed)", rounds: 600 } },
            resilience: { does: { kind: "buff", target: "ally", condition: "elixir of resilience (+1 AC)", rounds: 100 } },
            boldness: { does: { kind: "buff", target: "ally", condition: "elixir of boldness (d4)", rounds: 10 } },
            flight: { does: { kind: "buff", target: "ally", condition: "flying", rounds: 100 } },
            transformation: { does: { kind: "buff", target: "ally", condition: "elixir of transformation", rounds: 100 } },
          },
        },
      },
    ],
  },
};
