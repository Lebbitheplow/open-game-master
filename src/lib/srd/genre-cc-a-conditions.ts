// The conditions the 2026-11-13 creator audit's second genre pass lays for the
// cyberpunk and dark fantasy classes, as rows of the condition effects
// registry (src/lib/srd/genre-a-conditions.ts spreads them). Pure data.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Sanctioned Execution: "prevent regeneration and revival for 24 hours"
// (src/lib/dm/genre-cc-a-dark-fantasy.ts lays it with the stopped Regeneration).
export const SANCTIONED = "sanctioned execution";

// Rat Tide: "distracted (disadvantage on their next attack)", laid by the
// swarm's area (src/lib/battlemap/zones-genre-cc-a.ts) on a failed DEX save.
export const RAT_DISTRACTED = "distracted by rats";
// The Crown Descends: "every enemy within 30 ft is swarmed: half speed, no
// reactions, and 1d6 piercing at the start of each of its turns" (the bite is
// src/lib/dm/genre-cc-a-turns.ts's).
export const SWARMED = "swarmed";
// The Walls Have Teeth: "enemies within 10 ft of [your swarm] cannot take
// reactions", laid and lifted as the swarm and the creatures move
// (src/lib/dm/genre-cc-a-turns.ts).
export const TEETH = "the walls have teeth";
// Grey Tide Rising: "its bite forces a CON save against a weakening bite
// (disadvantage on STR checks 1 minute)".
export const WEAKENED = "weakening bite";

export const GENRE_CC_A_CONDITIONS: ConditionEffectRow[] = [
  { id: "distracted_by_rats", match: [RAT_DISTRACTED], summary: "Rat Tide: disadvantage on its next attack roll.", attackDisadvantage: true, consumedBy: "attack" },
  { id: "swarmed", match: [SWARMED], summary: "The Crown Descends: swarmed by rats, half speed, no reactions, and 1d6 piercing at the start of each of its turns.", speedMultiplier: 0.5, noReactions: true },
  { id: "the_walls_have_teeth", match: [TEETH], summary: "The Walls Have Teeth: within 10 feet of the vermin lord's swarm, it cannot take reactions.", noReactions: true },
  { id: "weakening_bite", match: [WEAKENED], summary: "Grey Tide Rising: a weakening bite, disadvantage on Strength checks for a minute.", disadvantageOn: [{ kind: "check", ability: "str" }] },
  { id: "sanctioned_execution", match: [SANCTIONED], summary: "Sanctioned Execution: for 24 hours the creature cannot regenerate and cannot be revived." },
];
