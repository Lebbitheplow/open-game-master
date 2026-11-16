// use_item for an item property that keeps a count of its own: SRD 5.1,
// Staff of Thunder and Lightning, "When one of these properties is used, it
// can't be used again until the next dawn"; Rod of Lordly Might's Drain
// Life, Paralyze and Terrify; a Luck Blade's Luck. The property's count is
// a charge rule like any item's (src/lib/srd/magic-gear.ts GearDef.powers),
// spent and refused by the same charge machinery (item-charges.ts) and given
// back at dawn by advanceClock, or at the end of a long rest. Before it
// nothing counted these properties, and the GM used them as often as it
// liked.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getClock } from "@/lib/db/clock";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { spendChargesMath, writeCharges } from "@/lib/dm/item-charges";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { itemBarrier } from "@/lib/srd/item-barrier";
import { chargeNoun, chargesShort, powerView, regainWhen } from "@/lib/srd/item-charge-rules";
import type { ChargeRule } from "@/lib/srd/magic-gear";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// Why this property cannot be used now, or null: its count spent.
export function powerShort(item: EquipmentItem, power: { name: string; rule: ChargeRule }, count = 1): string | null {
  return chargesShort(powerView(item, power.name), power.rule, count);
}

// The row with `count` of this property's uses spent. One that waits hours
// from its last use (ChargeRule.regainHours: the Orb of Dragonkind's Call
// Dragons) keeps the clock's minute `now` it emptied, for advanceClock.
export function withPowerSpent(item: EquipmentItem, power: { name: string; rule: ChargeRule }, count = 1, now?: number): EquipmentItem {
  const math = spendChargesMath({ qty: 1, ...powerView(item, power.name) }, power.rule, count);
  const left = "error" in math ? 0 : math.charges;
  const waits = power.rule.regainHours && left === 0 && now !== undefined ? { powersEmptiedAt: { ...(item.powersEmptiedAt ?? {}), [power.name]: now } } : {};
  return { ...item, powerCharges: { ...(item.powerCharges ?? {}), [power.name]: left }, ...waits };
}

export function itemPowerUse(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  carried: EquipmentItem,
  power: { name: string; rule: ChargeRule },
  uses: number | undefined,
  { dryRun = false }: { dryRun?: boolean } = {},
): ToolResult {
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "unconscious at 0 hit points"} and cannot use ${carried.name}.`, refused: "rules" };
  }
  const barrier = itemBarrier(sheet, carried);
  if (barrier) {
    return { error: barrier, refused: "rules" };
  }
  const count = Math.max(1, Math.round(uses ?? 1));
  const short = powerShort(carried, power, count);
  if (short) {
    return { error: `${short} Nothing was spent.`, refused: "rules" };
  }
  // In a fight it takes the action, or the bonus action, its text names; one
  // that rides a hit or needs no action ("free") takes nothing more.
  const encounter = getActiveEncounter(campaign.id);
  let budget: ReturnType<typeof budgetFor> = null;
  if (encounter && power.rule.activation !== "free") {
    const kind = power.rule.activation === "bonus" ? "bonus" : "action";
    const able = canAct({ sheet, encounter, kind });
    if (!able.ok) {
      return toolError(able);
    }
    const heldOff = heldTurnRefusal(encounter, sheet);
    if (heldOff) {
      return heldOff;
    }
    budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
    if (budget) {
      const spent = spendAction(budget, kind, `using ${carried.name}'s ${power.name}`, sheet.name);
      if (!spent.ok) {
        return toolError(spent);
      }
      budget = spent.budget;
    }
  }
  if (dryRun) {
    return { ok: true, dryRun: true, used: carried.name, power: power.name };
  }
  if (encounter && budget) {
    storeBudget(encounter, budget);
  }
  const after = withPowerSpent(carried, power, count, getClock(campaign.id).instant);
  const left = after.powerCharges?.[power.name] ?? 0;
  writeCharges(campaign.id, sheet, sheet.equipment.map((item) => (item === carried ? after : item)), "use_item", `${carried.name}: ${power.name}`, turnId);
  const when = regainWhen(power.rule);
  return {
    ok: true,
    used: carried.name,
    power: power.name,
    usesLeft: left,
    note: `${carried.name}'s ${power.name} is used: ${chargeNoun(power.rule, left)} left${when ? `, back ${when}` : ""}. No spell slot is spent. Resolve what it does with the tool for it (aoe_damage, apply_damage, set_condition, heal) and narrate it.`,
  };
}
