// A College of Spirits bard's Tales from Beyond. The Spirit Tales table of
// the subclass's own book is not open content, so the table here is this
// server's own: twelve tales, each a thing the engine already resolves (a
// save against damage or a condition, or healing), with its numbers written
// in. "Expend one use of your Bardic Inspiration and roll on the Spirit Tales
// table using your Bardic Inspiration die ... You retain the tale in mind
// until you bestow the tale's effect or you finish a short or long rest ...
// you can use an action to choose one creature you can see within 30 feet of
// you (this can be you) ... rolling on the Spirit Tales table immediately ends
// the effect of the previous tale."
//
// use_resource "Tales from Beyond" rolls the die and keeps the tale as the
// condition "spirit tale" (its number in the meta), which a rest ends; use_resource "Release Tale"
// (authored-spend-effects.ts) plays the tale held on the creature named and
// lets it go.

import { rollCard } from "@/lib/dm/roll-card";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { SPIRIT_TALE, SPIRIT_TALES, dieAt } from "@/lib/srd/spirit-tales-table";

// The table lives with the Hand's reading of it (src/lib/srd/spirit-tales-table.ts).
export { SPIRIT_TALE, SPIRIT_TALES, heldTale } from "@/lib/srd/spirit-tales-table";

// The Bardic Inspiration die rolled on the table.
export function drawTale(ctx: SpendContext): number {
  const die = dieAt(ctx.held.level);
  return Math.max(1, Math.min(SPIRIT_TALES.length, Number(rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: Tales from Beyond`, `1${die}`, null).total)));
}

// use_resource "Tales from Beyond": the die rolled, the tale kept (the one
// held before ends).
export function tellTale(ctx: SpendContext): ToolError | { patch: FullPatchSheetInput; result: Record<string, unknown> } {
  const { sheet } = ctx;
  const die = dieAt(ctx.held.level);
  const rolled = drawTale(ctx);
  const tale = SPIRIT_TALES[rolled - 1];
  const kept = sheet.conditions.filter((entry) => !isConditionNamed(entry, SPIRIT_TALE));
  const meta = Object.fromEntries(Object.entries(sheet.conditionMeta ?? {}).filter(([name]) => !isConditionNamed(name, SPIRIT_TALE)));
  return {
    patch: { conditions: [...kept, SPIRIT_TALE], conditionMeta: { ...meta, [SPIRIT_TALE]: { untilRestEnds: true, tale: rolled } } as FullPatchSheetInput["conditionMeta"] },
    result: {
      rolled,
      tale: `${tale.name} (${rolled} on the ${die}): ${tale.told}. use_resource "Release Tale" with an action plays it on one creature within 30 feet (${tale.helps ? "targetCharacterId, the bard by default" : "targetEnemyId"}); it is kept until then or a rest.`,
    },
  };
}
