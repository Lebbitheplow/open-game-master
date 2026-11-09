// How many charges a carried magic item holds, and its most: pure reads of
// the equipment row and the generated rule (src/lib/srd/magic-gear.ts).
//
// Split out of src/lib/dm/item-charges.ts (which re-exports them and keeps
// the spending and the dawn regain) so the character sheet can show "4/7"
// with the engine's own count, without importing a module that reaches the
// database.
import { gearDefOfRow, type ChargeRule } from "@/lib/srd/magic-gear";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import { beadCount, beadsOf } from "@/lib/srd/prayer-beads";

// The charge rule of a carried row, or null for an item with no charges.
// A workshop item's own rule rides on its line (gearDefOfRow); a row with no
// block of its own is the table's by name.
export function chargeRuleOf(item: Pick<EquipmentItem, "name" | "slug" | "gear">): ChargeRule | null {
  const rule = gearDefOfRow(item)?.charges ?? null;
  // A Necklace of Prayer Beads whose beads the GM has named holds that many,
  // not the 1d4 + 2 its text rolls for (src/lib/srd/prayer-beads.ts).
  const beads = rule ? beadsOf(item.name) : null;
  return rule && beads ? { ...rule, max: beadCount(beads) } : rule;
}

// The most an item can hold: its number, or the most its dice can roll (a
// Luck Blade's 1d4 - 1 is at most 3).
export function chargeMax(rule: ChargeRule): number {
  if (typeof rule.max === "number") {
    return rule.max;
  }
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(rule.max.replace(/\s+/g, ""));
  return match ? Math.max(0, Number(match[1]) * Number(match[2]) + Number(match[3] ?? 0)) : 0;
}

// How many charges a row holds now. A row that never recorded a count is
// full; one whose most is dice (rolled once, when the item is first used)
// reads its count from `rolled`.
export function chargesLeft(item: Pick<EquipmentItem, "charges">, rule: ChargeRule, rolled?: number): number {
  if (typeof item.charges === "number") {
    return item.charges;
  }
  return typeof rule.max === "number" ? rule.max : Math.max(0, rolled ?? 0);
}

// Why this use cannot be paid, or null: the words use_item refuses with and the
// card greys with. A count still to be rolled (a Necklace of Fireballs' first use)
// and a Wind Fan, which may be used past its last charge at a risk, are not short.
export function chargesShort(item: Pick<EquipmentItem, "name" | "charges">, rule: ChargeRule, count: number, rolled?: number): string | null {
  if (typeof item.charges !== "number" && typeof rule.max === "string" && rolled === undefined) {
    return null;
  }
  const left = chargesLeft(item, rule, rolled);
  if (count <= left || (rule.overuseRisk && left === 0)) {
    return null;
  }
  const regains = rule.regain
    ? rule.regain === "all"
      ? `It regains all its charges at ${rule.regainAtDusk ? "dusk" : "dawn"}.`
      : `It regains ${rule.regain} charges at ${rule.regainAtDusk ? "dusk" : "dawn"}.`
    : "It does not regain charges.";
  return `${item.name} has ${left} charge${left === 1 ? "" : "s"} left and this use needs ${count}. ${regains}`;
}
