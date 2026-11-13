import { findClass } from "@/lib/srd";
import { hpBonusPerLevelFor, retroactiveHp } from "@/lib/srd/hit-points";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The hit points a story edit moves for the levels already held.
//
// SRD 5.1, Hit Points: "If your Constitution modifier changes, your hit
// point maximum changes as well, as though you had the new modifier from
// 1st level." Tough raises it by twice the level "when you gain this feat",
// and a Hill Dwarf's toughness counts every level. update_sheet is the door
// for each of them (a tome read, a curse, a feat the story grants, a
// reincarnation), and it stored the new score with the old maximum: a hero
// whose Constitution rose to 16 at 5th level kept 44 where the rules give 49.
// The level-up pays the same back the same way (src/lib/srd/level-up.ts).
//
// Null when the edit moves nothing, or names its own maximum (the console's
// word is final). A rise lifts the current hit points with the maximum, as
// a level-up does; a fall leaves them to patchSheet's clamp.

type Edit = { abilities?: CharacterSheet["abilities"]; feats?: string[]; race?: string; maxHp?: number };

export function storyEditHp(
  sheet: Pick<CharacterSheet, "abilities" | "feats" | "race" | "class" | "level" | "classes" | "hitDice" | "maxHp" | "currentHp" | "campaignId">,
  edit: Edit,
): { maxHp: number; currentHp: number } | null {
  if (edit.maxHp !== undefined) {
    return null;
  }
  const fallbackDie = Number(sheet.hitDice.die.slice(1)) || 8;
  const levels = sheet.classes?.length ? sheet.classes : [{ id: sheet.class, level: sheet.level }];
  const hpClasses = levels.map((entry) => ({ die: findClass(entry.id)?.hitDie ?? fallbackDie, level: entry.level }));
  const perLevel = (race: string, feats: string[]) => hpBonusPerLevelFor(hpBonusPerLevel(race) > 0, feats, sheet.campaignId);
  const shift = retroactiveHp(
    hpClasses,
    { con: sheet.abilities.con, perLevelBonus: perLevel(sheet.race, sheet.feats) },
    { con: (edit.abilities ?? sheet.abilities).con, perLevelBonus: perLevel(edit.race ?? sheet.race, edit.feats ?? sheet.feats) },
  );
  if (!shift) {
    return null;
  }
  const maxHp = Math.max(1, Math.min(500, sheet.maxHp + shift));
  // Nobody at 0 is woken by a bigger maximum: that takes healing.
  const lifted = sheet.currentHp > 0 ? Math.max(0, maxHp - sheet.maxHp) : 0;
  return { maxHp, currentHp: Math.min(maxHp, sheet.currentHp + lifted) };
}
