// A feat is taken once, except the one whose text says otherwise: Elemental
// Adept, "You can take this feat more than once, choosing a different type
// each time." The level-up (src/lib/srd/level-up.ts) asks here whether a feat
// the character already holds may be taken again with the picks sent.
//
// Pure.
import { textKey } from "@/lib/language/text-logic";
import { ELEMENTAL_ADEPT_TYPES, elementalAdeptTypes } from "@/lib/srd/feat-combat";
import { holdsFeat } from "@/lib/srd/feat-effects";

type Holder = { name?: string; feats?: string[]; features?: Array<{ name: string }> };

// Why this feat cannot be taken a second time, or null when it can.
export function featRepeatRefusal(sheet: Holder, feat: string, picks: { damageType?: string } | null | undefined): string | null {
  const who = sheet.name ?? "This character";
  if (!holdsFeat({ feats: [feat], features: [] }, "Elemental Adept")) {
    return `${who} already has ${feat}; a feat is taken once.`;
  }
  const picked = textKey(picks?.damageType ?? "");
  const held = elementalAdeptTypes(sheet);
  if (!ELEMENTAL_ADEPT_TYPES.includes(picked)) {
    return `${who} already has ${feat}; taking it again means choosing another damage type (${ELEMENTAL_ADEPT_TYPES.filter((type) => !held.includes(type)).join(", ")}).`;
  }
  if (held.includes(picked)) {
    return `${who}'s ${feat} already covers ${picked}; each time the feat is taken it names a different damage type.`;
  }
  return null;
}
