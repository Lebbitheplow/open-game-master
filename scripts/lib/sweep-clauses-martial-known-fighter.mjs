// The fighter clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-fighter.mjs). Each runs through
// gap(): the day the engine holds one, the suite fails until its entry goes
// and its clause in scripts/clauses/martial.json reads `held`.
const ROWS_B = "src/lib/srd/authored-effects-data-b.ts";
const ROWS_4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "arcane-shot-once-per-turn": {
    severity: "medium", kind: "rule-wrong",
    where: "src/lib/srd/authored-resources.json sub_arcane_shot (a plain counter: no oncePerTurn, no attack it rides)",
    note: "Both uses go in one turn, with no arrow fired.",
    fix: "Make Arcane Shot a pc_attack option (as maneuvers are) that claims a once-a-turn key.",
    files: ["src/lib/srd/authored-resources.json", "src/lib/dm/pc-attack-riders.ts"],
  },
  "arcane-shot-options": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/options.ts GRANTS and src/lib/srd/options.json (no option kind for Arcane Shot; maneuvers, runes and disciplines have one)",
    note: "Nothing lets a player choose the two options known or learn another at 7th, 10th, 15th and 18th level, so no engine can tell Banishing from Bursting.",
    fix: "Add an arcane_shot option kind opened by Arcane Shot with steps 3:2, 7:3, 10:4, 15:5, 18:6 and the eight options' rows.",
    files: ["src/lib/srd/options.ts", "src/lib/srd/options.json"],
  },

  "rune-carver-runes-do-nothing": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/options.json (the six runes are text only); nothing under src/lib/dm or src/lib/srd reads \"Rune: ...\" features",
    note: "A knight carrying the Stone and Hill runes has no advantage on Insight, none on saves against poison, no poison resistance, and no way to invoke either. Master of Runes' second invocation has nothing to count.",
    fix: "Rows for the six runes: passive effects (check_adv, save_adv, resist, darkvision) and an invoke spend each with a per-rest counter (two uses with Master of Runes).",
    files: ["src/lib/srd/options.json", "src/lib/srd/authored-effects-data-b.ts", "src/lib/srd/authored-resources.json"],
  },
  "royal-envoy-already-proficient": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/srd/subclass-training.ts (Royal Envoy: fixedSkills persuasion, fixedExpertise persuasion, no other list)",
    note: "A fighter already proficient in Persuasion gains no pick of Animal Handling, Insight, Intimidation or Performance.",
    fix: "A skill pick from the four when Persuasion is already held, as a held language becomes a pick of another.",
    files: ["src/lib/srd/subclass-training.ts"],
  },

};

export const SKIP = {
  "born-to-the-saddle-fall": "a hero's fall has no door of its own to call: falling damage to a character is the GM's apply_damage and set_condition prone, so there is nothing to run that could stand them up",
  "bulwark-indomitable-ally": "Bulwark answers an Indomitable reroll of a failed Intelligence, Wisdom or Charisma save forced on two characters by one effect; staging the shared failed save needs a creature's spell cast at both, which scripts/test-authored-spend-cards.mjs covers only for the card",
};
