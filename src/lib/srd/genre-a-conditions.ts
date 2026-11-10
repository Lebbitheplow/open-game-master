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
  // "An ally you heal gains +2 AC until the start of your next turn"
  { id: "covering_stim", match: ["covering stim"], summary: "Covering Stim: +2 AC until the start of the trauma doc's next turn.", acBonus: 2 },
  { id: "deathly_pact_blade", match: ["deathly pact blade"], summary: "Deathly Pact Blade: the grave knight's bonded weapon is in hand, and it counts as magical.", magicalStrikes: true },
  // The capstones' marks (src/lib/srd/authored-effects-genre-a-capstones.ts).
  { id: "psychic_flight", match: ["psychic flight"], summary: "Psychic Flight: a 30-foot flying speed for 10 minutes." },
  { id: "storm_of_blades", match: ["storm of blades"], summary: "Storm of Blades: for a minute the street samurai makes one additional blade attack with each Attack action." },
  { id: "singularity", match: ["singularity"], summary: "Singularity: the esper's next psionic of 5th level or lower this turn costs no slot and may strike a second target." },
  { id: "author_of_the_unwritten", match: ["author of the unwritten"], summary: "Author of the Unwritten: the occultist's next warlock spell of 5th level or lower this turn costs no slot and may strike a second target." },
  { id: "the_grave_chorus", match: ["the grave chorus"], summary: "The Grave Chorus: for a minute each dirge the dirgesinger casts may strike one additional target." },
  { id: "bleeding_power", match: ["bleeding power"], summary: "Bleeding Power: the apostate's next stigmata this turn (1st level; up to 3rd with Deeper Scars) costs no slot." },
  { id: "their_power_your_hands", match: ["their power, your hands"], summary: "Their Power, Your Hands: the apostate's next stigmata of 5th level or lower this turn costs no slot and deals its maximum damage." },
  { id: "beyond_the_veil", match: ["beyond the veil"], summary: "Beyond the Veil: for a minute they see invisible creatures and into the Ethereal Plane, and strike what stands there.", seesInvisible: true },
  { id: "deathless_champion", match: ["deathless champion"], summary: "Deathless Champion: for a minute the grave knight cannot drop below 1 hit point." },
];
