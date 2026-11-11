// The barbarian clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-barbarian.mjs).
const ROWS = "src/lib/srd/authored-effects-data.ts";
const ROWS_4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "wild-surge-rolls-nothing": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS} barbarian::Wild Surge (narrated: "The d8 table's effect is rolled and narrated by the GM; its damage goes through aoe_damage and apply_damage, its AC through set_effect."); src/lib/dm/feature-spends.ts (Rage)`,
    note: "Rage for a Wild Magic barbarian rolls no d8 and says nothing of the table; Controlled Surge's second d8 has nothing to ride. Wild Magic Surge, the sorcerer's table, has a spend (gm: true).",
    fix: "Roll the d8 with the Rage spend and apply the eight rows (damage, temporary hit points, AC, teleport credit) from a table.",
    files: [ROWS, "src/lib/dm/feature-spends.ts"],
  },
  "unstable-backlash-rerolls-nothing": {
    severity: "low", kind: "rule-missing",
    where: `${ROWS} barbarian::Unstable Backlash (narrated: "Rerolls the Wild Surge table, whose effects are narrated; use_reaction spends the reaction from the sheet's feature.")`,
    note: "The reaction is spent and no die is rolled.",
    fix: "Follows Wild Surge's table.",
    files: [ROWS],
  },
};

export const SKIP = {
  "totem-spirit-tiger-jump": "the jump helpers take a Strength score alone (src/lib/srd/jump.ts longJumpFeet(strength, runningStart)): there is no sheet to hand them, so a run cannot show the Tiger's 10 feet missing; read from the signature",
  "aspect-of-the-beast-elk-travel": "the travel tool walks a prepared route's legs with the weather rolled; a doubled pace could only be read off a staged journey, which this suite does not build",
};
