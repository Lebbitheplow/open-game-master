// The druid and artificer subclass rows the gap study's second wave built
// (scripts/clauses/divine.json): features whose words state a number, a
// condition or a refusal that no row held before. Resolved by the engines
// AUTHORED_READERS names, like every authored row.
//
// Only keys no other table holds: AUTHORED_TABLE spreads the tables into one,
// so a key repeated here would replace the older row whole.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const STARRY = { archer: "starry form: archer", chalice: "starry form: chalice", dragon: "starry form: dragon" };

export const AUTHORED_DATA_W2_DIVINE_DRA: Record<string, AuthoredEntry> = {
  // "Spend a Wild Shape use to glow with a constellation for 10 minutes": the
  // Wild Shape pool pays (a counter of its own gave a Stars druid two forms and
  // two shapes a rest). Taken again it replaces the form; from 10th level
  // Twinkling Constellations changes it once a turn for nothing. The Archer's
  // arrow is the form's granted attack (src/lib/srd/condition-effects.ts), the
  // Chalice's second healing src/lib/dm/heal-after-dra.ts, the Dragon's
  // floor of 10 on Intelligence and Wisdom checks the effect below and its
  // concentration floor the condition's own row.
  "druid::Starry Form": {
    subclass: "Circle of Stars",
    spends: [
      {
        name: "Starry Form",
        pool: { id: "wild_shape" },
        action: "bonus",
        swap: { family: "starry form", feature: "Twinkling Constellations" },
        does: { kind: "buff", condition: STARRY.archer, variants: STARRY, rounds: 100, replaces: "starry form" },
      },
    ],
    effects: [{ kind: "check_floor", skills: [], abilities: ["int", "wis"], floor: 10, gate: { condition: STARRY.dragon } }],
  },
  // "You gain resistance to acid and poison damage, immunity to the poisoned
  // condition": the resistances are read from the words (feature-effects.ts);
  // the immunity was not, and set_condition laid poisoned on the alchemist.
  // The free Greater Restoration and Heal are counter casts
  // (src/lib/srd/counter-casts.ts).
  "artificer::Chemical Mastery": {
    subclass: "Alchemist",
    effects: [{ kind: "immune_condition", conditions: ["poisoned"] }],
  },
};
