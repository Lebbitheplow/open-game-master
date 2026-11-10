// The level-up sweep's known gaps and skips (scripts/lib/sweep-builder-rows.mjs).
// Written from a SWEEP_DISCOVER=1 run of each suite; a row is listed under the
// one cause its assertion names.

// The spell search matches a class by substring, so a paladin is offered the
// six spells the pack files under \"anti paladin\"; the server reads the list
// key whole and refuses them.
const ANTI = {
  rule:
    "src/lib/srd/spell-prep.ts spellOnCasterList: \"The server's check, the level-up, learn_spell, the sheet's prepare and the builder all ask this, so none of them offers what another refuses.\"",
  where: "src/lib/content (searchSpells' class filter, behind /api/content/spells?class=paladin)",
  severity: "medium",
  note: "Borrowing, Delay Passing, Feed the Worms, Risen Road, Strength of the Underworld and Wield Soul are listed for a paladin and refused: \"Borrowing is not on the paladin spell list\". test-enforce-sweep-builder-spell-offer.mjs holds the list itself.",
};

const CAT = {
  rule: "\"Fill what's left\" ends in a character the builder's own save check passes (scripts/test-quick-build.mjs).",
  where: "src/app/characters/builder/quickBuild.ts fillFeatPicks",
  severity: "medium",
  note: "The level 20 twin is made by the fill, which leaves College of the Cat's any-kind weapon pick unmade (test-enforce-sweep-builder-fill-subclasses-b.mjs).",
};

export const KNOWN_LEVELUP_A = [
  { id: "levelup-a-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of Conquest", "levelup-offer:paladin/Oath of the Crown", "levelup-offer:paladin/Oath of the Elements", "levelup-offer:paladin/Oathless Betrayer"] },
];
export const KNOWN_LEVELUP_B = [
  { id: "levelup-b-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of Devotion", "levelup-offer:paladin/Oath of Redemption", "levelup-offer:paladin/Oathbreaker", "levelup-offer:paladin/Oath of the Guardian"] },
];
export const KNOWN_LEVELUP_C = [
  { id: "levelup-c-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of the Ancients", "levelup-offer:paladin/Oath of Glory", "levelup-offer:paladin/Oath of Justice", "levelup-offer:paladin/Oath of the Hearth", "levelup-offer:witch_hunter/Order of the Silver Flame"] },
];
export const KNOWN_LEVELUP_D = [
  { id: "levelup-d-fill-any-weapon-pick-twin", ...CAT, rows: ["levelup:bard/College of the Cat"] },
  { id: "levelup-d-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of Vengeance", "levelup-offer:paladin/Oath of the Watchers", "levelup-offer:paladin/Oath of Safeguarding", "levelup-offer:paladin/Oath of the Plaguetouched"] },
];
export const KNOWN_LEVELUP_NOPACK_A = [
];
export const KNOWN_LEVELUP_NOPACK_B = [
];
export const KNOWN_LEVELUP_NOPACK_C = [
];

// The spell step's offer against the server's lists
// (test-enforce-sweep-builder-spell-offer.mjs).
export const KNOWN_SPELL_OFFER = [{ id: "spell-offer-anti-paladin", ...ANTI, rows: ["spell-offer:paladin:offered-is-taken"] }];
export const KNOWN_SPELL_OFFER_NOPACK = [];
