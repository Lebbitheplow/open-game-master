// The barbarian clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-barbarian.mjs).
const ROWS = "src/lib/srd/authored-effects-data.ts";
const ROWS_4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "aspect-of-the-beast-bear-carrying": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/dm/load-rules.ts liftLimits and src/lib/srd/encumbrance.ts encumbranceFor (capacity from Strength and size alone)",
    note: "The row's note names Eagle, Elk, Wolf and Tiger; the Bear's doubled carrying capacity is named nowhere.",
    fix: "Double the carry multiplier for a holder of Aspect of the Beast (Bear).",
    files: ["src/lib/dm/load-rules.ts", "src/lib/srd/encumbrance.ts"],
  },
  "aspect-of-the-beast-tiger-skills": {
    severity: "medium", kind: "rule-missing",
    where: `src/lib/srd/subclass-training.ts (no grant for Aspect of the Beast); ${ROWS} barbarian::Aspect of the Beast note: "Tiger's two skills are picked with the subclass's training (subclass-training.ts)."`,
    note: "The note points at a pick that does not exist: subclassGrants returns nothing for the feature, chosen or not, so the Tiger gives no proficiency.",
    fix: "A training grant for Aspect of the Beast (Tiger): two skills from Athletics, Acrobatics, Stealth and Survival.",
    files: ["src/lib/srd/subclass-training.ts"],
  },
  "bolstering-magic-d3": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/authored-resources.json sub_bolstering_magic (no fx: the spend returns the text)",
    note: "The touched ally's next attack roll carries no d3.",
    fix: "A variant pick: a 10-minute condition adding 1d3 to attack rolls and ability checks, or a d3-level slot back for a caster once per long rest.",
    files: ["src/lib/srd/authored-resources.json"],
  },
  "form-of-the-beast-one-weapon": {
    severity: "low", kind: "rule-wrong",
    where: `${ROWS} barbarian::Form of the Beast (three natural_weapon effects, all open while raging; note: "keeping to one form per rage are the GM's to hold")`,
    note: "In one rage the barbarian claws, then bites: the bite's healing and the claws' extra attack are both theirs every turn.",
    fix: "A choice on entering the rage (the choose spend) that the three effects gate on.",
    files: [ROWS],
  },
  "form-of-the-beast-tail-reaction": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS} barbarian::Form of the Beast (no reaction row; note: "The tail's reaction (1d8 to AC against one attack) ... are the GM's to hold")`,
    note: "use_reaction \"Form of the Beast\" is taken as free text (\"resolved from its own text\"): the reaction is spent and the hit stands.",
    fix: "A reaction row { kind: \"ac_vs_hit\" } with a d8, gated on raging, within 10 feet.",
    files: [ROWS, "src/lib/srd/authored-effects-types.ts"],
  },
  "bestial-soul-adapt": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/srd/feature-effects.ts (bestial soul holds magical_attacks only); no choose spend, no move effect",
    note: "Nothing lets the barbarian take the swim, climb or jump option after a rest.",
    fix: "A choose spend (Swim, Climb, Jump) with move effects.",
    files: [ROWS],
  },
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
