// The conditions the cyberpunk, dark fantasy and horror classes' spends lay
// (src/lib/srd/authored-effects-genre-a.ts), as rows of the condition effects
// registry (src/lib/srd/condition-effects.ts spreads them): each is the record
// the readers hold for as long as the feature lasts.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

export const GENRE_A_CONDITIONS: ConditionEffectRow[] = [
  { id: "static_shield", match: ["static shield"], summary: "Static Shield: +2 AC until the start of the esper's next turn.", acBonus: 2 },
  // "for 1 minute your attacks ignore resistance and immunity to nonmagical damage"
  { id: "one_against_the_night", match: ["one against the night"], summary: "One Against the Night: for a minute the slayer's weapon strikes count as magical, past resistance and immunity to nonmagical damage.", magicalStrikes: true },
  // "gain resistance to that damage type until your next turn": the type rides
  // in the name, "blood ward (fire)".
  { id: "blood_ward", match: ["blood ward"], summary: "Blood Ward: resistance to the named damage type until the start of the apostate's next turn.", paramResistance: true },
  // "for 1 minute you cannot drop below 1 HP": src/lib/dm/genre-drop-holds.ts reads it.
  // "summon your bonded weapon to hand from anywhere; it counts as magical"
  { id: "deathly_pact_blade", match: ["deathly pact blade"], summary: "Deathly Pact Blade: the grave knight's bonded weapon is in hand, and it counts as magical.", magicalStrikes: true },
  { id: "deathless_champion", match: ["deathless champion"], summary: "Deathless Champion: for a minute the grave knight cannot drop below 1 hit point." },
];
