// What the conditions the mystery classes' fifth-pass features lay actually
// do (src/lib/dm/genre-b-mystery-spends.ts), as rows of the condition registry
// beside src/lib/srd/genre-b-conditions.ts's, so every engine that reads a
// condition reads these.
//
// Pure data.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

export const SPIRIT_WARD = "spirit ward";
// Chorus of the Dead: "also grants advantage on their next save".
export const CHORUS = "chorus of the dead";
// Queen of the Quiet Court: the procession about the medium for its minute.
export const QUIET_COURT = "quiet court";
// General Strike: "each gain a reaction attack when any one of you is hit".
export const GENERAL_STRIKE = "general strike";

// Anchor of the Living: the spirit held for a day.
export const SPIRIT_ANCHORED = "spirit anchored";
// Hypnotic Induction: "answers three questions truthfully under trance".
export const TRANCE = "trance";
// A use in a story scene, laid on its holder for the minute (genre-b-mystery-spends.ts rite).
export const TRANCE_RITE = "hypnotic induction";
export const DREAM_RITE = "the unconscious speaks";
export const FERRY_RITE = "ferrywoman's due";
export const STORY_RITE = "the story of the century";

export const GENRE_B_MYSTERY_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "chorus_of_the_dead",
    match: [CHORUS],
    summary: "Chorus of the Dead: advantage on the next saving throw.",
    advantageOn: [{ kind: "save" }],
    consumedBy: "save",
  },
  {
    // "for 1 minute they obscure": the medium walks unseen among the
    // procession, and an attack on a creature its attacker cannot see is made
    // at disadvantage (SRD 5.1, Unseen Attackers and Targets).
    id: "quiet_court",
    match: [QUIET_COURT],
    summary: "Quiet Court: a procession of spirits obscures the medium for a minute (attacks against them are at disadvantage), and Direct the Procession sends it at a creature: WIS save or frightened for a minute and 2d8 necrotic.",
    attacksAgainstDisadvantage: true,
  },
  {
    id: "general_strike",
    match: [GENERAL_STRIKE],
    summary: "General Strike: for a minute, when any striker is hit, each may answer with one weapon attack as a reaction (use_reaction General Strike).",
  },
  { id: "spirit_anchored", match: [SPIRIT_ANCHORED], summary: "Spirit anchored: a spirit medium holds this spirit; for 24 hours a spell that returns the dead finds the creature as if freshly dead." },
  { id: "trance", match: [TRANCE], summary: "Trance: under Hypnotic Induction it answers three questions truthfully." },
  { id: "hypnotic_induction", match: [TRANCE_RITE], summary: "Hypnotic Induction: the creature under trance answers three questions truthfully; an unwilling one makes a WIS save against the alienist's DC to resist." },
  { id: "the_unconscious_speaks", match: [DREAM_RITE], summary: "The Unconscious Speaks: the GM gives the alienist three true impressions from the dreams of the sleeping or unconscious creature they read." },
  { id: "ferrywomans_due", match: [FERRY_RITE], summary: "Ferrywoman's Due: a spirit is laid to rest or a possession released with no contest; a hostile entity makes a CHA save against the medium's DC to resist." },
  { id: "the_story_of_the_century", match: [STORY_RITE], summary: "The Story of the Century: the named creature's public standing collapses; each of its allies makes a WIS save against the muckraker's DC or abandons it." },
];
