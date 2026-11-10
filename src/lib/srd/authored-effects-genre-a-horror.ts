// The horror classes' features built in the fifth genre-a round (WAVE2 D5:
// "The genre classes' text is the rule, played on the SRD 5.1 engine"), as
// the authored layer's rows. Registered with one line in
// authored-effects-genre-a.ts, so the three genre branches never append to
// the same array. A row whose rule an engine outside this layer applies names
// that engine (`heldBy`); the readers find it through
// src/lib/srd/genre-a-horror-holds.ts.
//
// The text each row holds is src/lib/classes/horror-features.json; the ledger
// (scripts/clauses/genre-horror.json) says which clause each row holds.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const held = (classId: string, feature: string, file: string, call: string, more: Partial<AuthoredEntry> = {}): GenreRow => ({
  feature,
  classes: [classId],
  entry: { subclass: "genre", heldBy: { file, call }, ...more },
});

export const GENRE_A_HORROR: GenreRow[] = [
  // "Advantage on death saves; stabilizing you takes no check"
  held("survivor", "Death's Old Acquaintance", "src/lib/dm/death.ts", "horrorDeathSaveAdvantage"),
  // "While you are the last conscious party member, resist all damage and
  // your speed doubles"
  held("survivor", "Sole Survivor", "src/lib/dm/pc-damage.ts", "soleSurvivorResistances"),
  held("exorcist", "Consecrated Tools", "src/lib/dm/pc-attack-damage.ts", "horrorMagicalAgainst"),
  // "Double proficiency bonus on Arcana and Religion checks"
  held("occultist", "Forbidden Lore", "src/lib/dm/rolls.ts", "horrorCheckRider"),
  // "Advantage on checks to identify or recall lore about undead and
  // shapechangers": the lore skills, about a creature the GM names.
  {
    feature: "Vampiric Scholar",
    classes: ["slayer"],
    entry: { subclass: "genre", effects: [{ kind: "check_adv", skills: ["arcana", "history", "religion", "nature", "investigation"], creatures: ["undead", "shapechanger"] }] },
  },
  // "Advantage on checks to identify supernatural creatures and effects you
  // have measured before": the supernatural creature types; whether this one
  // was measured before is the GM's to keep.
  {
    feature: "Documented Phenomena",
    classes: ["parapsychologist"],
    entry: {
      subclass: "genre",
      effects: [{ kind: "check_adv", skills: ["arcana", "religion", "nature", "investigation"], creatures: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"] }],
    },
  },
];

// Improved Quarry (slayer 11): "Quarry damage rises to +2d6": a second d6 on
// hits against the marked creature, from the level the class grants it
// (src/lib/dm/genre-a-strikes.ts reads vsMark). It rides the Quarry row, which
// authored-effects-genre.ts spreads in.
export const QUARRY_LADDER = [{ kind: "hit_rider" as const, dice: "1d6", vsMark: "quarry", gate: { level: 11 } }];
