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
export const KNOWN_MULTICLASS = [];
export const SKIP_MULTICLASS = {};
