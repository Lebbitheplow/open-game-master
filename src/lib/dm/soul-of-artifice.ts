// Soul of Artifice (artificer 20th, SRD-style): "you can end one attunement as
// a reaction to drop to 1 hit point instead of 0." The drop is answered before
// it lands, with the other holds at 1 hit point (pc-damage.ts), so the death
// engine never sees it. Which attunement ends is the artificer's pick: the one
// they readied with the feature's card (use_resource "Soul of Artifice" with
// the item as the variant, kept on the mark below), else their only one. With
// several attuned and none readied the engine does not choose for them: the
// result says so and the drop lands.

import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ConditionMetaMap } from "@/lib/schemas/condition-meta";
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

export const SOUL_MARK = "soul of artifice";

type Sheetish = Pick<CharacterSheet, "features" | "equipment" | "conditions" | "conditionMeta" | "currentHp">;

// The attuned items, by name, in the sheet's order.
export function attunedItems(sheet: Pick<CharacterSheet, "equipment">): string[] {
  return (sheet.equipment ?? []).filter((item) => item.attuned).map((item) => item.name);
}

// The attunement the hold would end: the readied one while it is still
// attuned, else the only one. Null when there is none to end or the pick is
// the artificer's to make.
export function soulItem(sheet: Sheetish): string | null {
  const attuned = attunedItems(sheet);
  const readied = (sheet.conditionMeta as ConditionMetaMap | undefined)?.[SOUL_MARK]?.item;
  const kept = readied ? attuned.find((name) => textKey(name) === textKey(readied)) : undefined;
  return kept ?? (attuned.length === 1 ? attuned[0] : null);
}

// The mark a readying lays: the item named, while it is attuned.
export function readySoul(sheet: Sheetish, named: string | undefined): { patch: FullPatchSheetInput; item: string } | { error: string } {
  const attuned = attunedItems(sheet);
  // With one attunement there is nothing to choose between.
  const item = named ? attuned.find((name) => textKey(name) === textKey(named)) : attuned.length === 1 ? attuned[0] : undefined;
  if (!item) {
    return { error: attuned.length ? `Name the attunement Soul of Artifice would end as the variant: ${attuned.join(", ")}.` : "No item is attuned, so Soul of Artifice has nothing to end." };
  }
  const conditions = [...(sheet.conditions ?? []).filter((entry) => textKey(entry) !== SOUL_MARK), SOUL_MARK];
  return { item, patch: { conditions, conditionMeta: { ...(sheet.conditionMeta ?? {}), [SOUL_MARK]: { item } } } };
}

// The hold: the patch that keeps the artificer at 1 hit point with the item's
// attunement ended, or why it cannot, or null when the feature has no say.
export function soulHold(sheet: Sheetish, dropped: boolean, outright: boolean, reactionFree: boolean): { patch: FullPatchSheetInput; item: string } | { why: string } | null {
  if (!dropped || outright || !holdsFeature(sheet, "Soul of Artifice") || !reactionFree || !attunedItems(sheet).length) {
    return null;
  }
  const item = soulItem(sheet);
  if (!item) {
    return { why: `Soul of Artifice could have held them at 1 hit point, but no attunement was readied to end (use_resource "Soul of Artifice" with the item as the variant).` };
  }
  const equipment = (sheet.equipment ?? []).map((entry) => (entry.name === item && entry.attuned ? { ...entry, attuned: false } : entry));
  const meta = { ...(sheet.conditionMeta ?? {}) } as ConditionMetaMap;
  delete meta[SOUL_MARK];
  return { item, patch: { currentHp: 1, equipment, conditions: (sheet.conditions ?? []).filter((entry) => textKey(entry) !== SOUL_MARK), conditionMeta: meta } };
}
