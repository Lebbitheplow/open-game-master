// The workshop sweep's known gaps and skips (scripts/lib/sweep-builder-rows.mjs).

// add_companion reads its class as an id. A workshop class's id is an opaque
// key ("homebrew-" and a UUID) no screen shows; by the name the table calls
// it, the tool answers "Unknown class".
const COMPANION_CLASS_BY_NAME = {
  rule:
    "The console's field is free text (src/lib/dm/catalog-party.ts add_companion: { name: \"class\", label: \"Class\", kind: \"text\" }), and PR #839: \"The GM could not recruit a companion of the table's own workshop class ... though the builder offers that class to players in any setting.\" A class the table can recruit must be recruitable by what the table calls it.",
  where: "src/lib/dm/companion-tools.ts (the class lookup of add_companion: by id only)",
  severity: "low",
  note: "class: \"homebrew-<uuid>\" builds the companion; class: \"Spellblade\" answers Unknown class \"Spellblade\". Use a class id from this world's catalog (e.g. fighter, cleric, rogue, wizard).",
};

export const KNOWN_WORKSHOP = [{ id: "companion-class-by-name", ...COMPANION_CLASS_BY_NAME, rows: ["workshop:tool:add_companion-by-name"] }];
export const SKIP_WORKSHOP = {};
export const KNOWN_WORKSHOP_NOPACK = [{ id: "nopack-companion-class-by-name", ...COMPANION_CLASS_BY_NAME, rows: ["nopack-workshop:tool:add_companion-by-name"] }];
export const SKIP_WORKSHOP_NOPACK = {};

// The multiclass sweep (test-enforce-sweep-builder-multiclass.mjs).
export const KNOWN_MULTICLASS = [
  {
    id: "multiclass-second-fighting-style-not-offered",
    rule:
      "SRD 5.1, Paladin, Fighting Style: \"At 2nd level, you adopt a style of fighting as your specialty.\" (Ranger: the same at 2nd level.) The level-up's offer lists it for a single-class paladin reaching 2nd level; a fighter who reaches paladin 2 is owed the same pick.",
    where: "src/lib/srd/level-up-options.ts levelUpOptions (styleSlots = fightingStyleSlots(featuresAfter): the fighter's and the paladin's features are both named \"Fighting Style\" and the sheet keeps one, so the count stays 1 while owed-choices counts a slot for each class)",
    severity: "low",
    note: "The offer at paladin 2 and at every level after lists no Fighting Style; owedFromEarlierLevels then says \"a fighting style\" and the pick can only be made from the sheet's Choices owed. Two readers of one slot count disagree, the shape PR #837 fixed for the dragon ancestor. The pick is not lost: owed-choices.ts sends it to the sheet (\"made on the character sheet, since a level-up may never offer them\").",
    rows: ["multiclass:fighter+paladin/Oath of Devotion", "multiclass:fighter+ranger/Hunter"],
  },
  {
    id: "multiclass-offer-lists-unmet-prerequisites",
    rule:
      "odm_level_up_options (src/lib/agents/workbench.ts): \"under choices every pick it opens with the exact names to send back\". SRD 5.1, Warlock, Eldritch Invocations: \"If an eldritch invocation has prerequisites, you must meet them to learn it.\"",
    where: "src/lib/srd/level-up-options.ts levelUpOptions (featurePicks are not filtered by optionReqProblem)",
    severity: "low",
    note: "The same gap the single-class walk holds (scripts/lib/sweep-builder-known-levelup.mjs PREREQ).",
    rows: ["multiclass-offer:fighter+monk/Way of the Four Elements", "multiclass-offer:fighter+warlock/The Fiend"],
  },
];
export const SKIP_MULTICLASS = {};
