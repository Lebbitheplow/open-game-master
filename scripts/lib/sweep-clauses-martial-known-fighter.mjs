// The fighter clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-fighter.mjs). Each runs through
// gap(): the day the engine holds one, the suite fails until its entry goes
// and its clause in scripts/clauses/martial.json reads `held`.
const ROWS_B = "src/lib/srd/authored-effects-data-b.ts";
const ROWS_4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "arcane-charge-teleport": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS_4} fighter::Arcane Charge (narrated: "A 30-foot teleport with Action Surge: a move_token the GM makes when the fighter surges."); src/lib/dm/feature-spends.ts (Action Surge credits no teleport)`,
    note: "Shadow Step's row credits its 60 feet (creditFeatureTeleport, src/lib/dm/authored-spend-effects.ts); Action Surge for an Eldritch Knight of 15th level credits none and says nothing of it.",
    fix: "Credit a 30-foot teleport when a holder of Arcane Charge spends Action Surge, as buff rows with teleportFeet do.",
    files: [ROWS_4, "src/lib/dm/feature-spends.ts", "src/lib/dm/authored-spend-effects.ts"],
  },
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
  "arcane-archer-lore-cantrip": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/srd/subclass-training.ts (Arcane Archer Lore trains the skill only) and src/lib/srd/subclasses.json (the subclass has no `spells` table)",
    note: "The skill pick is granted; the cantrip is on no spell table and no pick, so the sheet never holds it.",
    fix: "Give the subclass a cantrip pick (prestidigitation or druidcraft) the way Giant's Power's row does (choose).",
    files: ["src/lib/srd/subclasses.json", "src/lib/srd/authored-effects-data-b.ts"],
  },
  "magic-arrow-arrows-only": {
    severity: "low", kind: "rule-wrong",
    where: "src/lib/srd/feature-effects.ts (the def for \"magic arrow\": magical_attacks, for every attack)",
    note: "A longsword in the archer's hand cuts through resistance to nonmagical weapons too. Bestial Soul (natural weapons) and One with the Blade (kensei weapons) carry the same unscoped effect.",
    paths: "Right: an arrow from a bow. Wrong: every other weapon the archer swings.",
    fix: "Scope magical_attacks to a weapon filter (bows; natural weapons; kensei weapons).",
    files: ["src/lib/srd/feature-effects.ts", "src/lib/dm/pc-attack-damage.ts"],
  },
  "curving-shot-60-feet": {
    severity: "low", kind: "rule-wrong",
    where: "src/lib/dm/feature-bonus-attacks.ts (Curving Shot: a different creature is asked, no distance from the first)",
    note: "The arrow curves to a creature 85 feet from the one it missed.",
    fix: "Refuse a new target more than 60 feet from the creature the arrow missed.",
    files: ["src/lib/dm/feature-bonus-attacks.ts"],
  },
  "born-to-the-saddle-mounting": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/dm/mount-tools.ts spendMountingMovement (half the rider's speed for everyone)",
    note: "A Cavalier pays the same half of their movement as anybody.",
    fix: "Charge one square to a holder of Born to the Saddle.",
    files: ["src/lib/dm/mount-tools.ts"],
  },
  "unwavering-mark-until-end-of-next-turn": {
    severity: "medium", kind: "rule-wrong",
    where: "src/lib/dm/authored-hooks.ts authoredOnHit (the mark's meta is untilTurnOf: it ends as the cavalier's next turn starts)",
    note: "Through the cavalier's own next turn the marked creature attacks others freely. Eldritch Strike's mark, the same shape, carries untilTurnEndOf.",
    paths: "Right: Eldritch Strike (untilTurnEndOf). Wrong: Unwavering Mark (untilTurnOf).",
    fix: "Lay Unwavering Mark with untilTurnEndOf, or re-lay it on each hit and end it a turn later.",
    files: ["src/lib/dm/authored-hooks.ts", ROWS_B],
  },
  "unwavering-mark-within-5-feet": {
    severity: "medium", kind: "rule-wrong",
    where: "src/lib/dm/enemy-swing-odds.ts authoredIncomingAttack (a mark with disadv_others is read without the marker's distance)",
    note: "A marked creature 15 feet from the cavalier still attacks an ally at disadvantage.",
    fix: "Give the mark row a rangeFt and read the marker's token in authoredIncomingAttack.",
    files: ["src/lib/dm/enemy-swing-odds.ts", ROWS_B, "src/lib/srd/authored-effects-types.ts"],
  },
  "ferocious-charger-needs-a-charge": {
    severity: "medium", kind: "timing-window",
    where: `${ROWS_4} fighter::Ferocious Charger (a spend with action "none"; no afterWeaponHit, and no record of the move)`,
    note: "A cavalier who has not moved and has hit nothing knocks a creature prone for free, once every turn.",
    fix: "Set afterWeaponHit on the spend and read the turn's straight-line move (the Charger feat's `charged` on pc_attack is the precedent).",
    files: [ROWS_4, "src/lib/dm/authored-spends.ts"],
  },
  "elegant-courtier-persuasion": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS_B} fighter::Elegant Courtier (its one effect is save_swap; note: "The Persuasion proficiency is applied to the sheet at the pick.")`,
    note: "No Wisdom modifier reaches a Persuasion check, and subclass-training.ts grants this feature nothing either.",
    fix: "A check rider adding the Wisdom modifier to Persuasion (src/lib/dm/roll-feature-riders.ts).",
    files: [ROWS_B, "src/lib/dm/roll-feature-riders.ts"],
  },
  "elegant-courtier-wisdom-save": {
    severity: "medium", kind: "rule-wrong",
    where: `${ROWS_B} fighter::Elegant Courtier ({ kind: "save_swap", save: "wis", use: "cha" }), read by src/lib/srd/index.ts authoredSaveModifier`,
    note: "The row swaps Charisma in for Wisdom on the save. The text grants proficiency: a samurai of 7th level with Wisdom 14 and Charisma 10 rolls +2 where the text gives +5.",
    pinned: "scripts/test-enforce-authored.mjs \"Elegant Courtier: a Wisdom saving throw uses the Charisma modifier when it is the better one.\"",
    fix: "Replace the swap with save_prof (wis; int or cha when wis is already held).",
    files: [ROWS_B, "scripts/test-enforce-authored.mjs"],
  },
  "rapid-strike-same-target": {
    severity: "low", kind: "rule-wrong",
    where: `src/lib/dm/pc-attack-plan.ts rapidStrike (raises attacksAllowed; note in ${ROWS_B}: "The extra attack's target is the same creature; the GM keeps to that.")`,
    note: "After Rapid Strike on one creature all three attacks left go to another.",
    fix: "Keep the creature in the turn budget and refuse the last attack of the turn at another.",
    files: ["src/lib/dm/pc-attack-plan.ts"],
  },

  "legion-of-one-regains-on-initiative": {
    severity: "low", kind: "data",
    where: "src/lib/srd/subclasses.json fighter::Legion of One (the text) against src/lib/srd/resource-refills.ts authoredInitiativeRefills (one back only with none left)",
    note: "The engine follows the published rule (\"if you have no uses left\"); the stored text drops the condition that Relentless, Ever-Ready Shot and Tireless Spirit keep.",
    fix: "Reword the text: \"When you roll initiative with no Unleash Incarnation uses left, you regain one\".",
    files: ["src/lib/srd/subclasses.json"],
  },
  "telekinetic-movement-free-use": {
    severity: "low", kind: "rule-wrong",
    where: "src/lib/dm/option-costs.ts (Telekinetic Movement always spends a Psionic Energy die)",
    note: "The first use after a rest costs a die like every other.",
    fix: "A once-per-short-rest counter the option spends before the pool.",
    files: ["src/lib/dm/option-costs.ts", "src/lib/srd/authored-resources.json"],
  },
  "telekinetic-thrust-save-not-in-text": {
    severity: "low", kind: "data",
    where: "src/lib/srd/subclasses.json fighter::Telekinetic Adept (the text) against the row's Strength save, DC 8 + proficiency + Intelligence",
    note: "The engine rolls the published save; the stored text states none, so the player reads an automatic knock-down.",
    fix: "Add the save to the text.",
    files: ["src/lib/srd/subclasses.json"],
  },
  "guarded-mind-ends-a-condition": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/feature-effects.ts (the def for \"guarded mind\" holds the resistance only); no spend ends charmed or frightened",
    note: "A die is spent under the variant and the fighter stays frightened.",
    fix: "A spend on sub_psionic_energy that ends charmed and frightened on the holder, open at the start of their turn.",
    files: ["src/lib/srd/authored-effects-data-b.ts"],
  },
  "bulwark-of-force-range-not-in-text": {
    severity: "low", kind: "data",
    where: "src/lib/srd/subclasses.json fighter::Bulwark of Force (the text) against the row's rangeFt: 30",
    note: "The engine keeps the published 30 feet; the stored text names no distance.",
    fix: "Add \"within 30 feet\" to the text.",
    files: ["src/lib/srd/subclasses.json"],
  },
  "giants-might-one-roll-a-turn": {
    severity: "medium", kind: "rule-wrong",
    where: "src/lib/srd/condition-effects.ts (\"giant's might\") and src/lib/srd/authored-conditions.ts (\"giant's might (1d8)\", \"(1d10)\"): the damage die is not once a turn",
    note: "Every hit of the turn carries the die: a Rune Knight of 5th level adds 2d6 a turn, of 20th 4d10.",
    fix: "Mark the condition's damage rider oncePerTurn, as Divine Fury's rider is.",
    files: ["src/lib/srd/condition-effects.ts", "src/lib/srd/authored-conditions.ts"],
  },
  "runic-juggernaut-reach": {
    severity: "low", kind: "rule-missing",
    where: `${ROWS_B} fighter::Runic Juggernaut (its row only swaps the die; no reach effect as Giant's Havoc has)`,
    note: "A creature 10 feet away is out of reach under Giant's Might at 18th level.",
    fix: "A reach effect gated on the giant's might (1d10) condition.",
    files: [ROWS_B],
  },
  "rune-carver-runes-do-nothing": {
    severity: "medium", kind: "rule-missing",
    where: "src/lib/srd/options.json (the six runes are text only); nothing under src/lib/dm or src/lib/srd reads \"Rune: ...\" features",
    note: "A knight carrying the Stone and Hill runes has no advantage on Insight, none on saves against poison, no poison resistance, and no way to invoke either. Master of Runes' second invocation has nothing to count.",
    fix: "Rows for the six runes: passive effects (check_adv, save_adv, resist, darkvision) and an invoke spend each with a per-rest counter (two uses with Master of Runes).",
    files: ["src/lib/srd/options.json", "src/lib/srd/authored-effects-data-b.ts", "src/lib/srd/authored-resources.json"],
  },
  "rallying-cry-heals-allies": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS_4} fighter::Rallying Cry (narrated: "heals the GM makes when Second Wind is spent"); src/lib/dm/feature-spends.ts Second Wind`,
    note: "A wounded ally beside the Banneret gains nothing when Second Wind is spent.",
    fix: "Second Wind for a holder of Rallying Cry heals up to three chosen allies within 60 feet for the fighter level (heal_area is the shape).",
    files: [ROWS_4, "src/lib/dm/feature-spends.ts"],
  },
  "royal-envoy-already-proficient": {
    severity: "low", kind: "rule-missing",
    where: "src/lib/srd/subclass-training.ts (Royal Envoy: fixedSkills persuasion, fixedExpertise persuasion, no other list)",
    note: "A fighter already proficient in Persuasion gains no pick of Animal Handling, Insight, Intimidation or Performance.",
    fix: "A skill pick from the four when Persuasion is already held, as a held language becomes a pick of another.",
    files: ["src/lib/srd/subclass-training.ts"],
  },

  "inspiring-surge-one-ally": {
    severity: "medium", kind: "rule-wrong",
    where: "src/lib/dm/authored-reactions.ts (a party reaction is taken by whoever names it; no count per Action Surge)",
    note: "At 10th level two allies each take the attack; the text gives the second only from 18th.",
    fix: "Count the allies who answered this surge on the holder's turn budget (one, two from 18th).",
    files: ["src/lib/dm/authored-reactions.ts"],
  },
  "inspiring-surge-any-weapon": {
    severity: "medium", kind: "rule-wrong",
    where: `${ROWS_B} fighter::Inspiring Surge (rangeFt: 5: "Inspiring Surge is a melee attack")`,
    note: "An ally with a longbow and a foe 30 feet off is refused: the text says one weapon attack.",
    fix: "Let the reaction attack use the ally's weapon range.",
    files: [ROWS_B, "src/lib/dm/authored-reactions.ts"],
  },
};

export const SKIP = {
  "born-to-the-saddle-fall": "a hero's fall has no door of its own to call: falling damage to a character is the GM's apply_damage and set_condition prone, so there is nothing to run that could stand them up",
  "bulwark-indomitable-ally": "Bulwark answers an Indomitable reroll of a failed Intelligence, Wisdom or Charisma save forced on two characters by one effect; staging the shared failed save needs a creature's spell cast at both, which scripts/test-authored-spend-cards.mjs covers only for the card",
};
