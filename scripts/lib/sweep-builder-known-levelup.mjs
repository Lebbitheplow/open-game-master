// The level-up sweep's known gaps and skips (scripts/lib/sweep-builder-rows.mjs).
// Written from a SWEEP_DISCOVER=1 run of each suite; a row is listed under the
// one cause its assertion names.

// GET /sheet/level-up lists every option of a pick that is not yet chosen,
// the ones whose printed prerequisite the character does not meet among them,
// and the PATCH then refuses those by name.
const PREREQ = {
  rule:
    "odm_level_up_options (src/lib/agents/workbench.ts): \"under choices every pick it opens with the exact names to send back\". SRD 5.1, Warlock, Eldritch Invocations: \"If an eldritch invocation has prerequisites, you must meet them to learn it.\"",
  where: "src/lib/srd/level-up-options.ts levelUpOptions (featurePicks: slot.options is filtered by what is chosen, never by optionReqProblem, which buildLevelUp applies)",
  severity: "low",
  note: "An agent that takes the first names listed is refused (\"Ascendant Step needs warlock level 9\", \"Aspect of the Moon needs the Pact of the Tome\") and has to drop them one refusal at a time.",
};

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

const UNKNOWN_CLASS = {
  rule:
    "A class the builder offers and both creation doors take levels up: the PATCH resolves it through classGrantsFor (the pack's and the table's classes), and the offer that the dialog and odm_level_up_options read must resolve the same class.",
  where: "src/lib/srd/level-up-options.ts levelUpOptions (findClass knows the bundled classes only) and its route src/app/api/campaigns/[campaignId]/sheet/level-up/route.ts",
  severity: "medium",
  note: "GET /sheet/level-up answers 400 Unknown class \"mechanist\" for the content pack's Mechanist; PATCH /sheet { level: 2 } on the same sheet answers 200. An agent cannot read what the level opens, and the dialog, which reads only racialCantripChoice from this route, gets none.",
};

const CAT = {
  rule: "\"Fill what's left\" ends in a character the builder's own save check passes (scripts/test-quick-build.mjs).",
  where: "src/app/characters/builder/quickBuild.ts fillFeatPicks",
  severity: "medium",
  note: "The level 20 twin is made by the fill, which leaves College of the Cat's any-kind weapon pick unmade (test-enforce-sweep-builder-fill-subclasses-b.mjs).",
};

export const KNOWN_LEVELUP_A = [
  { id: "levelup-a-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["levelup-offer:monk/Way of the Four Elements", "levelup-offer:warlock/The Archfey", "levelup-offer:warlock/The Fathomless", "levelup-offer:warlock/Ancient Dragons", "levelup-offer:warlock/Primordial"] },
  { id: "levelup-a-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of Conquest", "levelup-offer:paladin/Oath of the Crown", "levelup-offer:paladin/Oath of the Elements", "levelup-offer:paladin/Oathless Betrayer"] },
];
export const KNOWN_LEVELUP_B = [
  { id: "levelup-b-offer-unknown-pack-class", ...UNKNOWN_CLASS, rows: ["levelup:mechanist/Metallurgist"] },
  { id: "levelup-b-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of Devotion", "levelup-offer:paladin/Oath of Redemption", "levelup-offer:paladin/Oathbreaker", "levelup-offer:paladin/Oath of the Guardian"] },
  { id: "levelup-b-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["levelup-offer:warlock/The Great Old One", "levelup-offer:warlock/The Genie", "levelup-offer:warlock/Animal Lords", "levelup-offer:warlock/The Ancient Fey Court"] },
];
export const KNOWN_LEVELUP_C = [
  { id: "levelup-c-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of the Ancients", "levelup-offer:paladin/Oath of Glory", "levelup-offer:paladin/Oath of Justice", "levelup-offer:paladin/Oath of the Hearth", "levelup-offer:witch_hunter/Order of the Silver Flame"] },
  { id: "levelup-c-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["levelup-offer:warlock/The Celestial", "levelup-offer:warlock/The Undead", "levelup-offer:warlock/Hunter in Darkness", "levelup-offer:warlock/The Great Elder Thing"] },
];
export const KNOWN_LEVELUP_D = [
  { id: "levelup-d-fill-any-weapon-pick-twin", ...CAT, rows: ["levelup:bard/College of the Cat"] },
  { id: "levelup-d-anti-paladin-spells-offered", ...ANTI, rows: ["levelup-offer:paladin/Oath of Vengeance", "levelup-offer:paladin/Oath of the Watchers", "levelup-offer:paladin/Oath of Safeguarding", "levelup-offer:paladin/Oath of the Plaguetouched"] },
  { id: "levelup-d-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["levelup-offer:warlock/The Fiend", "levelup-offer:warlock/The Hexblade", "levelup-offer:warlock/The Undying", "levelup-offer:warlock/Old Wood", "levelup-offer:warlock/Wyrdweaver"] },
];
export const KNOWN_LEVELUP_NOPACK_A = [
  { id: "levelup-nopack-a-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["nopack-levelup-offer:artificer/Artillerist", "nopack-levelup-offer:monk/Way of the Four Elements", "nopack-levelup-offer:warlock/The Fiend", "nopack-levelup-offer:warlock/The Celestial", "nopack-levelup-offer:warlock/The Genie"] },
];
export const KNOWN_LEVELUP_NOPACK_B = [
  { id: "levelup-nopack-b-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["nopack-levelup-offer:artificer/Alchemist", "nopack-levelup-offer:artificer/Battle Smith", "nopack-levelup-offer:warlock/The Archfey", "nopack-levelup-offer:warlock/The Hexblade", "nopack-levelup-offer:warlock/The Undead"] },
];
export const KNOWN_LEVELUP_NOPACK_C = [
  { id: "levelup-nopack-c-offer-lists-unmet-prerequisites", ...PREREQ, rows: ["nopack-levelup-offer:artificer/Armorer", "nopack-levelup-offer:warlock/The Great Old One", "nopack-levelup-offer:warlock/The Fathomless", "nopack-levelup-offer:warlock/The Undying"] },
];

// The spell step's offer against the server's lists
// (test-enforce-sweep-builder-spell-offer.mjs).
export const KNOWN_SPELL_OFFER = [{ id: "spell-offer-anti-paladin", ...ANTI, rows: ["spell-offer:paladin:offered-is-taken"] }];
export const KNOWN_SPELL_OFFER_NOPACK = [];
