// The alchemist's and machinist's formula features the cc1113 genre-b pass
// wired, each read where its engine already reads the cast:
//
//   Corrosive Focus (Vitriolic School 2)  "you may change any formula's damage
//                                          type to acid": the free card lays
//                                          ACID_FORMULA for the turn, and a
//                                          spell's damage meets the creature's
//                                          defences as acid (enemy-defenses.ts).
//   Stone of the Magnum Opus (alchemist 15) "Catalyst Stone can instead reroll
//                                          all of a formula's dice, keeping the
//                                          better total": the stone's second
//                                          card lays CATALYST_REROLL, and the
//                                          next spell's damage roll is thrown
//                                          twice (cast-at-enemy-damage.ts).
//   The Great Work (alchemist 20)         "its dice are maximized": the cast its
//                                          7th-level slotless mark pays for
//                                          leaves GREAT_WORK on the caster
//                                          (cast-guard.ts), read as Overcharge's
//                                          maximum (genre-b-spell-hits.ts).
//   Magnum Opus (machinist 20)            "constructs and machines cannot
//                                          resist it": the cast its 6th-level
//                                          mark pays for leaves MAGNUM_OPUS, and
//                                          a construct fails its save against
//                                          that caster's spell (forced-save.ts).
//
// The two capstone marks belong to the cast that spent the slotless mark:
// every cast guard clears them first, so the next spell is an ordinary one.
import { getActiveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { actingSheetId } from "@/lib/dm/authored-saves";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const ACID_FORMULA = "acid formula";
export const CATALYST_REROLL = "catalyst reroll";
export const GREAT_WORK = "the great work";
export const MAGNUM_OPUS = "magnum opus";

const holds = (sheet: Pick<CharacterSheet, "conditions">, mark: string) => sheet.conditions.some((entry) => isConditionNamed(entry, mark));

function actor(campaignId: string): CharacterSheet | null {
  const id = actingSheetId(getActiveEncounter(campaignId));
  return id ? getSheetById(id) : null;
}

// The type a spell's damage meets a creature's defences as: acid while the
// acting alchemist's Corrosive Focus card holds.
export function formulaDamageType(campaignId: string, damageType: string | undefined, spell: boolean): string | undefined {
  if (!spell || !damageType) {
    return damageType;
  }
  const caster = actor(campaignId);
  return caster && holds(caster, ACID_FORMULA) && holdsGenreFeature(caster, "alchemist", "Corrosive Focus") ? "acid" : damageType;
}

// The cast guard's patch of the capstone marks: the last cast's gone, and the
// one this cast's slotless mark leaves (the 7th-level mark is The Great
// Work's alone, the 6th-level one Magnum Opus's: authored-effects-genre-b.ts).
export function capstoneMarks(
  sheet: Pick<CharacterSheet, "id">,
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  spent: string | null,
): { conditions: string[]; conditionMeta: ConditionMetaMap } | null {
  const stale = conditions.filter((entry) => isConditionNamed(entry, GREAT_WORK) || isConditionNamed(entry, MAGNUM_OPUS));
  const mark = spent === "slotless cast (7th)" ? GREAT_WORK : spent === "slotless cast (6th)" ? MAGNUM_OPUS : null;
  if (!stale.length && !mark) {
    return null;
  }
  const left = removeConditions(conditions, meta ?? {}, stale);
  return mark
    ? { conditions: [...left.conditions, mark], conditionMeta: { ...left.meta, [mark]: { untilTurnEndOf: sheet.id } } as ConditionMetaMap }
    : { conditions: left.conditions, conditionMeta: left.meta as ConditionMetaMap };
}

// The Great Work: the cast it paid for deals its dice at their maximum.
export function greatWorkAtMaximum(sheet: CharacterSheet): boolean {
  return holds(sheet, GREAT_WORK) && holdsGenreFeature(sheet, "alchemist", "The Great Work");
}

// Magnum Opus: the reason a construct fails its save against the acting
// machinist's spell, or null.
export function magnumOpusBinds(campaignId: string, enemy: EncounterEnemy, magical: boolean): string | null {
  if (!magical || creatureTypeOf(enemy.stats) !== "construct") {
    return null;
  }
  const caster = actor(campaignId);
  return caster && holds(caster, MAGNUM_OPUS) && holdsGenreFeature(caster, "machinist", "Magnum Opus") ? `Magnum Opus: a construct cannot resist ${caster.name}'s spell` : null;
}

// Stone of the Magnum Opus: whether this caster's next damage roll is thrown
// twice, the better kept. The mark is spent by the roll.
export function catalystRerolls(sheet: CharacterSheet): boolean {
  return holds(sheet, CATALYST_REROLL) && holdsGenreFeature(sheet, "alchemist", "Stone of the Magnum Opus");
}

export function spendCatalystReroll(sheet: CharacterSheet) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const left = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, fresh.conditions.filter((entry) => isConditionNamed(entry, CATALYST_REROLL)));
  patchSheet(sheet.id, { conditions: left.conditions, conditionMeta: left.meta });
}
