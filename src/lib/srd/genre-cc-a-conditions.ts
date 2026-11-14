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

// Candle in the Dark: "bright warding light 20 ft for 10 minutes" (its
// warding is the row's attacked_disadv, src/lib/srd/authored-effects-genre-cc-a.ts).
export const CANDLE = "candle in the dark";
// Elegy of Echoes: the repeated dirge's slotless cast, until the turn ends
// (src/lib/dm/genre-b-free-cast.ts MARKS).
export const ELEGY_MARK = "slotless cast (3rd)";
// Grief Made Strength: "your next dirge this minute costs no slot if 2nd
// level or lower".
export const GRIEF_MARK = "slotless cast (2nd)";

// Squire of Bones: the corpse a grave knight raised, so it rises once
// (src/lib/dm/genre-cc-a-squire.ts).
export const RAISED_SQUIRE = "raised as a squire";

export const GENRE_CC_A_CONDITIONS: ConditionEffectRow[] = [
  { id: "neutral_ground", match: ["neutral ground"], summary: "Neutral Ground: it accepted the fixer's parley and cannot attack them until the fixer's next turn." },
  { id: "exit_strategy", match: ["exit strategy"], summary: "Exit Strategy: the fixer may move up to their speed before their first turn, drawing no opportunity attacks." },
  { id: "jury_rigged", match: ["jury-rigged"], summary: "Jury-Rig: +1d4 to checks made with a tool, for an hour." },
  { id: "quarry_slain", match: ["quarry slain"], summary: "No Rest for the Wicked: the branded quarry is dead; the extra full turn may be taken before this turn ends." },
  { id: "slotless_cast_2nd", match: [GRIEF_MARK], summary: "Grief Made Strength: the next dirge of 2nd level or lower this minute costs no slot." },
  { id: "candle_in_the_dark", match: [CANDLE], summary: "Candle in the Dark: bright warding light 20 feet around the witch hunter; hostile undead and fiends in it attack at disadvantage." },
  { id: "distracted_by_rats", match: [RAT_DISTRACTED], summary: "Rat Tide: disadvantage on its next attack roll.", attackDisadvantage: true, consumedBy: "attack" },
  { id: "swarmed", match: [SWARMED], summary: "The Crown Descends: swarmed by rats, half speed, no reactions, and 1d6 piercing at the start of each of its turns.", speedMultiplier: 0.5, noReactions: true },
  { id: "the_walls_have_teeth", match: [TEETH], summary: "The Walls Have Teeth: within 10 feet of the vermin lord's swarm, it cannot take reactions.", noReactions: true },
  { id: "weakening_bite", match: [WEAKENED], summary: "Grey Tide Rising: a weakening bite, disadvantage on Strength checks for a minute.", disadvantageOn: [{ kind: "check", ability: "str" }] },
  { id: "raised_as_a_squire", match: [RAISED_SQUIRE], summary: "Squire of Bones: its bones rose as a grave knight's skeletal squire; it cannot be raised again." },
  { id: "sanctioned_execution", match: [SANCTIONED], summary: "Sanctioned Execution: for 24 hours the creature cannot regenerate and cannot be revived." },
];
