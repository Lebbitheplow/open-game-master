// Awakened Spellbook (Order of Scribes 2): "When you cast a wizard spell with
// a slot you can change its damage type to one found in another spell in your
// book of the slot's level; once per long rest you can cast a ritual spell
// from the book at its normal casting time rather than adding 10 minutes".
//
// Both were left to the GM: the cast tools dropped a damage type that was not
// the spell's own, and no counter held the once a day.
//
// The damage type. The cast tools already take one (cast_at_enemy's
// damageType, aoe_damage's type) and hand it to the one cast guard
// (cast-guard.ts castSpell, `swapType`). For a holder of the feature a type
// other than the spell's own is a swap: taken when the spell is in the
// wizard's book, a spell slot pays for this casting, and another spell in the
// book whose level is the slot's deals that type; refused before anything is
// spent otherwise. The guard answers the type and the tool deals it. A spell
// of two types has its first changed. For anyone else the type sent is what
// it always was: ignored for a spell whose type the server knows.
//
// The ritual. use_resource "Awakened Spellbook" spends the day's use and lays
// a mark on the wizard that lasts until a ritual uses it or they finish a long
// rest. The next ritual they cast from the book takes the spell's own casting
// time: no 10 minutes on the clock, and in a fight a ritual cast with an
// action takes effect at once, where the 10 minutes would hold it for a
// hundred rounds. The mark goes with that ritual.
//
// Called by cast-guard.ts castSpell (both halves) and by the two cast tools
// for a casting that continues (castDamageType).

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { publishPersisted } from "@/lib/events";
import { removeConditions } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { bookEntries, inBook } from "@/lib/srd/ar-ws-spellbook";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { checklistSpell } from "@/lib/srd/spell-lists";

const FEATURE = "Awakened Spellbook";
export const SWIFT_RITUAL = "swift ritual";

// ---- the ritual at its normal casting time ----

// Whether this ritual is cast without the 10 extra minutes: the wizard holds
// the mark, and the spell is a ritual in their book.
export function swiftRitual(sheet: CharacterSheet, facts: SpellFacts | null, ritual: boolean): boolean {
  return ritual && Boolean(facts?.ritual) && sheet.conditions.some((entry) => isConditionNamed(entry, SWIFT_RITUAL)) && inBook(sheet.spellcasting, facts?.name ?? "");
}

// The ritual it sped uses the mark up.
export function spendSwiftRitual(campaign: Campaign, sheetId: string): string {
  const sheet = getSheetById(sheetId);
  if (sheet) {
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, sheet.conditions.filter((entry) => isConditionNamed(entry, SWIFT_RITUAL)));
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return `${FEATURE}: cast at the spell's own casting time, without a ritual's 10 extra minutes (once until a long rest).`;
}

// ---- the damage type ----

type Swap = { type: string; from: string };

// The damage types the other spells of this level in the book deal, each with
// a spell that deals it.
function typesInBook(sheet: CharacterSheet, spell: string, level: number, authors: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of bookEntries(sheet.spellcasting)) {
    if (textKey(entry.spell) === textKey(spell)) {
      continue;
    }
    const own = spellFactsFor(entry.spell, authors)?.level ?? checklistSpell(entry.spell)?.level;
    if (own !== level) {
      continue;
    }
    const mech = spellMechanicsFor({ spell: entry.spell, userIds: authors })?.mech;
    for (const type of [mech?.damageType, mech?.secondType]) {
      if (type && !found.has(textKey(type))) {
        found.set(textKey(type), entry.spell);
      }
    }
  }
  return found;
}

// The damage type this casting deals in place of the spell's own, the refusal
// when the book does not allow the one asked for, or null when nothing is
// swapped (no feature, no type asked, the spell's own type asked, or a spell
// whose type the server does not know).
export function awakenedDamageType(
  sheet: CharacterSheet,
  cast: { spell: string; asked?: string; own?: string; second?: string; level: number | null; slotLevel: number | null; slotPaid: boolean; authors: string[] },
): Swap | ToolError | null {
  const asked = textKey(cast.asked ?? "");
  if (!asked || !cast.own || !holdsFeature(sheet, FEATURE)) {
    return null;
  }
  if (asked === textKey(cast.own) || asked === textKey(cast.second ?? "")) {
    return null;
  }
  const own = `Leave the damage type out for ${cast.spell}'s own (${cast.own}). Nothing was spent.`;
  if (!inBook(sheet.spellcasting, cast.spell)) {
    return { error: `${FEATURE} changes the damage type of a wizard spell from ${sheet.name}'s spellbook, and ${cast.spell} is not in it. ${own}`, retry: true };
  }
  if (!cast.slotPaid || !cast.slotLevel || cast.level === 0) {
    return { error: `${FEATURE} changes the damage type of a spell cast with a spell slot, and this casting of ${cast.spell} spends none. ${own}`, retry: true };
  }
  const types = typesInBook(sheet, cast.spell, cast.slotLevel, cast.authors);
  const from = types.get(asked);
  if (!from) {
    const there = [...types].map(([type, spell]) => `${type} (${spell})`).join(", ");
    return {
      error: `${FEATURE} takes a damage type found in another spell of the slot's level in ${sheet.name}'s spellbook, and no other level ${cast.slotLevel} spell there deals ${asked} damage${there ? `: the level ${cast.slotLevel} spells there deal ${there}` : " (no other damaging spell of that level is in the book)"}. ${own}`,
      retry: true,
    };
  }
  return { type: asked, from };
}

// The type a cast tool deals after the guard answered: the swap the guard
// took, or for a later call of the same casting (another target of a spell
// cast a moment ago) the swap asked again, read against the slot the casting
// was cast from; else the spell's own.
export function castDamageType(
  sheet: CharacterSheet,
  cast: Record<string, unknown>,
  spell: { name: string; asked?: string; own?: string; second?: string; level: number | null; authors: string[] },
): string | undefined {
  if (typeof cast.damageType === "string") {
    return cast.damageType;
  }
  if (cast.continuing && !cast.fromItem && typeof cast.slotLevel === "number") {
    const again = awakenedDamageType(sheet, { spell: spell.name, asked: spell.asked, own: spell.own, second: spell.second, level: spell.level, slotLevel: cast.slotLevel, slotPaid: true, authors: spell.authors });
    if (again && "type" in again) {
      return again.type;
    }
  }
  return spell.own ?? spell.asked;
}
