// What a dark fantasy class's spend plays when no shape of the authored layer
// holds its text (WAVE2 D5: the genre text is the rule). The authored row's
// `does` is { kind: "dark_fantasy", play }, and src/lib/dm/genre-a-dark-fantasy-spends.ts
// resolves each play, composing the layer's own shapes where it can. Pure: the
// Hand reads the aim below to send the target the engine asks for.

export type DarkFantasyPlay =
  // Hunter's Brand: a creature the hunter can see, and with Twin Brand a
  // second one beside the first, each +1d8 radiant.
  | "brand"
  // Dirge of Sorrow: one enemy within 30 feet saves on Wisdom or takes 1d4
  // off its next attack roll; three, and its saves too, with Dirge of Ruin;
  // one more while The Grave Chorus sings.
  | "dirge"
  // Purging Flame: declared before the roll, 2d10 radiant on the next hit on
  // the branded creature. Judgment Shot: the next ranged attack on it is a
  // critical hit if it hits.
  | "purging_flame"
  | "judgment_shot"
  // Lance the Wound: 2d8 necrotic (4d8 from Virulent Strain, half on one
  // creature beside the target) on the creature a melee hit just landed on,
  // which cannot regain hit points until the doctor's next turn.
  | "lance";

export type DarkFantasyAim = "enemy" | "ally" | "self" | "none";

// The creature each play is aimed at, which its Hand card sends.
export const DARK_FANTASY_AIM: Record<DarkFantasyPlay, DarkFantasyAim> = {
  brand: "enemy",
  dirge: "enemy",
  purging_flame: "none",
  judgment_shot: "none",
  lance: "enemy",
};
