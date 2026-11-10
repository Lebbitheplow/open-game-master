// The monk clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-monk.mjs).
const ROWS2 = "src/lib/srd/authored-effects-data2.ts";
const ROWS4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "cloak-of-shadows": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS4} monk::Cloak of Shadows (narrated: "Invisibility in dim light or darkness until the monk attacks, casts or steps into light: set_condition invisible, which the GM ends.")`,
    note: "There is no door: use_resource \"Cloak of Shadows\" is refused (the monk's only counter is ki), and nothing ends a hand-set invisible when the monk attacks or casts.",
    fix: "A spend (action) that sets invisible with an end-on-attack-or-cast meta, gated on the monk's square being dim or dark.",
    files: [ROWS4, "src/lib/srd/authored-conditions.ts"],
  },
  "drunken-technique-movement": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS4} monk::Drunken Technique (narrated: "Flurry of Blows also gives Disengage and 10 feet of movement: the GM moves the monk without opportunity attacks this turn.")`,
    note: "A 17th-level Drunken Master walks 55 feet and no farther after Flurry of Blows; the move route refuses 65.",
    fix: "Flurry of Blows by a holder adds 10 feet to the turn's movement budget (src/lib/battlemap/view.ts pcMoveBudget).",
    files: [ROWS4, "src/lib/battlemap/view.ts"],
  },
  "drunken-technique-disengage": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS4} monk::Drunken Technique (narrated)`,
    note: "Walking away after Flurry of Blows draws the creature's opportunity attack.",
    fix: "Flurry of Blows by a holder sets the turn's disengaged flag, as the Disengage action does.",
    files: [ROWS4, "src/lib/dm/pc-attack.ts"],
  },
  "intoxicated-frenzy-different-creatures": {
    severity: "low", kind: "rule-wrong",
    where: `${ROWS2} monk::Intoxicated Frenzy (fx flurry, note: "Each extra strike is meant for a different creature; the GM keeps to that.")`,
    note: "Five Flurry of Blows strikes at one creature are all taken.",
    fix: "Refuse a third or later flurry strike at a creature an earlier strike of the same flurry targeted.",
    files: [ROWS2, "src/lib/dm/pc-attack-options.ts"],
  },
  "agile-parry-needs-an-unarmed-strike": {
    severity: "low", kind: "rule-wrong",
    where: `${ROWS2} monk::Path of the Kensei (spend Agile Parry, action none, buff with no precondition)`,
    note: "Agile Parry is taken with no unarmed strike made: \"Hero 1 is agile parry for 1 rounds.\"",
    fix: "Gate the spend on an unarmed strike made this turn as part of the Attack action, and a kensei melee weapon held.",
    files: [ROWS2],
  },
  "one-with-the-blade-deft-strike": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS2} (no entry for monk::One with the Blade)`,
    note: "use_resource \"One with the Blade\" is refused (\"No resource called ... Their resources: ki\"): the 1-ki Deft Strike has no door.",
    fix: "A spend: 1 ki, once per turn, after a kensei weapon hit, adds one martial arts die of the weapon's damage.",
    files: [ROWS2, "src/lib/srd/feature-effects.ts"],
  },
  "mastery-of-death": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS4} monk::Mastery of Death (narrated: "Spending 1 ki to drop to 1 hit point instead of 0: the GM heals the monk to 1 and spends the ki with use_resource.")`,
    note: "The monk drops to 0, unconscious and prone, with ki left; use_resource \"Mastery of Death\" is refused.",
    fix: "At 0 hit points with 1 ki left, spend it and set 1 hit point (src/lib/dm/vitals-logic.ts), as Relentless Endurance does.",
    files: ["src/lib/dm/vitals-logic.ts", ROWS4],
  },
  "hand-of-healing-5-feet": {
    severity: "low", kind: "rule-wrong",
    where: `${ROWS4} monk::Hand of Healing (spend with no range)`,
    note: "An ally 20 feet away is healed by touch.",
    fix: "rangeFt: 5 on the spend.",
    files: [ROWS4],
  },
  "hand-of-ultimate-mercy-revives": {
    severity: "high", kind: "rule-wrong",
    where: "src/lib/srd/authored-resources.json sub_wholeness_of_body_mercy (fx heal_target) and the heal_target path in src/lib/dm/feature-spends.ts (a dead target is refused)",
    note: "\"Hero 5 is DEAD; Hand of Ultimate Mercy cannot help.\": the feature that exists to bring the dead back refuses the dead.",
    fix: "A revive fx: a target dead no more than 24 hours returns with 4d10 + Wisdom hit points and its death saves cleared.",
    files: ["src/lib/srd/authored-resources.json", "src/lib/dm/feature-spends.ts"],
  },
  "arms-of-the-astral-self-reach": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS2} monk::Arms of the Astral Self (a buff with no reach effect); src/lib/dm/pc-attack-profile.ts authoredReachBonus`,
    note: "With the arms summoned a creature 10 feet away is \"out of melee reach (5 ft)\".",
    fix: "A reach effect of 1 tile on unarmed strikes, gated on the arms' condition.",
    files: [ROWS2, "src/lib/dm/pc-attack-profile.ts"],
  },
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
  "aspect-of-the-wyrm-frighten": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/authored-resources.json sub_aspect_of_the_wyrm (fx buff on the monk only: \"resolve via cast_at_enemy\")",
    note: "No creature in the aura is frightened at any point, its turn begun there with every die a 1.",
    fix: "An aura condition read at the start of an enemy's turn within 10 feet: WIS save against the ki DC or frightened.",
    files: ["src/lib/srd/authored-resources.json", "src/lib/srd/authored-conditions.ts"],
  },
};

export const SKIP = {};
