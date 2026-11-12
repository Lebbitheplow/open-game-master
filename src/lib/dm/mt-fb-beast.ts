// Form of the Beast (Path of the Beast): "When you enter your rage, grow one
// natural weapon (bite, claws or tail)". All three were there in every rage:
// the barbarian clawed and then bit. The weapon grown is the first one the
// rage uses, an attack with it or the tail's reaction, kept as a condition
// that ends with the rage (rage-bound.ts); another of the three is refused
// until the next rage. No step is added to entering the rage.
//
// pc-attack-profile.ts asks beastFormRefusal before a natural weapon swings,
// attack-swing.ts and the tail's reaction (authored-reactions.ts) call
// growBeastForm once the weapon is used.
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { RAGING } from "@/lib/srd/class-resources";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

const FEATURE = "Form of the Beast";
export const BEAST_FORM = "beast form";

type Natural = { feature: string; weapon: { name: string } };
type Shaped = { name: string; conditions: string[] };

// The natural weapon this rage grew, or null before any was used.
export function beastFormOf(sheet: Pick<Shaped, "conditions">): string | null {
  const held = sheet.conditions.find((entry) => isConditionNamed(entry, BEAST_FORM));
  return held ? (/\(([^()]*)\)\s*$/.exec(held)?.[1]?.trim() ?? null) : null;
}

export function beastFormRefusal(sheet: Shaped, natural: Natural): ToolError | null {
  const grown = isNamed(natural.feature, FEATURE) ? beastFormOf(sheet) : null;
  if (!grown || textKey(grown) === textKey(natural.weapon.name)) {
    return null;
  }
  return {
    error: `${sheet.name} grew the ${grown.toLowerCase()} as this rage began, and Form of the Beast grows one natural weapon a rage: they use the ${grown.toLowerCase()}, or a weapon they carry. Nothing was rolled.`,
    refused: "rules",
  };
}

export function growBeastForm(campaignId: string, sheetId: string, natural: Natural | null) {
  const sheet = getSheetById(sheetId);
  if (!sheet || !natural || !isNamed(natural.feature, FEATURE) || beastFormOf(sheet) || !sheet.conditions.some((entry) => isConditionNamed(entry, RAGING))) {
    return;
  }
  const condition = `${BEAST_FORM} (${natural.weapon.name.toLowerCase()})`;
  patchSheetAudited(
    campaignId,
    sheet.id,
    { conditions: [...sheet.conditions, condition], conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), [condition]: { whileRagingOf: sheet.id, source: sheet.id } } },
    { kind: "set_condition", reason: `Form of the Beast: the ${natural.weapon.name.toLowerCase()} grown for this rage`, delta: { condition } },
  );
}
