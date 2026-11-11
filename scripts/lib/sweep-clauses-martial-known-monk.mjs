// The monk clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-monk.mjs).
const ROWS2 = "src/lib/srd/authored-effects-data2.ts";
const ROWS4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "deflect-energy": {
    severity: "low", kind: "rule-wrong",
    where: "src/lib/dm/authored-reactions.ts (case \"reduce\": answers only an attack that hit this turn)",
    note: "Fire damage that came from no attack (a spell's save, a hazard) cannot be deflected: \"answers an attack that hit them this turn, and the server has none on record\".",
    fix: "Let a self reduce row with types answer the last damage taken of those types, whatever dealt it.",
    files: ["src/lib/dm/authored-reactions.ts"],
  },
};

export const SKIP = {};
