// Field Fabricator's build (salvage tech 11; the device itself is
// src/lib/srd/genre-gb-device.ts): out of a fight, once a long rest, the
// tech builds one device holding a 2nd-level wizard spell (a tech effect is a
// wizard-list spell, Rebuilt Arsenal) named in `variant`, with the tech's own
// save DC and spell attack. A new device replaces the old one.
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { computeSheetDerived } from "@/lib/srd";
import { checklistSpell } from "@/lib/srd/spell-lists";
import { deviceName, isFabricatedDevice } from "@/lib/srd/genre-gb-device";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";

export function fieldFabricator(ctx: SpendContext): ToolError | { result: Record<string, unknown>; patch: FullPatchSheetInput } {
  const spell = checklistSpell(ctx.args.variant ?? "");
  if (!spell || spell.level !== 2 || !spell.classes.includes("wizard")) {
    return { error: `Field Fabricator duplicates a 2nd-level tech effect: name a 2nd-level wizard spell in variant (${ctx.args.variant ? `${ctx.args.variant} is not one` : "none was named"}). Nothing was spent.`, retry: true };
  }
  const derived = computeSheetDerived(ctx.sheet);
  const int = derived.abilityMods.int;
  const name = deviceName(spell.name, 8 + derived.proficiencyBonus + int, derived.proficiencyBonus + int);
  const kept = ctx.sheet.equipment.filter((item) => !isFabricatedDevice(item));
  return {
    patch: { equipment: [...kept, { name, qty: 1 }] },
    result: { built: name, note: `Anyone carrying it can use it (use_item with the spell) to cast ${spell.name} once from it; it falls apart at the end of the next long rest.${kept.length < ctx.sheet.equipment.length ? " The old device is gone." : ""}` },
  };
}
