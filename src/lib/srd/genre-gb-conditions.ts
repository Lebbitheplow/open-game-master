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

// Road Rage (road warrior 14): an ally within 30 feet just dropped; the
// warrior may move and make one attack (src/lib/dm/genre-gb-road-rage.ts).
export const ROAD_RAGE = "road rage";

// The alchemist's and machinist's formula marks (src/lib/dm/genre-gb-alchemy.ts
// says what reads each); the names are that module's.
const ACID_FORMULA = "acid formula";
const CATALYST_REROLL = "catalyst reroll";

export const GENRE_GB_CONDITION_EFFECTS: ConditionEffectRow[] = [
  { id: "broadside", match: ["broadside"], summary: "Broadside: this turn the corsair's Attack action fires once at each of up to three creatures in a 15-foot cone (pc_attack with volley)." },
  { id: "legend_of_the_skies", match: ["legend of the skies"], summary: "Legend of the Skies: the aeronaut has taken this fight's extra turn." },
  { id: "calculated_answer", match: ["calculated answer"], summary: "Difference Engine Mind: the next Intelligence check counts its d20 as a 20." },
  { id: "acid_formula", match: [ACID_FORMULA], summary: "Corrosive Focus: this turn the alchemist's spells deal acid damage in place of their own type." },
  { id: "catalyst_reroll", match: [CATALYST_REROLL], summary: "Stone of the Magnum Opus: the next spell's damage dice are thrown twice and the better total kept." },
  { id: "the_great_work", match: ["the great work"], summary: "The Great Work: the spell just cast with no slot deals its dice at their maximum." },
  { id: "magnum_opus", match: ["magnum opus"], summary: "Magnum Opus: constructs fail their saves against the spell just cast with no slot." },
  { id: "grapnel_line", match: [GRAPNEL], summary: "Grapnel (gadget): for a round, climbing costs its holder no extra movement." },
  { id: "ear_trumpet", match: [EAR_TRUMPET], summary: "Ear trumpet (gadget): advantage on Perception checks for a minute." },
  { id: "skeleton_key", match: [SKELETON_KEY], summary: "Skeleton key (gadget): advantage on Dexterity checks for a round." },
  { id: "pocket_shield", match: [POCKET_SHIELD], summary: "Pocket shield (gadget): +2 AC until the start of its holder's next turn." },
  { id: "arc_lamp", match: [ARC_LAMP], summary: "Arc lamp (gadget): its holder sheds bright light for 30 feet and dim light for 30 more." },
  { id: "road_rage", match: [ROAD_RAGE], summary: "Road Rage: an ally within 30 feet dropped; this round the warrior moves their speed and makes one attack." },
  { id: "swarm_shape", match: [SWARM_SHAPE], summary: "Swarm shape (Splintered Form): until its holder's next turn it moves as a Tiny swarm, through the space of any creature two sizes larger." },
  { id: "last_ride_of_the_reaver", match: [LAST_RIDE], speedMultiplier: 2, summary: "Last Ride of the Reaver: speed doubled, Ram Speed deals 4d6 more, resistance to all damage, for 1 minute." },
];
