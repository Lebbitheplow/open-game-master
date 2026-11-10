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
