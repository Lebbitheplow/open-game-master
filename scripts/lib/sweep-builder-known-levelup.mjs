// The level-up sweep's known gaps and skips (scripts/lib/sweep-builder-rows.mjs).
// Written from a SWEEP_DISCOVER=1 run of each suite; a row is listed under the
// one cause its assertion names.

const CAT = {
  rule: "\"Fill what's left\" ends in a character the builder's own save check passes (scripts/test-quick-build.mjs).",
  where: "src/app/characters/builder/quickBuild.ts fillFeatPicks",
  severity: "medium",
  note: "The level 20 twin is made by the fill, which leaves College of the Cat's any-kind weapon pick unmade (test-enforce-sweep-builder-fill-subclasses-b.mjs).",
};

export const KNOWN_LEVELUP_A = [
];
export const KNOWN_LEVELUP_B = [
];
export const KNOWN_LEVELUP_C = [
];
export const KNOWN_LEVELUP_D = [
  { id: "levelup-d-fill-any-weapon-pick-twin", ...CAT, rows: ["levelup:bard/College of the Cat"] },
];
export const KNOWN_LEVELUP_NOPACK_A = [
];
export const KNOWN_LEVELUP_NOPACK_B = [
];
export const KNOWN_LEVELUP_NOPACK_C = [
];

// The spell step's offer against the server's lists
// (test-enforce-sweep-builder-spell-offer.mjs).
export const KNOWN_SPELL_OFFER = [];
export const KNOWN_SPELL_OFFER_NOPACK = [];
