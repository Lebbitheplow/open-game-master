// The fighter clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-fighter.mjs). Each runs through
// gap(): the day the engine holds one, the suite fails until its entry goes
// and its clause in scripts/clauses/martial.json reads `held`.
const ROWS_B = "src/lib/srd/authored-effects-data-b.ts";
const ROWS_4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {

  "rune-carver-runes-do-nothing": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/options.json (the six runes are text only); nothing under src/lib/dm or src/lib/srd reads \"Rune: ...\" features",
    note: "A knight carrying the Stone and Hill runes has no advantage on Insight, none on saves against poison, no poison resistance, and no way to invoke either. Master of Runes' second invocation has nothing to count.",
    fix: "Rows for the six runes: passive effects (check_adv, save_adv, resist, darkvision) and an invoke spend each with a per-rest counter (two uses with Master of Runes).",
    files: ["src/lib/srd/options.json", "src/lib/srd/authored-effects-data-b.ts", "src/lib/srd/authored-resources.json"],
  },

};

export const SKIP = {
  "born-to-the-saddle-fall": "a hero's fall has no door of its own to call: falling damage to a character is the GM's apply_damage and set_condition prone, so there is nothing to run that could stand them up",
};
