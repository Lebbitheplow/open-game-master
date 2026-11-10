// The cyberpunk, dark fantasy and horror features whose rule is one of the
// feature-effects table's own shapes (initiative, the critical range, magical
// strikes), as that table's entries (src/lib/srd/feature-effects.ts appends
// them). Each names its class, so another class's feature of the same name
// is never read as this one, and a feature the SRD tables answer by name for
// another class (the warlock's Thought Shield) is held to its own text here.
//
// Imports only types and the pure text helper: feature-effects.ts imports
// this module's values.
import type { FeatureDef } from "@/lib/srd/feature-effects";
import { textKey } from "@/lib/language/text-logic";

// effectsFor compares the sheet's class keyed (textKey: "street samurai").
const of = (classId: string) => [textKey(classId)];

export const GENRE_A_FEATURE_DEFS: FeatureDef[] = [
  // "+2 to initiative", and Reflex Booster II: "Initiative bonus improves to +4".
  { match: ["chrome reflexes"], classes: of("street_samurai"), effects: [{ kind: "initiative_bonus", amount: 2 }], guidance: "Chrome Reflexes: +2 to initiative; the street samurai cannot be surprised while conscious." },
  { match: ["reflex booster ii"], classes: of("street_samurai"), effects: [{ kind: "initiative_bonus", amount: 2 }], guidance: "Reflex Booster II: the initiative bonus is +4." },
  { match: ["killing instinct"], classes: of("street_samurai"), effects: [{ kind: "crit_range", low: 19 }], guidance: "Killing Instinct: weapon attacks score a critical hit on 19-20." },
  // The Great Old One's Thought Shield resists psychic damage; the esper's
  // gives +2 on Wisdom saves (an authored row) and no resistance.
  { match: ["thought shield"], classes: of("esper"), effects: [{ kind: "narrative" }], guidance: "Thought Shield: the esper's mind cannot be read, and they add +2 to Wisdom saves." },
  { match: ["silvered strikes"], classes: of("slayer"), effects: [{ kind: "magical_attacks" }], guidance: "Silvered Strikes: the slayer's weapon attacks count as silvered and magical for overcoming resistance." },
];
