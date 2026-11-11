// The conditions the lineage traits lay (src/lib/dm/mt-species-spends.ts,
// src/lib/srd/authored-resources.json), as rows of the condition table
// (registered in src/lib/srd/authored-conditions.ts), with the names every
// reader of them shares.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

export const SHELL_DEFENSE = "shell defense";
export const SHAPECHANGED = "shapechanged";
export const FELINE_AGILITY = "feline agility";
export const FELINE_AGILITY_COUNTER = "race_feline_agility";
// Celestial Revelation's three forms, as the counter's spend names them.
export const WINGS = "celestial revelation: heavenly wings";
export const RADIANCE = "celestial revelation: inner radiance";
export const SHROUD = "celestial revelation: necrotic shroud";

export const MT_SPECIES_CONDITIONS: ConditionEffectRow[] = [
  // Tortle: "Shell Defense (withdraw for +4 AC and save advantage, at the
  // cost of movement and actions)". The saves are Strength and Constitution,
  // Dexterity saves are at disadvantage, and the tortle is prone besides.
  {
    id: "shell_defense",
    match: [SHELL_DEFENSE],
    summary:
      "Shell Defense: withdrawn into the shell. +4 AC, advantage on Strength and Constitution saves, disadvantage on Dexterity saves; prone, speed 0, no reactions, and no action but a bonus action to emerge.",
    acBonus: 4,
    advantageOn: [{ kind: "save", ability: "str" }, { kind: "save", ability: "con" }],
    disadvantageOn: [{ kind: "save", ability: "dex" }],
    speedSet: 0,
    noMove: true,
    noReactions: true,
    noAction: true,
  },
  // Tabaxi: "Feline Agility (double your speed for a turn, refreshed by not
  // moving)".
  {
    id: "feline_agility",
    match: [FELINE_AGILITY],
    summary: "Feline Agility: speed doubled until the end of this turn.",
    speedMultiplier: 2,
  },
  {
    id: "shapechanged",
    match: [SHAPECHANGED],
    summary: "Shapechanger: wearing an altered appearance and voice (never size, gear or numbers) until they change again or revert, which costs nothing.",
  },
];
