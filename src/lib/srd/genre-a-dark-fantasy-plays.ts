// What a dark fantasy class's spend plays when no shape of the authored layer
// holds its text (WAVE2 D5: the genre text is the rule). The authored row's
// `does` is { kind: "dark_fantasy", play }, and src/lib/dm/genre-a-dark-fantasy-spends.ts
// resolves each play, composing the layer's own shapes where it can. Pure: the
// Hand reads the aim below to send the target the engine asks for.

export type DarkFantasyPlay =
  // Hunter's Brand: a creature the hunter can see, and with Twin Brand a
  // second one beside the first, each +1d8 radiant.
  | "brand";

export type DarkFantasyAim = "enemy" | "ally" | "self" | "none";

// The creature each play is aimed at, which its Hand card sends.
export const DARK_FANTASY_AIM: Record<DarkFantasyPlay, DarkFantasyAim> = {
  brand: "enemy",
};
