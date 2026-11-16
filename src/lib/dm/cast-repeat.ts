// A concentration spell already running whose effect comes again on a later
// turn (Call Lightning's bolt, Heat Metal, Moonbeam): not a new casting, so
// no slot, no material, and concentration is not reset. Split from
// cast-guard.ts, which sends a repeat here before any refusal of a new
// casting is asked.

import type { Encounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import type { CastInput, CastResult } from "@/lib/dm/cast-guard";
import { spendAction } from "@/lib/dm/action-budget";
import { lastCastSlot } from "@/lib/dm/spell-effects";
import { runningItemSpell } from "@/lib/srd/item-cast-credit";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { toolError } from "@/lib/dm/tool-errors";

// The effect of a concentration spell coming again (Call Lightning's next
// bolt): the caster must still be up and able, and the turn pays what the
// spell says; the slot level is the one the casting was made from, read
// from the audit trail, so an upcast bolt stays upcast.
export function repeatSpell(
  sheet: CharacterSheet,
  // The encounter when a fight with turns is running, null otherwise.
  fight: Encounter | null,
  facts: SpellFacts | null,
  name: string,
  cost: "action" | "bonus" | "free",
  input: CastInput,
): CastResult {
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "at 0 HP"}, and ${name} ended with their concentration.`, refused: "rules" };
  }
  // A spell an item cast has no slot on the audit trail: the item's level.
  const slotLevel = runningItemSpell(sheet, name)?.level ?? lastCastSlot(sheet.id, name) ?? facts?.level ?? null;
  const repeatNote = `${name} is already cast and held by ${sheet.name}'s concentration: this is its effect again, and no slot is spent.`;
  if (cost === "free" || !fight) {
    return input.dryRun
      ? { ok: true, dryRun: true, spell: name, slotLevel, repeat: true }
      : { ok: true, spell: name, slotLevel, repeat: repeatNote };
  }
  const able = canAct({ sheet, encounter: fight, kind: cost === "bonus" ? "bonus" : "action" });
  if (!able.ok) {
    return toolError(able);
  }
  const heldOff = heldTurnRefusal(fight, sheet);
  if (heldOff) {
    return heldOff;
  }
  const budget = budgetFor(fight, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  // Not a casting, so the turn's action or bonus action is spent as for any
  // other use of it. Charged as a cantrip with that casting time, the repeat
  // of Heat Metal or Flaming Sphere on the bonus action was refused after a
  // levelled spell and barred one after it (SRD 5.1, Casting Time, Bonus
  // Action limits spells cast, and this is none), and Quickened Spell's mark
  // was spent on it.
  const spent = budget ? spendAction(budget, cost === "bonus" ? "bonus" : "action", `${name} again`, sheet.name) : null;
  if (spent && !spent.ok) {
    return toolError(spent);
  }
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel, repeat: true };
  }
  if (spent) {
    storeBudget(fight, spent.budget);
  }
  return {
    ok: true,
    spell: name,
    slotLevel,
    repeat: repeatNote,
    cost: cost === "bonus" ? "their bonus action" : "their action",
  };
}
