// The authored spends the counter repair added (src/lib/srd/authored-effects-
// sweep-counters.ts) whose effect no other resolver held: a spell slot given
// back to a creature touched (Bolstering Magic). It refuses before it writes,
// as every resolver of src/lib/dm/authored-spend-effects.ts does.
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { rollCard } from "@/lib/dm/roll-card";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// "it rolls a d3 and regains one expended spell slot of a level equal to the
// number rolled or lower" (TCoE, Bolstering Magic): the highest it can.
export function regainSlot(ctx: SpendContext, does: Extract<SpendDoes, { kind: "regain_slot" }>): Resolution {
  const target = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : ctx.sheet;
  if (!target || target.campaignId !== ctx.campaign.id) {
    return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
  }
  const slots = target.spellcasting?.slots ?? {};
  if (!Object.values(slots).some((slot) => slot.used > 0)) {
    return { error: `${target.name} has no spent spell slot for ${ctx.spend.name} to give back. Nothing was spent.`, refused: "rules" };
  }
  const rolled = Number(rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.spend.name}: the slot's level`, does.die, null).total);
  const level = [...Array(Math.max(0, rolled)).keys()].map((index) => rolled - index).find((entry) => (slots[String(entry)]?.used ?? 0) > 0);
  if (!level || !target.spellcasting) {
    return { result: { regained: `${target.name} rolls ${rolled} and has no spent slot of that level or lower: nothing comes back.` } };
  }
  const slot = slots[String(level)];
  const spellcasting = { ...target.spellcasting, slots: { ...slots, [String(level)]: { ...slot, used: slot.used - 1 } } };
  if (target.id === ctx.sheet.id) {
    return { patch: { spellcasting }, result: { regained: `${target.name} regains a level ${level} spell slot (rolled ${rolled}).` } };
  }
  const updated = patchSheet(target.id, { spellcasting });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  return { result: { regained: `${target.name} regains a level ${level} spell slot (rolled ${rolled}).` } };
}
