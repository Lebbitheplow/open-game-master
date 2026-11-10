// The arcane subclasses' rows built in the second wave of the clause ledger
// (scripts/clauses/arcane.json): features of the wizard, sorcerer, warlock
// and bard whose text states a mechanic no row held. Registered in
// AUTHORED_TABLE (src/lib/srd/authored-effects.ts) with one line, so the
// other packages' tables are never appended to.
//
// Pure.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const LUNAR_PHASES = ["Full Moon", "New Moon", "Crescent Moon"];

export const AUTHORED_DATA_W2_ARCANE: Record<string, AuthoredEntry> = {
  // "Once per turn when you deal damage to a creature or object with a wizard
  // spell, you can spend one to deal extra force damage equal to half your
  // wizard level": after a wizard spell of this turn hurt the creature
  // (src/lib/dm/spell-damage-mark.ts), on that creature. What a rest gives
  // back is the counter's row (restHolds in authored-resources.json).
  "wizard::Power Surge": {
    subclass: "War Magic",
    spends: [
      {
        // The counter's own name, so its card and painting stay the surge's.
        name: "Power Surges",
        aliases: ["Power Surge"],
        pool: { id: "sub_power_surge" },
        oncePerTurn: true,
        afterSpellDamage: true,
        does: { kind: "die_damage", dice: (level) => Math.max(1, Math.floor(level / 2)), type: "force" },
      },
    ],
  },
  // "As an action, animate a Large or smaller nonmagical item within 30 feet
  // as a Dancing Item for an hour": an ally with its stat block
  // (src/lib/dm/summon-arcane.ts). The slot that buys another use is the
  // counter's fallbackSlot.
  "bard::Animating Performance": {
    subclass: "College of Creation",
    spends: [{ name: "Animating Performance", pool: { id: "sub_animating_performance" }, action: "action", does: { kind: "summon", form: "Dancing Item" } }],
  },
  // "Create a nonmagical item worth no more than 20 times your bard level as
  // an action": the item named goes into the pack (authored-spend-arcane.ts).
  "bard::Performance of Creation": {
    subclass: "College of Creation",
    spends: [{ name: "Performance of Creation", pool: { id: "sub_performance_of_creation" }, action: "action", does: { kind: "create_item", gpPerLevel: 20 } }],
  },
  // The Bladesong's "advantage on Acrobatics" while it runs (the counter
  // sub_bladesong lays the condition; its AC and speed are condition-effects.ts's).
  "wizard::Bladesong": {
    subclass: "Bladesinging",
    effects: [{ kind: "check_adv", skills: ["acrobatics"], gate: { condition: "bladesong" } }],
  },
  // "While your spellbook is on your person you have advantage on
  // Intelligence (Arcana) checks". The reaction that spends the book is the
  // counter's (src/lib/dm/reaction-counters.ts); a wizard's book is taken to
  // be carried, as every wizard spell cast from it is.
  "wizard::One with the Word": {
    subclass: "Order of Scribes",
    effects: [{ kind: "check_adv", skills: ["arcana"] }],
  },
  // "and advantage on saves against being charmed or frightened"; the
  // psychic resistance is feature-effects.ts's.
  "sorcerer::Psychic Defenses": {
    subclass: "Aberrant Mind",
    effects: [{ kind: "save_adv", against: ["charmed", "frightened"] }],
  },
  // "As a bonus action you can spend 1 sorcery point to change your current
  // phase": in a fight too, where Lunar Embodiment's own choice (fight: out)
  // is shut. The free castings of each phase's spell are the cast guard's
  // (src/lib/srd/counter-casts.ts sub_waxing_and_waning).
  "sorcerer::Waxing and Waning": {
    subclass: "Lunar Sorcery",
    spends: [
      {
        name: "Change Phase",
        aliases: ["Waxing and Waning"],
        pool: { id: "sorcery_points", amount: 1 },
        action: "bonus",
        does: { kind: "choose", options: LUNAR_PHASES, feature: "Lunar Embodiment" },
      },
    ],
  },
};
