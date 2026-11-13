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

export const KNOWN_TRAINING_TEXT = [
  {
    id: "training-while-worn",
    rule:
      "A pack subclass's proficiency that holds only while a condition lasts (Black Flag's Metallurgist: Athletics while wearing its Mystic Metal armor) is granted while it holds. The training reader keeps a sentence with \"while\" out on purpose (subclass-training.ts PASSING), so it is never granted at all; the Metallurgist's features are read since the cc1113 classes audit read archetype rows by their feature lists.",
    where: "src/lib/srd/subclass-training.ts trainingSentences (PASSING), and a worn-armor condition on a skill grant the sheet does not have yet",
    severity: "low",
    note: "Granting Athletics outright would hold it out of the armor too; a conditional grant needs the derived sheet to read what is worn.",
    rows: ["training-text:mechanist/Metallurgist/Juggernaut"],
  },
];

export const KNOWN_COIN = [];
