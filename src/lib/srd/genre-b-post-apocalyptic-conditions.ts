// What the conditions the post-apocalyptic classes' spends lay actually do
// (src/lib/srd/authored-effects-genre-b-post-apocalyptic.ts), as rows of the
// condition registry (src/lib/srd/condition-effects.ts CONDITION_EFFECTS), the
// way src/lib/srd/genre-b-conditions.ts holds the first passes'. A new
// post-apocalyptic condition is a row here.
//
// Pure data, as the registry's other tables.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Shared Fury's row is src/lib/srd/genre-b-conditions.ts's; the packmaster's
// beast carries it too (src/lib/dm/genre-b-post-apocalyptic-beast.ts).
export const SHARED_FURY = "shared fury";
export const LEGEND_OF_THE_PACK = "legend of the pack";
// Flock's Shepherd's mark on the ally it shelters, and Testify's on those who
// heard the sermon (src/lib/dm/genre-b-post-apocalyptic-spends.ts).
export const SHEPHERDED = "shepherded";
export const TESTIFIED = "testified";

export const GENRE_B_PA_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    // Legend of the Pack: "your beast grows monstrous for 1 minute: double HP,
    // +10 ft speed, attacks deal +2d8 and frighten (WIS save)". The hit points
    // are doubled by the spend and the fear is laid as its attack lands.
    id: "legend_of_the_pack",
    match: [LEGEND_OF_THE_PACK],
    summary: "Legend of the Pack: grown monstrous for a minute, with doubled hit points, +10 ft speed and +2d8 on its attacks; a creature it hits saves (WIS) or is frightened of it.",
    onHitDice: { dice: "2d8", type: "" },
    speedBonus: 10,
  },
];
