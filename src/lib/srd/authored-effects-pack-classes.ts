// A content-pack class's features in the authored layer's shapes, found by
// feature name with `classes` naming the pack class (authored-effects.ts
// heldAuthored), as the genre classes' are: a pack class's rules text is
// its pack's, not subclasses.json.
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

export const PACK_CLASS_AUTHORED: GenreRow[] = [
  {
    // Black Flag's Metallurgist (Juggernaut, Mechanist 11): "While wearing the
    // armor from your Mystic Metal feature, you have proficiency in the
    // Athletics skill." Mystic Metal turns the suit the mechanist wears into
    // mystic metal and it stays so until they move it to another; the sheet
    // keeps no mark of which suit, so the body armor worn is read as that
    // suit. Out of armor the proficiency is not there.
    feature: "Juggernaut",
    classes: ["mechanist"],
    entry: {
      subclass: "Metallurgist",
      effects: [{ kind: "skill_prof", skills: ["athletics"], while: "while wearing the armor from Mystic Metal", gate: { bodyArmor: true } }],
    },
  },
];
