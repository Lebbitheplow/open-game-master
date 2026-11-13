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
// The conditions whose name carries what they give, in parentheses.
export const RAPID_ADAPTATION = "rapid adaptation";
export const APEX_GENOME = "apex genome";
export const ADAPTED = "adapted";
export const SHIELD_NODE = "salvaged shield node";
export const LAST_RIDE = "last ride of the reaver";
export const DEATH_OR_GLORY = "death or glory";
// The same reckless turn once Ride Eternal is held: it grants enemies nothing.
export const DEATH_OR_GLORY_ETERNAL = "death or glory (ride eternal)";

export const GENRE_B_PA_CONDITION_EFFECTS: ConditionEffectRow[] = [
  // Death or Glory: "attacks against you have advantage until your next turn"
  // (the road warrior's own advantage is pc-attack-options.ts recklessAdvantage).
  {
    id: "death_or_glory",
    match: [DEATH_OR_GLORY],
    summary: "Death or Glory: advantage on melee attacks this turn, and attack rolls against them have advantage until their next turn.",
    attacksAgainstAdvantage: true,
  },
  // Ride Eternal: "Death or Glory no longer grants enemies advantage against you".
  {
    id: "death_or_glory_eternal",
    match: [DEATH_OR_GLORY_ETERNAL],
    summary: "Death or Glory (Ride Eternal): advantage on melee attacks this turn, and it grants enemies nothing.",
  },
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
  // Testify: "advantage on their next save against fear or despair". The
  // advantage is read where a save is rolled against being frightened
  // (src/lib/dm/genre-b-auras.ts genreBSaveAuras), which spends the mark.
  { id: "testified", match: [TESTIFIED], summary: "Testified: advantage on their next save against being frightened, which spends it." },
  {
    // Rapid Adaptation: "after taking elemental damage, gain resistance to
    // that type until you rest" (src/lib/dm/genre-b-post-apocalyptic-blows.ts
    // lays it as the damage lands, the type in the name).
    id: "rapid_adaptation",
    match: [RAPID_ADAPTATION],
    summary: "Rapid Adaptation: resistance to the damage type they adapted to (named in the condition) until a long rest.",
    paramResistance: true,
  },
  {
    // Apex Genome: "Resistance to two damage types of your choice, chosen each dawn".
    id: "apex_genome",
    match: [APEX_GENOME],
    summary: "Apex Genome: resistance to a damage type of their choice (named in the condition) until the next dawn.",
    paramResistance: true,
  },
  // Second Adaptation: "can also grant a climb or swim speed for an hour"
  // (src/lib/srd/genre-b-post-apocalyptic.ts adaptedSpeeds, read by the board's walk).
  { id: "adapted", match: [ADAPTED], summary: "Adapted: a climbing or a swimming speed (named in the condition) for an hour: climbing or water costs no extra movement." },
];
