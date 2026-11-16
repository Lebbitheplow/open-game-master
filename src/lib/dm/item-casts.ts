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
import { bonusSpellProblem, openCastOf, withSpellMarks } from "@/lib/dm/cast-rules";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { concentratesAtSlot } from "@/lib/srd/spell-duration";
import type { ToolError } from "@/lib/dm/tool-errors";

// A spell read from a scroll or let loose from a wand on the caster's own turn
// is a spell cast, so the bonus-action spell rule (cast-rules.ts
// bonusSpellProblem) asks it before use_item spends anything, and the cast
// marks the turn as a slot's casting does. `time` is the turn's part the item
// takes: the action, or the bonus action its text names.
export function itemSpellTurnProblem(budget: TurnBudget | null, who: string, spell: string, level: number, time: "action" | "bonus"): ToolError | null {
  const ruled = budget ? bonusSpellProblem(budget.oncePerTurn, { who, name: spell, time, levelled: level > 0 }) : null;
  return ruled ? { ...ruled, error: `${ruled.error} Nothing was spent.` } : null;
}

// Marks the caster's own turn with the spell an item just cast (off their
// turn, a readied release, there is none to mark).
export function markItemSpellOnTurn(campaignId: string, sheet: CharacterSheet, level: number, time: "action" | "bonus") {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.status === "active" ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
  if (encounter && budget) {
    storeBudget(encounter, withSpellMarks(budget, time, level > 0));
  }
}

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
  if (input.concentration === true || concentratesAtSlot(facts?.runsAs ?? name, facts?.concentration === true, cast.level)) {
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
