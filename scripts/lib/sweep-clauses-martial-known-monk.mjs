// The monk clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-monk.mjs).
const ROWS2 = "src/lib/srd/authored-effects-data2.ts";
const ROWS4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "arms-of-the-astral-self-wisdom": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/dm/pc-attack-profile.ts (the unarmed strike's ability: the better of Strength and Dexterity only)",
    note: "Under the arms, a monk with Wisdom 18 and Dexterity 16 strikes at +9 (Dexterity), not +10.",
    fix: "Offer Wisdom for unarmed strikes, and force damage, while the arms' condition holds.",
    files: ["src/lib/dm/pc-attack-profile.ts"],
  },
  "arms-of-the-astral-self-strength-checks": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/srd/index.ts computeSheetDerived / src/lib/dm/roll-tools.ts (Strength checks and saves read Strength only)",
    note: "A Strength check and save under the arms add Strength 8's -1, not Wisdom 18's +4.",
    fix: "An ability_swap effect (str -> wis for checks and saves) gated on the arms.",
    files: ["src/lib/srd/index.ts"],
  },
  "deflect-energy": {
    severity: "low", kind: "rule-wrong",
    where: "src/lib/dm/authored-reactions.ts (case \"reduce\": answers only an attack that hit this turn)",
    note: "Fire damage that came from no attack (a spell's save, a hazard) cannot be deflected: \"answers an attack that hit them this turn, and the server has none on record\".",
    fix: "Let a self reduce row with types answer the last damage taken of those types, whatever dealt it.",
    files: ["src/lib/dm/authored-reactions.ts"],
  },
  "aspect-of-the-wyrm-ward": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/authored-resources.json sub_aspect_of_the_wyrm (fx buff on the monk only)",
    note: "An ally 5 feet from the monk in the ward takes 20 fire damage whole: nothing gives the aura's resistance.",
    fix: "An aura_resist effect on the row, its type the one the monk chose for Draconic Strike (the ward's condition names it).",
    files: ["src/lib/srd/authored-resources.json", "src/lib/srd/authored-effects-w2-mt-mr.ts"],
  },
  "aspect-of-the-wyrm-frighten": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/authored-resources.json sub_aspect_of_the_wyrm (fx buff on the monk only: \"resolve via cast_at_enemy\")",
    note: "No creature in the aura is frightened at any point, its turn begun there with every die a 1.",
    fix: "An aura condition read at the start of an enemy's turn within 10 feet: WIS save against the ki DC or frightened.",
    files: ["src/lib/srd/authored-resources.json", "src/lib/srd/authored-conditions.ts"],
  },
};

export const SKIP = {};
