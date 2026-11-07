// A spell cast from a scroll or a charged item, resolved by the tool that
// applies it. use_item already spent the scroll or the charges, and the
// action it took to use them, and wrote a credit for the spell
// (src/lib/srd/item-cast-credit.ts); the cast guard hands the cast here when
// that credit is waiting, so nothing is spent twice.
//
// SRD 5.1, Magic Items, Spells: the spell "doesn't expend any of the user's
// spell slots, and requires no components", uses its normal duration, "and
// the user of the item must concentrate if the spell requires
// concentration". A spell scroll's spell is cast the same way.

import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import type { ItemCast } from "@/lib/srd/item-cast-credit";
import { droppedLine, setConcentration } from "@/lib/dm/concentration";
import { endInvisibilityOnCast } from "@/lib/dm/attack-marks";
import { noteRunning, takeFromRing } from "@/lib/dm/ring-store";
import { getActiveEncounter } from "@/lib/db/encounters";
import { openCastOf } from "@/lib/dm/cast-rules";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";

// The item whose casting of this spell still holds rays, darts or targets this
// turn (cast-guard.ts openItemShares), and the level it was cast at, or null.
// Its later calls are that casting, so a tool that asks for a Spellcasting
// feature or a spell list first lets them through, as it lets through the call
// that took the item's credit.
export function itemCastOpen(campaignId: string, sheet: CharacterSheet, spell: string): { item: string; level: number } | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || encounter.status !== "active") {
    return null;
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  const open = openCastOf(budget, spell);
  return open?.item ? { item: open.item, level: open.slotLevel ?? 1 } : null;
}

export function castFromItem(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  facts: SpellFacts | null,
  name: string,
  cast: ItemCast,
  input: { dryRun?: boolean; concentration?: boolean },
): Record<string, unknown> {
  const numbers = {
    ...(cast.saveDc ? { saveDc: cast.saveDc } : {}),
    ...(cast.attackBonus ? { attackBonus: cast.attackBonus } : {}),
  };
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel: cast.level, fromItem: cast.item, ...numbers };
  }
  const result: Record<string, unknown> = {
    ok: true,
    spell: name,
    slotLevel: cast.level,
    fromItem: cast.item,
    slot: `cast from ${cast.item}: no spell slot spent`,
    ...numbers,
  };
  if (input.concentration === true || facts?.concentration === true) {
    const { displaced } = setConcentration(campaign, turnId, sheet.id, name, cast.level);
    result.concentration = true;
    if (displaced) {
      result.droppedConcentration = droppedLine(displaced, name);
    }
  }
  if (cast.storedIn) {
    takeFromRing(campaign, turnId, sheet.id, cast.storedIn, name);
  }
  noteRunning(sheet.id, cast);
  // Casting a spell from an item is casting a spell: Invisibility ends.
  endInvisibilityOnCast(campaign.id, sheet.id);
  return result;
}
