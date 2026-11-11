// The artificer's own numbers (ODM's class: its features are the glosses of
// src/lib/help/srd-features.json).
//
//   - Magic Item Savant (14th): "you ignore all class, race, spell and level
//     requirements on using them". Whoever may attune to an item is asked in
//     src/lib/srd/magic-items.ts mayAttune, which asks ignoresItemRequirements.
//     An alignment an item asks for is none of the four and still holds.
//   - Soul of Artifice (20th): "You gain +1 to every saving throw per attuned
//     magic item": soulOfArtificeBonus, added to every save where the sheet's
//     numbers are derived (src/lib/srd/index.ts computeSheetDerived).
//   - Magical Tinkering (1st): "You can have as many as your Intelligence
//     modifier": tinkeringLimit, at least one.
//
// Pure.

import { textKey } from "@/lib/language/text-logic";
import { holdsFeature } from "@/lib/srd/feature-names";

// The class's id, as a key.
const ARTIFICER = "artificer";

type Classed = { class?: string; level?: number; classes?: Array<{ id: string; level?: number }> | null };

// The character's artificer level, the way the attunement slots read it
// (src/lib/srd/armor.ts attunementSlotsFor).
export function artificerLevel(holder: Classed): number {
  if (holder.classes?.length) {
    return holder.classes.find((entry) => textKey(entry.id) === ARTIFICER)?.level ?? 0;
  }
  return textKey(holder.class ?? "") === ARTIFICER ? (holder.level ?? 0) : 0;
}

const SAVANT_LEVEL = 14;

export function ignoresItemRequirements(holder: Classed): boolean {
  return artificerLevel(holder) >= SAVANT_LEVEL;
}

export function soulOfArtificeBonus(sheet: { features?: ReadonlyArray<{ name: string }>; equipment?: ReadonlyArray<{ attuned?: boolean }> }): number {
  if (!sheet.features || !holdsFeature({ features: sheet.features }, "Soul of Artifice")) {
    return 0;
  }
  return (sheet.equipment ?? []).filter((item) => item.attuned === true).length;
}

export function tinkeringLimit(intelligenceModifier: number): number {
  return Math.max(1, intelligenceModifier);
}
