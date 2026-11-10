// The builder sweep's known gaps and skips, by suite. Each group names the
// rule a row breaks, where the fix goes, and the rows that fail for that one
// cause today (scripts/lib/sweep-builder-rows.mjs expand()).

// "Fill what's left" gives a species' free skill picks out of the class's own
// short list, so a cleric (two from History, Insight, Medicine, Persuasion,
// Religion) whose acolyte background already holds Insight and Religion is
// left one skill to pick two from, and the builder refuses the save.
const STARVED_CLASS_SKILLS = {
  rule:
    "SRD 5.1, Cleric, Proficiencies: \"Skills: Choose two from History, Insight, Medicine, Persuasion, and Religion\"; Half-Elf, Skill Versatility: \"You gain proficiency in two skills of your choice.\" The fill must end in a character the builder's own save check passes (scripts/test-quick-build.mjs).",
  where: "src/app/characters/builder/quickBuild.ts fillRound (the race.skillChoice block: skillOrder leads with the class's own list)",
  severity: "medium",
  note: "The species' two free picks take History and Medicine; the class is left Persuasion alone. The gate then says \"Pick 1 more skill your training taught you\".",
};

export const KNOWN_FILL_CLASSES = [];
export const SKIP_FILL_CLASSES = {};

export const KNOWN_FILL_SUBCLASSES_A = [];
export const SKIP_FILL_SUBCLASSES_A = {};

export const KNOWN_FILL_SUBCLASSES_B = [
  {
    id: "fill-any-weapon-pick",
    rule:
      "A subclass's training that leaves a weapon to the player is filled from the grant's own list (quickBuild.ts fillFeatPicks: \"A tool or weapon pick with no list of its own takes any\"). College of the Cat's grant is an any-kind pick over weapons, and the fill leaves it unmade.",
    where: "src/app/characters/builder/quickBuild.ts fillFeatPicks (top(\"weapons\", spec.weapons, ...) leaves out spec.any when anyKinds includes weapons, as the skills line above it does not)",
    severity: "medium",
    note: "The pick itself is a misreading of the pack's text (test-enforce-sweep-builder-training-text.mjs): the fill still has to make every pick the gate asks for.",
    rows: ["fill:subclass:bard/College of the Cat@3", "fill:subclass:bard/College of the Cat@20"],
  },
];
export const SKIP_FILL_SUBCLASSES_B = {};

export const KNOWN_FILL_SPECIES = [
  {
    id: "fill-starves-class-skills",
    ...STARVED_CLASS_SKILLS,
    rows: [
      "fill:species:changeling/cleric@1",
      "fill:species:half-elf/cleric@1",
      "fill:species:half-elf/cleric@5",
      "fill:species:kenku/cleric@1",
      "fill:species:lizardfolk/cleric@1",
    ],
  },
];
export const SKIP_FILL_SPECIES = {};

export const KNOWN_FILL_BACKGROUNDS = [];
export const SKIP_FILL_BACKGROUNDS = {};

export const KNOWN_FILL_NOPACK = [
  {
    id: "nopack-fill-starves-class-skills",
    ...STARVED_CLASS_SKILLS,
    rows: [
      "nopack:species:half_elf/cleric@1",
      "nopack:species:kenku/cleric@1",
      "nopack:species:changeling/cleric@1",
      "nopack:species:lizardfolk/cleric@1",
      "nopack:species:lizardfolk/cleric@5",
    ],
  },
];
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
