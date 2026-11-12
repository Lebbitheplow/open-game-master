// Performance of Creation (College of Creation 3): "Create a nonmagical item
// worth no more than 20 times your bard level as an action". The item the
// player names (the spend's variant; the Hand's card asks for it) goes into
// the bard's pack, weighed at its list price (the content pack's, else the SRD
// 5.1 gear table's) and refused above the limit with nothing spent. An item
// no list prices is the GM's to weigh, and the result says so. Before this
// the use went and the item was the GM's to write onto the sheet by hand.
//
// Called by authored-spend-effects.ts resolveSpendEffect (kind create_item).

import { addRowMath } from "@/lib/dm/mutation-math";
import { packListCp } from "@/lib/dm/trade-value";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

export function createItem(ctx: SpendContext, does: Extract<SpendDoes, { kind: "create_item" }>): ToolError | { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  const name = (ctx.args.variant ?? "").trim();
  const limitGp = does.gpPerLevel * ctx.held.level;
  if (!name) {
    return { error: `${ctx.spend.name} makes the nonmagical item the player names, worth up to ${limitGp} gp: pass its name as variant. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
  }
  const priceCp = packListCp(name);
  if (priceCp !== null && priceCp > limitGp * 100) {
    return { error: `${name} is worth ${priceCp / 100} gp, more than the ${limitGp} gp ${ctx.spend.name} can make at bard level ${ctx.held.level}. Nothing was spent.`, refused: "rules" };
  }
  return {
    patch: { equipment: addRowMath(ctx.sheet.equipment, { name, qty: 1 }) },
    result: {
      created: `${name} shimmers into being in ${ctx.sheet.name}'s hands and is in their pack.`,
      worth: priceCp !== null ? `${priceCp / 100} gp, within the ${limitGp} gp limit` : `no list price; the GM holds it to ${limitGp} gp and nonmagical`,
    },
  };
}
