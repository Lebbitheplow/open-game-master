// A genre counter whose use ends a condition (WAVE2 D5): one on a creature
// in reach, or every one the text names on each ally in reach.
//
//   Break the Delusion (alienist)  "end one charm, fear, or illusion effect on
//                                  a creature within 30 ft"
//   Deliverance (waste preacher)   "end one fear, charm, or curse effect on a
//                                  creature within 30 ft"
//   Revelation (waste preacher)    "allies within 60 ft regain 5d8 HP and are
//                                  freed of fear, charm, and exhaustion by one
//                                  level" (the hit points: authored-heal-area.ts)
//
// An illusion or a curse is no condition the board holds, so the engine ends
// charmed and frightened (and a curse the GM laid by that name); what the
// creature carries beyond them is the GM's. src/lib/dm/authored-spend-effects.ts
// resolveSpendEffect sends the "cure" kind here. A single-target cure refuses
// a creature beyond reach or carrying none of them, spending nothing.
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditions } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";

export type CureDoes = { kind: "cure"; ends: string[]; rangeFt: number; every?: boolean; exhaustion?: number };

function cureOne(ctx: SpendContext, target: CharacterSheet, does: CureDoes): string | null {
  const found = does.ends.filter((name) => target.conditions.some((entry) => isConditionNamed(entry, name)));
  // One effect: the one the call names as its variant, else the first held.
  const named = found.filter((name) => isConditionNamed(ctx.args.variant ?? "", name));
  const ending = does.every ? found : [...named, ...found].slice(0, 1);
  const exhausted = does.exhaustion && (target.exhaustion ?? 0) > 0 ? Math.min(does.exhaustion, target.exhaustion ?? 0) : 0;
  if (!ending.length && !exhausted) {
    return null;
  }
  const held = target.conditions.filter((entry) => ending.some((name) => isConditionNamed(entry, name)));
  const left = removeConditions(target.conditions, target.conditionMeta, held);
  const updated = patchSheet(target.id, { conditions: left.conditions, conditionMeta: left.meta, ...(exhausted ? { exhaustion: (target.exhaustion ?? 0) - exhausted } : {}) });
  if (updated) {
    publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
  }
  return [held.length ? `${target.name} is freed of ${held.join(" and ")}` : "", exhausted ? `${target.name} loses ${exhausted} level of exhaustion` : ""].filter(Boolean).join("; ");
}

export function genreCure(ctx: SpendContext, does: CureDoes): ToolError | { result: Record<string, unknown> } {
  const { sheet } = ctx;
  const inReach = (target: CharacterSheet) => target.id === sheet.id || !ctx.encounter || withinFeet(ctx.encounter.id, sheet.id, target.id, does.rangeFt);
  if (does.every) {
    const lines = listSheets(ctx.campaign.id)
      .map((stale) => getSheetById(stale.id) ?? stale)
      .filter((target) => !target.deathSaves?.dead && inReach(target))
      .map((target) => cureOne(ctx, target, does))
      .filter(Boolean);
    return { result: { cured: lines.length ? lines : "nobody in reach carries what it ends" } };
  }
  const target = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
  if (!target) {
    return { error: `${ctx.spend.name} ends an effect on a character: pass targetCharacterId from GAME STATE. Nothing was spent.`, retry: true };
  }
  if (!inReach(target)) {
    return { error: `${target.name} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const line = cureOne(ctx, target, does);
  if (!line) {
    return { error: `${target.name} carries none of what ${ctx.spend.name} ends (${does.ends.join(", ")}). Nothing was spent.`, refused: "rules" };
  }
  return { result: { cured: line } };
}
