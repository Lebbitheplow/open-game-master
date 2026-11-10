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
