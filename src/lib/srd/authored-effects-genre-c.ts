// The genre classes' fight features the 2026-11-13 creator audit found still
// text only after wave 2 (src/lib/classes/*-features.json), in the authored
// layer's shapes, found by feature name with `classes` naming the class so a
// name another class shares never runs as this one. The clause ledgers
// (scripts/clauses/genre-*.json) point at scripts/test-genre-fight-gaps.mjs
// for what these hold.
//
// Pure data.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import type { GenreRow } from "@/lib/srd/authored-effects-genre";

const row = (feature: string, classes: string[], entry: Omit<AuthoredEntry, "subclass">): GenreRow => ({
  feature,
  classes,
  entry: { subclass: "genre", ...entry },
});

export const GENRE_C_AUTHORED: GenreRow[] = [
  // Road warrior 7: "When you move 20+ ft straight toward a target and hit
  // with a melee attack, deal +2d6 and shove it 10 ft." The dice ride the
  // swing (genre-a-strikes.ts afterRunFt), the shove the blow (genre-run-hits.ts).
  row("Ram Speed", ["road_warrior"], {
    effects: [
      { kind: "hit_rider", dice: "2d6", when: "melee", afterRunFt: 20 },
      { kind: "run_push", feet: 10, afterRunFt: 20 },
    ],
  }),
  // Steam knight 7: "When you move 15+ ft straight toward a creature and hit
  // it, it saves (STR) or is knocked prone" (DC 8 + proficiency + STR).
  row("Locomotive Charge", ["steam_knight"], {
    effects: [{ kind: "hit_save", save: "str", dcAbility: "str", condition: "prone", afterRunFt: 15, lasting: true }],
  }),
  // Aeronaut 1: "1/turn, add +1d6 damage to an attack made after moving at
  // least 15 ft in a straight or swinging line"; Greater Daring (11) makes it
  // +2d6. A swing's line is a run at the creature on the board.
  row("Daring Maneuver", ["aeronaut"], {
    effects: [{ kind: "hit_rider", dice: [[1, "1d6"], [11, "2d6"]], when: "melee", oncePerTurn: true, afterRunFt: 15 }],
  }),
  // Witch hunter 3: "Your ranged attacks count as silvered and magical."
  row("Blessed Ammunition", ["witch_hunter"], { effects: [{ kind: "ranged_material", silvered: true, magical: true }] }),
  // Dirgesinger 9: "Your healing dirges add your CHA modifier again to HP
  // restored": every healing spell a dirgesinger casts is a dirge
  // (heal-bonus.ts healAdditions reads the healing spell_rider).
  row("Lament of the Lost", ["dirgesinger"], { effects: [{ kind: "spell_rider", dice: (_level, mods) => Math.max(0, mods.cha ?? 0), healing: true }] }),
];
