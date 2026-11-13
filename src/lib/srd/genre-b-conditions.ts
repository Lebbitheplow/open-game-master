// What the conditions the mystery, post-apocalyptic and steampunk classes'
// spends lay actually do (src/lib/srd/authored-effects-genre-b.ts), as rows of
// the condition registry (src/lib/srd/condition-effects.ts CONDITION_EFFECTS),
// so every engine that reads a condition reads these: the AC derivation, the
// roll resolver, the damage path, the turn budget.
//
// Pure data, as the registry's other tables.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

const EVERY_TYPE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

// Alpha's Roar's mark: the creature never walks nearer its source.
export const COWERING = "cowering";

export const GENRE_B_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    // Philosopher's Draught: "grant 1 hour of poison immunity".
    id: "philosophers_draught",
    match: ["philosopher's draught"],
    summary: "Philosopher's Draught: immune to poison damage and the poisoned condition for an hour.",
    conditionImmunities: ["poisoned"],
    damageImmunities: ["poison"],
  },
  {
    // Spirit Ward: "a shielding spirit grants you or an ally +2 AC until your next turn".
    id: "spirit_ward",
    match: ["spirit ward"],
    summary: "Spirit Ward: +2 AC until the spirit medium's next turn.",
    acBonus: 2,
  },
  {
    // The Game Afoot: "advantage on the next check made in pursuit of a suspect".
    id: "the_game_afoot",
    match: ["the game afoot"],
    summary: "The Game Afoot: advantage on the next ability check (one made in pursuit of the suspect).",
    advantageOn: [{ kind: "check" }],
    consumedBy: "check",
  },
  {
    // Dream Logic: "impose disadvantage on a creature's attack or check".
    id: "dream_logic",
    match: ["dream logic"],
    summary: "Dream Logic: disadvantage on its next attack roll or ability check.",
    attackDisadvantage: true,
    disadvantageOn: [{ kind: "check" }],
    consumedBy: "attack",
  },
  {
    // Shared Fury: "+2 to damage rolls for 1 minute".
    id: "shared_fury",
    match: ["shared fury"],
    summary: "Shared Fury: +2 on weapon damage rolls for a minute.",
    onHitDice: { dice: "2", type: "" },
    weaponOnly: true,
  },
  {
    // Salvaged Shield Node: "allies inside gain +2 AC and resistance to ranged weapon damage".
    id: "salvaged_shield_node",
    match: ["salvaged shield node", "shield node"],
    summary: "Salvaged Shield Node: +2 AC inside the dome for a minute; ranged weapon damage is resisted (the GM rules which blows came from outside it).",
    acBonus: 2,
  },
  {
    // Elixir of Mastery: "drinker gains advantage on everything for 1 minute".
    id: "elixir_of_mastery",
    match: ["elixir of mastery"],
    summary: "Elixir of Mastery: advantage on attack rolls, ability checks and saving throws for a minute.",
    attackAdvantage: true,
    advantageOn: [{ kind: "save" }, { kind: "check" }],
  },
  {
    // Unbreakable Vanguard: "you and adjacent allies have resistance to all damage".
    id: "unbreakable_vanguard",
    match: ["unbreakable vanguard"],
    summary: "Unbreakable Vanguard: resistance to all damage for a minute.",
    resistances: EVERY_TYPE,
  },
  {
    // Tempest Shell: "+2 AC and melee attackers take 2d8 lightning" (the
    // lightning is the holder's own retaliate, authored-effects-genre-b.ts).
    id: "tempest_shell",
    match: ["tempest shell"],
    summary: "Tempest Shell: +2 AC for a minute, and a creature that hits the holder in melee takes 2d8 lightning.",
    acBonus: 2,
  },
  {
    // Full Throttle: "double your speed and gain an extra action each turn for 1 minute".
    id: "full_throttle",
    match: ["full throttle"],
    summary: "Full Throttle: doubled speed and one extra action each turn for a minute; 3d10 fire when it ends.",
    speedMultiplier: 2,
    extraAction: true,
  },
  {
    // Hardened: "reduce all damage you take this round by your CON modifier"
    // (the cut is src/lib/srd/genre-b-combat.ts genreDamageCut's, read by pc-damage.ts).
    id: "hardened",
    match: ["hardened"],
    summary: "Hardened: every blow this round is cut by the road warrior's Constitution modifier (twice it from 10th level).",
  },
  // The slotless casts' marks (src/lib/dm/genre-b-free-cast.ts MARKS): the
  // cast guard reads them; a one-cast mark is spent by the cast it pays for.
  ...([
    ["slotless_cast_1st", "slotless cast (1st)", "one spell of 1st level cast with no slot"],
    ["slotless_cast_3rd", "slotless cast (3rd)", "one spell of 3rd level or lower cast with no slot"],
    ["slotless_cast_5th", "slotless cast (5th)", "one spell of 5th level or lower cast with no slot"],
    ["slotless_cast_6th", "slotless cast (6th)", "one spell of 6th level or lower cast with no slot"],
    ["slotless_cast_7th", "slotless cast (7th)", "one spell of 7th level or lower cast with no slot"],
    ["chosen_cast_3rd", "chosen cast (3rd)", "the chosen 3rd-level spell cast with no slot"],
    ["chosen_cast_5th", "chosen cast (5th)", "the chosen 5th-level spell cast with no slot"],
    ["slotless_minute_3rd", "slotless minute (3rd)", "for a minute, spells of 3rd level or lower cost no slot"],
    ["slotless_minute_4th", "slotless minute (4th)", "for a minute, spells of 4th level or lower cost no slot"],
  ] as const).map(([id, name, what]) => ({ id, match: [name], summary: `${name}: ${what}.` })),
  // Etching Acid: "Your acid damage reduces a hit target's AC by 1 until your
  // next turn (not cumulative)"; Universal Solvent: "Etching Acid stacks to -3
  // AC" (src/lib/dm/genre-b-spell-hits.ts lays one depth at a time).
  { id: "etched", match: ["etched"], summary: "Etched: -1 AC until the alchemist's next turn.", acBonus: -1 },
  { id: "etched_twice", match: ["etched twice"], summary: "Etched twice: -2 AC until the alchemist's next turn.", acBonus: -2 },
  { id: "etched_thrice", match: ["etched thrice"], summary: "Etched thrice: -3 AC until the alchemist's next turn.", acBonus: -3 },
  // The marks a counter lays on its caster, each spent by the next damaging
  // spell (genre-b-spell-hits.ts): Overcharge's maximum dice, the Catalyst
  // Stone's die, Chain Arc's jump.
  { id: "overcharge", match: ["overcharge"], summary: "Overcharge: the next damaging spell rolls its dice at their maximum, and its caster takes 1d10 lightning backlash." },
  { id: "catalyst_stone", match: ["catalyst stone"], summary: "Catalyst Stone: the next spell's damage or healing gains +1d4 (+1d8 with Improved Catalyst)." },
  // Baptism of Ash: "it also gains +1 to attack rolls until your next turn".
  { id: "baptism_of_ash", match: ["baptism of ash"], summary: "Baptism of Ash: +1 to attack rolls until the preacher's next turn.", attackDie: "1" },
  // Alpha's Roar: "cower (no move toward you)" (the walk: enemy-approach.ts).
  { id: "cowering", match: ["cowering"], summary: "Cowering: it never moves toward the packmaster whose roar it failed against." },
  // Fumes and Vapors: "save (CON) or retch, losing their action".
  { id: "retching", match: ["retching"], summary: "Retching: it loses its action while the fumes last.", noAction: true },
  // Arc Coil: "the target cannot take reactions until its next turn".
  { id: "arc_shocked", match: ["arc shocked"], summary: "Arc shocked: no reactions until its next turn.", noReactions: true },
  { id: "chain_arc", match: ["chain arc"], summary: "Chain Arc: the next lightning spell that strikes one creature jumps to a second within 15 ft for half." },
  {
    // The Next Step: "your mutations of 3rd level or lower cost no slots and
    // your Adaptive Hide grants +2 more AC", for a minute.
    id: "the_next_step",
    match: ["the next step"],
    summary: "The Next Step: for a minute, spells of 3rd level or lower cost no slot, and Adaptive Hide grants +2 more AC.",
    acBonus: 2,
  },
];
