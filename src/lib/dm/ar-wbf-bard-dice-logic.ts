// What a bard's subclass lets the Bardic Inspiration die they give do, read
// off the die itself (scripts/clauses/arcane.json, the bard's clauses):
//
//   - College of Valor, Combat Inspiration: "A creature holding your Bardic
//     Inspiration die may add it to a damage roll". The die a Valor bard
//     gives is marked `combat`; its holder's hit waits on their card, as a
//     Death cleric's hit waits on Touch of Death, and choosing it adds the
//     die to that hit's damage. The holder spends the die they hold and the
//     bard pays nothing more (the maintainer's ruling for wave 2 of the
//     2026-11-09 gap sweep: "through the path that already lets a holder
//     spend Bardic Inspiration on a roll").
//   - College of Eloquence, Unfailing Inspiration: "An inspiration die that
//     fails to change the outcome is not spent." The die a bard with the
//     feature gives is marked `unfailing`; added to a roll that still fails
//     its Difficulty Class or misses its Armor Class, it stays on its holder.
//
// The marks are written where the die is given (resource-tools.ts) and live
// on the die's condition (schemas/condition-meta.ts), so a die keeps what its
// giver could do when it was given. Pure.

import type { AfterRollOption } from "@/lib/dm/after-roll-logic";
import { rowWords } from "@/lib/dm/after-roll-table";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

type Giver = { features?: CharacterSheet["features"]; feats?: CharacterSheet["feats"] };
type Holder = Pick<CharacterSheet, "conditions"> & { conditionMeta?: CharacterSheet["conditionMeta"] };
type DieMarks = { combat?: boolean; unfailing?: boolean };

const BARDIC_DIE = /^bardic inspiration \((d\d{1,2})\)$/i;

// The marks a die given by this bard carries.
export function givenDieMarks(bard: Giver): DieMarks {
  return {
    ...(holdsFeature(bard, "Combat Inspiration") ? { combat: true } : {}),
    ...(holdsFeature(bard, "Unfailing Inspiration") ? { unfailing: true } : {}),
  };
}

function marksOf(sheet: Holder, condition: string): DieMarks {
  return ((sheet.conditionMeta ?? {}) as Record<string, DieMarks | undefined>)[condition] ?? {};
}

// The held Bardic Inspiration die that may ride a damage roll, or null.
export function combatDie(sheet: Holder): { condition: string; die: string } | null {
  for (const condition of sheet.conditions ?? []) {
    const match = BARDIC_DIE.exec(condition.trim());
    if (match && marksOf(sheet, condition).combat === true) {
      return { condition, die: match[1].toLowerCase() };
    }
  }
  return null;
}

// The choice a hit waits on for a creature holding a Valor bard's die
// (after-roll-logic.ts afterAttackOptions).
export function combatInspirationOption(sheet: Holder): AfterRollOption[] {
  const held = combatDie(sheet);
  return held
    ? [{ id: "combat_inspiration", ...rowWords("combat_inspiration", { amount: held.die }) }]
    : [];
}

// Whether a die just added to a roll stays with its holder: an unfailing die
// on a roll that still falls short of `target` (the Difficulty Class, or the
// Armor Class of an attack). A roll with no target cannot be judged, so its
// die is spent as any other.
export function unfailingDieKept(sheet: Holder, condition: string, total: number, target: number | null | undefined): boolean {
  return typeof target === "number" && total < target && marksOf(sheet, condition).unfailing === true;
}
