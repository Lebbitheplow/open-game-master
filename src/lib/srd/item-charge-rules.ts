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
import { textKey } from "@/lib/language/text-logic";

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

// A row whose most is dice (a Luck Blade's 1d4 - 1, a Necklace of Fireballs'
// 1d6 + 3) with its starting charges rolled, as it is granted: every door
// that adds an equipment row writes through the sheet store's one pack
// settle (src/lib/db/sheets.ts capAttunement: handle_item, a purchase, the
// party stash, the sheet route, the builder's starting gear, the workshop),
// which calls this. Rolled at first use instead, neither the sheet nor the
// Hand knew the count, and a card was dealt for a use the roll then refused.
// `roll` is passed in so this module stays pure. A row that already has a
// count, or a fixed most, comes back as it was.
export function withStartingCharges<T extends Pick<EquipmentItem, "name" | "slug" | "gear" | "charges">>(item: T, roll: (expression: string) => number): T {
  if (typeof item.charges === "number") {
    return item;
  }
  const rule = chargeRuleOf(item);
  if (!rule || typeof rule.max !== "string") {
    return item;
  }
  return { ...item, charges: Math.max(0, Math.min(chargeMax(rule), roll(rule.max))) };
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
  return `${item.name} has ${chargeNoun(rule, left)} left and this use needs ${count}. ${regainSentence(rule)}`;
}

// A count in the rule's own unit: "3 charges", "1 minute", "0 uses".
export function chargeNoun(rule: Pick<ChargeRule, "unit">, count: number): string {
  const unit = rule.unit ?? "charge";
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

// When the count comes back, said on its refusal and its use's note.
export function regainWhen(rule: ChargeRule): string | null {
  if (rule.regainDays) {
    return `${rule.regainDays} days after the last is spent`;
  }
  if (!rule.regain) {
    return null;
  }
  return rule.regainOn === "long_rest" ? "when its owner finishes a long rest" : `at ${rule.regainAtDusk ? "dusk" : "dawn"}`;
}

// When an item's charges come back, for its refusal: at dawn (or dusk), at
// a long rest, days after it empties, or never.
export function regainSentence(rule: ChargeRule): string {
  const units = `${rule.unit ?? "charge"}s`;
  const when = regainWhen(rule);
  if (!when) {
    return `It does not regain ${units}.`;
  }
  return rule.regain && rule.regain !== "all" ? `It regains ${rule.regain} ${units} ${when}.` : `It regains all its ${units} ${when}.`;
}

// The properties of an item that each keep a count of their own (SRD 5.1,
// Staff of Thunder and Lightning: "When one of these properties is used, it
// can't be used again until the next dawn"), or null.
export function itemPowersOf(item: Pick<EquipmentItem, "name" | "slug" | "gear">): Record<string, ChargeRule> | null {
  return gearDefOfRow(item)?.powers ?? null;
}

// The property a name names, as the SRD heads it ("thunderclap" is the
// staff's Thunderclap), or null.
export function powerNamed(item: Pick<EquipmentItem, "name" | "slug" | "gear">, name: string | undefined): { name: string; rule: ChargeRule } | null {
  const powers = itemPowersOf(item);
  const key = textKey(name ?? "");
  const found = powers && key ? Object.keys(powers).find((power) => textKey(power) === key) : undefined;
  return powers && found ? { name: found, rule: powers[found] } : null;
}

// The row as one property's count reads it, so chargesLeft, chargesShort and
// spendChargesMath take it as they take a charged row.
export function powerView(item: Pick<EquipmentItem, "name" | "powerCharges">, power: string): Pick<EquipmentItem, "name" | "charges"> {
  const left = item.powerCharges?.[power];
  return { name: `${item.name}'s ${power}`, ...(typeof left === "number" ? { charges: left } : {}) };
}

// The properties' counts a dawn (or a long rest) gives back: each property
// whose count returns then is whole again. The row as it was when none do.
export function powersRefilled<T extends Pick<EquipmentItem, "name" | "slug" | "gear" | "powerCharges">>(item: T, at: "dawn" | "long_rest"): T {
  const powers = itemPowersOf(item);
  if (!powers || !item.powerCharges) {
    return item;
  }
  const kept = Object.fromEntries(
    Object.entries(item.powerCharges).filter(([power]) => {
      const rule = powers[power];
      return !rule?.regain || (rule.regainOn === "long_rest") !== (at === "long_rest");
    }),
  );
  if (Object.keys(kept).length === Object.keys(item.powerCharges).length) {
    return item;
  }
  const { powerCharges: _was, ...rest } = item;
  void _was;
  return (Object.keys(kept).length ? { ...rest, powerCharges: kept } : rest) as T;
}

// The pack after a long rest: what returns "when you finish a long rest"
// (Boots of Speed's ten minutes) is whole again. Null when nothing changed.
export function rechargeAtLongRest(equipment: readonly EquipmentItem[] | undefined): EquipmentItem[] | null {
  if (!equipment?.length) {
    return null;
  }
  let changed = false;
  const out = equipment.map((row) => {
    const item = powersRefilled(row, "long_rest");
    const rule = chargeRuleOf(item);
    const whole = rule?.regainOn === "long_rest" && typeof item.charges === "number" && item.charges < chargeMax(rule) ? { ...item, charges: chargeMax(rule) } : item;
    if (whole !== row) {
      changed = true;
    }
    return whole;
  });
  return changed ? out : null;
}
