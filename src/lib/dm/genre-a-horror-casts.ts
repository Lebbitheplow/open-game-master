// The horror spends whose use is a mark for a slotless cast and a price the
// holder pays as it is laid (WAVE2 D5): Bleeding Power (apostate 2), "cast a
// 1st-level stigmata without a slot; take 1d4 necrotic that cannot be
// reduced", and Deeper Scars (11), "up to 3rd-level stigmata; the backlash is
// 2d4 necrotic". The mark is the holder's for the turn; the next spell it
// fits costs no slot and clears it (src/lib/dm/genre-a-casts.ts). The
// backlash is the holder's own card and lands typeless, as Overchannel's does
// (caster-features.ts payOverchannel): nothing reduces it.
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { rollCard } from "@/lib/dm/roll-card";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The step of a level ladder the holder has reached.
const stepOf = (ladder: Array<[number, string]>, level: number) =>
  ladder.reduce((held, [at, value]) => (level >= at ? value : held), ladder[0]?.[1] ?? "");

export function layCastMark(ctx: SpendContext, does: Extract<SpendDoes, { kind: "cast_mark" }>): ToolError | { result: Record<string, unknown> } {
  const condition = stepOf(does.condition, ctx.held.level);
  const fresh = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const kept = fresh.conditions.filter((entry) => !isConditionNamed(entry, condition));
  const updated = patchSheet(fresh.id, { conditions: [...kept, condition], conditionMeta: { ...fresh.conditionMeta, [condition]: { rounds: does.rounds } } });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  const lines = [`${fresh.name}'s ${ctx.spend.name} is ready: their next spell it fits this turn costs no slot.`];
  if (does.backlash) {
    const dice = stepOf(does.backlash, ctx.held.level);
    const rolled = rollCard(ctx.campaign, ctx.turn, fresh.id, "damage", ctx.spend.name, dice, null).total;
    applyPcDamage(ctx.campaign, ctx.turnId, getSheetById(fresh.id) ?? fresh, { amount: rolled, reason: ctx.spend.name });
    lines.push(`${fresh.name} takes ${rolled} necrotic damage (${dice}), which nothing reduces.`);
  }
  return { result: { applied: lines } };
}
