import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { instancesOf, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { trapAt } from "@/lib/srd/table-hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { rollCard } from "@/lib/dm/roll-card";
import { rollOn } from "@/lib/roll-labels";

// A trap's hold on a character (a falling net's restraint): a condition the
// trap lays on everyone it catches (conditionsAlways in
// src/lib/srd/trap-specs.ts), which the trap's own rule ends. SRD 5.1's
// falling net: "A creature can use its action to make a DC 10 Strength
// check, freeing itself or another creature within its reach on a success."
//
// The hold is kept by the engine (its instance names the trap as its
// source), so the model cannot lift it with clear_condition
// (src/lib/dm/ai-gate.ts); this is the action that does, through
// take_action escape, as a grapple and a spell's hold are escaped.

type TrapHold = { condition: string; trap: string; ability: "str" | "dex"; dc: number; hurts?: { dice: string; type: string } };

export function trapHoldOn(campaign: Campaign, sheet: CharacterSheet): TrapHold | null {
  const meta = sheet.conditionMeta as ConditionMetaMap;
  for (const condition of sheet.conditions) {
    for (const instance of instancesOf(meta[condition])) {
      const found = instance.source ? trapAt(instance.source, campaign.id) : null;
      const holds = found?.trap.conditionsAlways?.some((name) => name.toLowerCase() === condition.toLowerCase())
        || (found?.trap.heldOnFail === true && found.trap.condition?.toLowerCase() === condition.toLowerCase());
      if (found && holds) {
        // A trap that prints no escape is broken with Strength against its
        // own save DC, or DC 10 with none.
        const escape = found.trap.escape ?? { ability: "str" as const, dc: found.trap.save?.dc ?? 10 };
        return { condition, trap: found.name, ability: escape.ability, dc: escape.dc, ...(found.trap.escapeHurts ? { hurts: found.trap.escapeHurts } : {}) };
      }
    }
  }
  return null;
}

export function characterTrapEscape(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  spend: () => void,
): ToolResult {
  const hold = trapHoldOn(campaign, sheet);
  if (!hold) {
    return { error: `${sheet.name} is held by nothing they can break free of.`, refused: "rules" };
  }
  spend();
  const check = rollCharacterCheck(
    campaign,
    sheet,
    { ability: hold.ability, dc: hold.dc },
    `${sheet.name}: ${hold.ability.toUpperCase()} check to break free of the ${hold.trap}`,
  );
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  const escaped = !check.autoFailed && check.total >= hold.dc;
  // A hunting trap's jaws bite on each failed check (TrapSpec escapeHurts).
  const bitten = !escaped && hold.hurts
    ? rollCard(campaign, turn, sheet.id, "damage", rollOn(`${hold.trap} (${hold.hurts.dice} ${hold.hurts.type})`, [sheet.name]), hold.hurts.dice, null).total
    : 0;
  if (bitten > 0 && hold.hurts) {
    applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount: bitten, type: hold.hurts.type, noCreature: true, reason: hold.trap });
  }
  if (escaped) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [hold.condition]);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return {
    ok: true,
    action: "escape",
    check: `${check.total} vs DC ${hold.dc}`,
    success: escaped,
    note: escaped
      ? `${sheet.name} breaks free of the ${hold.trap}.`
      : `${sheet.name} is still ${hold.condition} by the ${hold.trap}${bitten ? `, and takes ${bitten} ${hold.hurts?.type} damage from it` : ""}.`,
  };
}
