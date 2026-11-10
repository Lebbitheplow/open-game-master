// The feat sweep's known gaps and skips (scripts/lib/sweep-builder-rows.mjs).

// "Fill what's left" makes a subclass's training picks and never a feat's:
// fillFeatPicks is written for both ("a subclass's training, a feat") and
// called only for derived.subclassTraining.
const FILL_FEAT_TRAINING = {
  rule:
    "quickBuild.ts fillFeatPicks: \"A feat-shaped grant's open picks (a subclass's training, a feat): the languages, skills, expertise, tools and weapons it leaves to the player, each from the grant's own list where it names one, as the save checks\". \"Fill what's left\" ends in a character the builder's own save check passes (scripts/test-quick-build.mjs).",
  where: "src/app/characters/builder/quickBuild.ts fillRound (the featChoices block walks derived.subclassTraining only; the feats in asiChoices and state.feats are never passed to fillFeatPicks)",
  severity: "low",
  note: "A player who takes Skilled, Linguist, Skill Expert or Weapon Master and presses the fill is still told \"Linguist: pick 3 languages.\"",
};

// A pack half-feat that raises any score: the gate passes with no score
// chosen and the server refuses the save.
const HALF_FEAT_ANY = {
  rule:
    "Level Up Adventurer's Guide, Destiny's Call: \"An ability score of your choice increases by 1.\" The server (src/lib/srd/level-up.ts applyFeatIncrease, and the creation check) refuses the feat until the score is named; the builder's gate must ask for the same pick.",
  where: "src/app/characters/builder/submit.ts abilitiesBlocks (the half-feat ability check) against src/lib/srd/feat-effects.ts featAbilityIncrease, whose `from` is all six scores for this text",
  severity: "medium",
  note: "validateBuilder (with the feat judge) answers null for asiChoices [{ mode: \"feat\", feat: \"Destiny's Call\" }]; POST /api/characters answers 400 \"Destiny's Call raises one of STR, DEX, CON, INT, WIS, CHA by 1; choose which.\"",
};

export const KNOWN_FEATS = [
  {
    id: "fill-leaves-feat-training",
    ...FILL_FEAT_TRAINING,
    rows: [
      "feat:Covert Training:fill",
      "feat:Heraldic Training:fill",
      "feat:Linguist:fill",
      "feat:Linguistics Expert:fill",
      "feat:Skill Expert:fill",
      "feat:Skilled:fill",
      "feat:Skillful:fill",
      "feat:Weapon Master:fill",
      "feat:Weapons Specialist:fill",
      "feat:Woodcraft Training:fill",
    ],
  },
  { id: "gate-passes-half-feat-without-score", ...HALF_FEAT_ANY, rows: ["feat:Destiny's Call:taken", "feat:Destiny’s Call:taken"] },
];
export const SKIP_FEATS = {};

export const KNOWN_FEATS_NOPACK = [
  {
    id: "nopack-fill-leaves-feat-training",
    ...FILL_FEAT_TRAINING,
    rows: ["nopack-feat:Linguist:fill", "nopack-feat:Skill Expert:fill", "nopack-feat:Skilled:fill", "nopack-feat:Weapon Master:fill"],
  },
];
export const SKIP_FEATS_NOPACK = {};
