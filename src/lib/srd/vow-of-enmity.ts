// Vow of Enmity (Oath of Vengeance 3) names one creature. The vow is the
// paladin's condition with that creature's id in its meta, as a quarry's mark
// is (src/lib/dm/attack-marks.ts), so the Hand can read it from the sheet.
// Pure.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

export const VOW_OF_ENMITY = "vow of enmity";

export function vowedFoe(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): string | null {
  if (!sheet.conditions.some((entry) => textKey(entry) === VOW_OF_ENMITY)) return null;
  const meta = (sheet.conditionMeta as Record<string, { quarry?: string } | undefined>)[VOW_OF_ENMITY];
  return meta?.quarry ?? null;
}
