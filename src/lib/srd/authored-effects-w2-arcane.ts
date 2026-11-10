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
