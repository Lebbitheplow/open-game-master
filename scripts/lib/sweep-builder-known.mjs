// The builder sweep's known gaps and skips, by suite. Each group names the
// rule a row breaks, where the fix goes, and the rows that fail for that one
// cause today (scripts/lib/sweep-builder-rows.mjs expand()).

export const KNOWN_FILL_CLASSES = [];
export const SKIP_FILL_CLASSES = {};

export const KNOWN_FILL_SUBCLASSES_A = [];
export const SKIP_FILL_SUBCLASSES_A = {};

export const KNOWN_FILL_SUBCLASSES_B = [];
export const SKIP_FILL_SUBCLASSES_B = {};

export const KNOWN_FILL_SPECIES = [];
export const SKIP_FILL_SPECIES = {};

export const KNOWN_FILL_BACKGROUNDS = [];
export const SKIP_FILL_BACKGROUNDS = {};

export const KNOWN_FILL_NOPACK = [];
export const SKIP_FILL_NOPACK = {};

export const KNOWN_PACK_PARITY = [];

// A pack subclass's training is read out of its prose. Most features that
// give a skill or a tool are not read at all, and two are read wrongly.
const TRAINING_RULE =
  "The feature's own text, quoted in each row's assertion (for one: Kobold Press, College of Shadows, Bonus Proficiencies: \"When you join the College of Shadows at 3rd level, you gain proficiency in Stealth and in two other skills of your choice.\").";
export const KNOWN_TRAINING_TEXT = [
  {
    id: "pack-training-not-read",
    rule: TRAINING_RULE,
    where: "src/lib/srd/subclass-training.ts trainingFromText (NAMED_FOR_TRAINING admits only features named like \"Bonus Proficiencies\", and featGrantSpec does not read \"gain proficiency in X and in two other skills\")",
    severity: "medium",
    note: "The character is built and seated without the proficiency; nothing says it is missing.",
    rows: ["training-text:barbarian/Path of the Herald/Oral Tradition", "training-text:bard/College of Investigation/Bonus Proficiencies", "training-text:bard/College of Shadows/Bonus Proficiencies", "training-text:cleric/Hunt Domain/Blessing of the Hunter", "training-text:cleric/Serpent Domain/Envenomed", "training-text:cleric/Shadow Domain/Cover of Night", "training-text:cleric/Vermin Domain/The Unseen", "training-text:cleric/Wind Domain/Wind's Chosen", "training-text:druid/Circle of Bees/Bee Bond", "training-text:fighter/Chaplain/Student of Faith", "training-text:monk/Way of the Wildcat/Enhanced Agility", "training-text:ranger/Beast Trainer/Beast Whisperer", "training-text:rogue/Sapper/Combat Engineer", "training-text:rogue/Smuggler/Dab-handed Dealer", "training-text:warlock/Animal Lords/Natural Blessing", "training-text:wizard/Courser Mage/Stalking Savant", "training-text:wizard/Gravebinding/Gravebinder Lore"],
  },
  {
    id: "pack-training-misread",
    rule: TRAINING_RULE,
    where: "src/lib/srd/feat-grant-text.ts featGrantSpec",
    severity: "medium",
    note: "College of the Cat: Acrobatics and Stealth are dropped and a martial weapon pick the text never gives is demanded (\"if you're proficient with a simple or martial melee weapon, you can use it as a spellcasting focus\"). Portal Domain: \"either cartographer's tools or navigator's tools (your choice)\" offers navigator's tools alone, and the server refuses cartographer's.",
    rows: ["training-text:bard/College of the Cat/Bonus Proficiencies", "training-text:cleric/Portal Domain/Bonus Proficiencies"],
  },
];

// The coin writers scan (test-enforce-sweep-builder-coin.mjs). Open pull
// request #895 removes this writer; the row closes when it merges.
export const KNOWN_COIN = [
  {
    id: "receipt-writes-silver-as-copper",
    rule:
      "src/lib/srd/currency.ts formatPrice writes a sum in gold, silver and copper; the builder's gear receipt writes \"Spent\" with it and \"Coin left\" with a writer of its own, so 3 gp 9 sp reads \"3 gp 90 cp\".",
    where: "src/app/characters/builder/receiptMath.ts formatCoin (called by GearReceipt.tsx for Starting coin and Coin left)",
    severity: "low",
    note: "formatCoin(390) is \"3 gp 90 cp\"; formatPrice(390) is \"3 gp 9 sp\".",
    rows: ["coin:src/app/characters/builder/receiptMath.ts#formatCoin"],
  },
];
