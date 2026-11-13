import { findClass } from "@/lib/srd";
import { fixedDieValue, hpBonusPerLevelFor, levelHpGain, retroactiveHp, type HpMethod } from "@/lib/srd/hit-points";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The hit points a story edit moves.
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
// A level the GM sets at the console (a milestone) brings what a level-up
// brings, the die by the table's method and the Constitution modifier, per
// level gained; it brought hit dice, features and slots and left the
// maximum where it was. A level taken back takes the same per-level amount:
// the table's fixed value, or the die's maximum at a "max" table (a rolled
// level's roll is not on record, so the average stands in for it).
//
// Null when the edit moves nothing, or names its own maximum (the console's
// word is final). A rise lifts the current hit points with the maximum, as
// a level-up does; a fall leaves them to patchSheet's clamp.

type Edit = { abilities?: CharacterSheet["abilities"]; feats?: string[]; race?: string; level?: number; maxHp?: number };

export function storyEditHp(
  sheet: Pick<CharacterSheet, "abilities" | "feats" | "race" | "class" | "level" | "classes" | "hitDice" | "maxHp" | "currentHp" | "campaignId">,
  edit: Edit,
  table: { hpMethod?: HpMethod; rollDie?: (sides: number) => number } = {},
): { maxHp: number; currentHp: number } | null {
  if (edit.maxHp !== undefined) {
    return null;
  }
  const fallbackDie = Number(sheet.hitDice.die.slice(1)) || 8;
  const levels = sheet.classes?.length ? sheet.classes : [{ id: sheet.class, level: sheet.level }];
  const dieOf = (classId: string) => findClass(classId)?.hitDie ?? fallbackDie;
  const hpClasses = levels.map((entry) => ({ die: dieOf(entry.id), level: entry.level }));
  const perLevel = (race: string, feats: string[]) => hpBonusPerLevelFor(hpBonusPerLevel(race) > 0, feats, sheet.campaignId);
  const conAfter = (edit.abilities ?? sheet.abilities).con;
  const bonusAfter = perLevel(edit.race ?? sheet.race, edit.feats ?? sheet.feats);
  let shift = retroactiveHp(
    hpClasses,
    { con: sheet.abilities.con, perLevelBonus: perLevel(sheet.race, sheet.feats) },
    { con: conAfter, perLevelBonus: bonusAfter },
  );
  // A scalar level change lands on the first class (patchSheet folds it
  // there), so its die is that class's.
  const die = dieOf(levels[0].id);
  const method = table.hpMethod ?? "average";
  const levelDelta = Math.max(1, Math.min(20, edit.level ?? sheet.level)) - sheet.level;
  for (let gained = 0; gained < levelDelta; gained += 1) {
    const face = method === "max" ? die : method === "rolled" && table.rollDie ? Math.max(1, Math.min(die, table.rollDie(die))) : fixedDieValue(die);
    shift += levelHpGain(face, conAfter, bonusAfter);
  }
  for (let lost = 0; lost < -levelDelta; lost += 1) {
    shift -= levelHpGain(method === "max" ? die : fixedDieValue(die), conAfter, bonusAfter);
  }
  if (!shift) {
    return null;
  }
  const maxHp = Math.max(1, Math.min(500, sheet.maxHp + shift));
  // Nobody at 0 is woken by a bigger maximum: that takes healing.
  const lifted = sheet.currentHp > 0 ? Math.max(0, maxHp - sheet.maxHp) : 0;
  return { maxHp, currentHp: Math.min(maxHp, sheet.currentHp + lifted) };
}
