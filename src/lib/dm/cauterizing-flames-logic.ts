// The Wildfire druid's spectral flames as the sheet keeps them: the mark, its
// stored shape and the reader of it. Pure (no database), so the Hand reads
// it; src/lib/dm/cauterizing-flames.ts lays, finds and quenches the flames.
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const FLAME_MARK = "spectral flames";
export const FLAME_FEET = 30;
// A minute.
export const FLAME_ROUNDS = 10;

export type SpectralFlame = { x: number; y: number; untilRound: number };

export type FlameMeta = { flames?: SpectralFlame[] };

export const metaOf = (sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): FlameMeta | null => {
  const held = sheet.conditions.find((entry) => isConditionNamed(entry, FLAME_MARK));
  return held ? (((sheet.conditionMeta ?? {}) as Record<string, FlameMeta | undefined>)[held] ?? {}) : null;
};

// The flames the druid keeps, as stored (the Hand reads it: pure).
export function heldFlames(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): SpectralFlame[] {
  return metaOf(sheet)?.flames ?? [];
}
