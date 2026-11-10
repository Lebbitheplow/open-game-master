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

export const GENRE_B_CONDITION_EFFECTS: ConditionEffectRow[] = [
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
];
