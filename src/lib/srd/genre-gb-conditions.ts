// What the conditions the cc1113 genre-b pass's spends lay do, as rows of the
// condition registry (src/lib/srd/condition-effects.ts CONDITION_EFFECTS),
// kept apart from the earlier passes' tables for the reason
// authored-effects-genre-gb.ts is.
//
// Pure data, as the registry's other tables.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Last Ride of the Reaver (road warrior 15): "for 1 minute your speed
// doubles, Ram Speed deals +4d6, and you resist all damage". The speed is
// this row's; the dice and the resistance are the feature's authored effects,
// gated on the condition (authored-effects-genre-gb.ts).
export const LAST_RIDE = "last ride of the reaver";

// Splintered Form (aberrant 10): "split into a swarm shape until your next
// turn ... moving through gaps freely": the board walks its holder as a Tiny
// creature (src/lib/battlemap/passage.ts pcMoveTraits).
export const SWARM_SHAPE = "swarm shape";

// The gadgeteer's gadgets (authored-effects-genre-gb.ts): what each one's use
// lays on its holder.
export const GRAPNEL = "grapnel line";
export const EAR_TRUMPET = "ear trumpet";
export const SKELETON_KEY = "skeleton key";
export const POCKET_SHIELD = "pocket shield";
export const ARC_LAMP = "arc lamp";

export const GENRE_GB_CONDITION_EFFECTS: ConditionEffectRow[] = [
  { id: "grapnel_line", match: [GRAPNEL], summary: "Grapnel (gadget): for a round, climbing costs its holder no extra movement." },
  { id: "ear_trumpet", match: [EAR_TRUMPET], summary: "Ear trumpet (gadget): advantage on Perception checks for a minute." },
  { id: "skeleton_key", match: [SKELETON_KEY], summary: "Skeleton key (gadget): advantage on Dexterity checks for a round." },
  { id: "pocket_shield", match: [POCKET_SHIELD], summary: "Pocket shield (gadget): +2 AC until the start of its holder's next turn." },
  { id: "arc_lamp", match: [ARC_LAMP], summary: "Arc lamp (gadget): its holder sheds bright light for 30 feet and dim light for 30 more." },
  { id: "swarm_shape", match: [SWARM_SHAPE], summary: "Swarm shape (Splintered Form): until its holder's next turn it moves as a Tiny swarm, through the space of any creature two sizes larger." },
  { id: "last_ride_of_the_reaver", match: [LAST_RIDE], speedMultiplier: 2, summary: "Last Ride of the Reaver: speed doubled, Ram Speed deals 4d6 more, resistance to all damage, for 1 minute." },
];
