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
// A shifter's form, by the subtype picked in the builder (Shifting:
// src/lib/dm/mt-species-spends.ts).
export const SHIFTED = "shifted";
export const SHIFT_FORMS = [
  { subtype: "Beasthide", condition: "shifted (beasthide)", extraTempHp: "1d6" },
  { subtype: "Longtooth", condition: "shifted (longtooth)" },
  { subtype: "Swiftstride", condition: "shifted (swiftstride)" },
  { subtype: "Wildhunt", condition: "shifted (wildhunt)" },
] as const;
export const WILDHUNT_SHIFT = "shifted (wildhunt)";

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
  // The shifter's subtype forms: "Beasthide (shifted: an extra 1d6 temporary
  // hit points and 1 more AC)", "Swiftstride (shifted: 10 more feet of
  // speed...)", "Wildhunt (shifted: advantage on Wisdom checks...)". The
  // Longtooth's fangs are the bonus attack's (feature-bonus-attacks.ts), the
  // Wildhunt's denial of advantage the attack's (enemy-swing-odds.ts), the
  // Swiftstride's step the reaction's (lineage-reactions.ts).
  {
    id: "shifted_beasthide",
    match: ["shifted (beasthide)"],
    summary: "Shifted (Beasthide): a tougher hide for a minute, +1 AC.",
    acBonus: 1,
  },
  {
    id: "shifted_longtooth",
    match: ["shifted (longtooth)"],
    summary: "Shifted (Longtooth): for a minute the fangs strike as a bonus action, 1d6 piercing.",
  },
  {
    id: "shifted_swiftstride",
    match: ["shifted (swiftstride)"],
    summary: "Shifted (Swiftstride): 10 more feet of speed for a minute, and a 10-foot step as a reaction when a foe ends its turn within 5 feet.",
    speedBonus: 10,
  },
  {
    id: "shifted_wildhunt",
    match: ["shifted (wildhunt)"],
    summary: "Shifted (Wildhunt): for a minute, advantage on Wisdom checks, and no attack roll from within 30 feet has advantage against them while they are not incapacitated.",
    advantageOn: [{ kind: "check", ability: "wis" }],
  },
  {
    id: "shapechanged",
    match: [SHAPECHANGED],
    summary: "Shapechanger: wearing an altered appearance and voice (never size, gear or numbers) until they change again or revert, which costs nothing.",
  },
];
