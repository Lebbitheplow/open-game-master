// A Draconic Bloodline sorcerer's dragon ancestor (SRD 5.1, Sorcerer: Dragon
// Ancestor), as the sheet records the pick: "Dragon Ancestor: Red" (the
// option the builder, the level-up and the sheet's owed picks write,
// src/lib/srd/options.ts), or "Dragon Ancestor (gold)".
//
// Elemental Affinity's damage and resistance (spell-damage-riders.ts,
// src/lib/dm/srd-feature-spends.ts), the Charisma checks with dragons
// (check-traits.ts) and the GM's prompt all read it here. Pure and small, so
// the check riders can import it without the spell engines.
//
// A feature named "Draconic Bloodline (Red)" is not read: nothing writes it,
// and a workshop species choice labelled "Draconic Bloodline" would have
// handed its options' damage types to every sorcerer of any origin
// (issue #833).

import { textKey } from "@/lib/language/text-logic";
import { familyOf, isNamed, nameChoice } from "@/lib/srd/feature-names";
import { chosenDamageType } from "@/lib/srd/chosen-element";

// The damage type of each dragon a Draconic Bloodline sorcerer can descend
// from (SRD 5.1, Dragon Ancestor table).
export const DRAGON_TYPES: Record<string, string> = {
  black: "acid",
  blue: "lightning",
  brass: "fire",
  bronze: "lightning",
  copper: "acid",
  gold: "fire",
  green: "poison",
  red: "fire",
  silver: "cold",
  white: "cold",
};

// The dragon the sheet names ("Red"), or null.
export function dragonAncestorColor(sheet: { features: ReadonlyArray<{ name: string }> }): string | null {
  for (const feature of sheet.features) {
    if (!isNamed(familyOf(feature.name), "Dragon Ancestor")) {
      continue;
    }
    const color = textKey(nameChoice(feature.name) ?? "");
    if (DRAGON_TYPES[color]) {
      return color.charAt(0).toUpperCase() + color.slice(1);
    }
  }
  return null;
}

// The damage type of the sorcerer's dragon ancestor, or null when no dragon
// is chosen.
export function dragonAncestorType(sheet: { features: ReadonlyArray<{ name: string }> }): string | null {
  const color = dragonAncestorColor(sheet);
  return color ? DRAGON_TYPES[textKey(color)] : null;
}

// The mark a spell of the dragon's damage type leaves on the sorcerer as it
// is cast (src/lib/dm/affinity-cast.ts): Elemental Affinity's resistance is
// bought then, and the Hand deals its card only while it is held.
export const AFFINITY_CAST = "affinity cast";

// The mark a sheet holds, by its damage type, or null.
export function affinityCastType(sheet: { conditions?: ReadonlyArray<string> }): string | null {
  for (const condition of sheet.conditions ?? []) {
    const match = /^affinity cast \(([^)]+)\)$/i.exec(condition.trim());
    if (match) {
      return textKey(match[1]);
    }
  }
  return null;
}

// A sheet as the element's readers take it.
type ElementSheet = {
  class?: string;
  subclass?: string;
  classes?: ReadonlyArray<{ id: string; subclass?: string | null }>;
  features: ReadonlyArray<{ name: string; source?: string; classId?: string }>;
};

// The class whose subclass grants Elemental Affinity, and that subclass.
function affinityHolder(sheet: ElementSheet): { classId: string; subclass: string } {
  const feature = sheet.features.find((entry) => isNamed(entry.name, "Elemental Affinity"));
  const classId = feature?.classId ?? sheet.class ?? "";
  const entry = (sheet.classes ?? []).find((held) => textKey(held.id) === textKey(classId));
  return { classId, subclass: entry?.subclass ?? sheet.subclass ?? "" };
}

// The element Elemental Affinity reads: the dragon ancestor's, else the
// damage type the workshop subclass that grants it has its player choose
// ("Bloodline damage type: Lightning", src/lib/srd/chosen-element.ts), so a
// workshop bloodline that borrows it adds to and resists its own element
// (issue #833). The SRD's Draconic Bloodline reads only its dragon, and a
// multiclass reads only the element of the subclass holding the feature:
// an element another class's subclass chose is not this one's.
export function chosenElementType(sheet: ElementSheet): string | null {
  const dragon = dragonAncestorType(sheet);
  const holder = affinityHolder(sheet);
  if (textKey(holder.subclass) === textKey("Draconic Bloodline")) {
    return dragon;
  }
  return dragon ?? chosenDamageType(sheet.features, holder.classId || undefined)?.type ?? null;
}

// Where that element comes from, in words: "their dragon ancestor (Red)",
// "their Bloodline (lightning)".
export function chosenElementWords(sheet: ElementSheet): string {
  const color = dragonAncestorColor(sheet);
  if (color) {
    return `their dragon ancestor (${color})`;
  }
  const holder = affinityHolder(sheet);
  const named = chosenDamageType(sheet.features, holder.classId || undefined);
  return named ? `their ${named.label} (${named.type})` : "their chosen element";
}
