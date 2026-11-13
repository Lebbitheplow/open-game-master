// A content-pack class's features in the authored layer's shapes, found by
// feature name with `classes` naming the pack class (authored-effects.ts
// heldAuthored), as the genre classes' are: a pack class's rules text is
// its pack's, not subclasses.json.
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

export const PACK_CLASS_AUTHORED: GenreRow[] = [
  {
    // Black Flag's Metallurgist (Mystic Metal, Mechanist 3): an hour of
    // focus in contact with a nonmagical suit of armor transmutes it into
    // mystic metal, until the mechanist ends it or transmutes another. The
    // suit's row carries the mark (src/lib/dm/transmute-armor.ts).
    feature: "Mystic Metal",
    classes: ["mechanist"],
    entry: {
      subclass: "Metallurgist",
      spends: [{ name: "Mystic Metal", action: "none", does: { kind: "transmute_armor", feature: "Mystic Metal" } }],
    },
  },
  {
    // Juggernaut (Mechanist 11): "While wearing the armor from your Mystic
    // Metal feature, you have proficiency in the Athletics skill". Read off
    // the transformed suit's mark: in any other suit, or none, it is not there.
    feature: "Juggernaut",
    classes: ["mechanist"],
    entry: {
      subclass: "Metallurgist",
      effects: [{ kind: "skill_prof", skills: ["athletics"], while: "while wearing the armor from Mystic Metal", gate: { transmutedArmor: "Mystic Metal" } }],
    },
  },
];
