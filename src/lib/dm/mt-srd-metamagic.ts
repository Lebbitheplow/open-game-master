// The Metamagic options a sorcerer pays for, written to the sheet and taken
// off it: the spend marks the option, and the cast, the spell's first save
// and its damage roll each take what they use. The rule text, the marks and
// every reader of them are in src/lib/dm/mt-srd-metamagic-logic.ts (pure, so
// the Hand's spell card reads the same helpers); they are handed on from
// here, so a cast path imports one module. A new option, or a new cast
// path, goes through these two: nothing else reads the marks.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { AFTER_CAST, EMPOWERED, HEIGHTENED, PREFIX, TWINNED, charismaCount, isMark, paid, twinPlan, type TwinAsk } from "@/lib/dm/mt-srd-metamagic-logic";
import { textKey } from "@/lib/language/text-logic";
import { optionsOfKind } from "@/lib/srd/options";

export { cardMetamagic, carefulIds, empoweredLine, extendedMeta, extendedRounds, factsAsCast, metamagicPaid, secondOptionProblem, secondTargetProblem, subtleSpellPaid, twinExtra, type TwinAsk } from "@/lib/dm/mt-srd-metamagic-logic";

// What was paid rides the mark: the points in `slotLevel` (Twinned Spell's
// are the level of the spell they pay for) and the pool in `source`.
type Paid = { points?: number; pool?: string };

function write(campaign: Pick<Campaign, "id">, sheetId: string, change: (conditions: string[]) => string[], add?: string, paidWith: Paid = {}, pool?: { id: string; delta: number }) {
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const conditions = change(fresh.conditions);
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap) };
  for (const key of Object.keys(meta)) {
    if (isMark(key) && !conditions.some((entry) => textKey(entry) === textKey(key))) {
      delete meta[key];
    }
  }
  if (add) {
    meta[add] = { rounds: 1, ...(paidWith.points ? { slotLevel: paidWith.points } : {}), ...(paidWith.pool ? { source: paidWith.pool } : {}) };
  }
  // Points given back, or the rest of a price charged (Twinned Spell).
  const counter = pool ? fresh.resources?.[pool.id] : undefined;
  const resources = pool && counter ? { ...fresh.resources, [pool.id]: { ...counter, used: Math.max(0, counter.used + pool.delta) } } : undefined;
  const updated = patchSheet(sheetId, { conditions, conditionMeta: meta, ...(resources ? { resources } : {}) });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The option is paid: the next spell takes it.
export function markMetamagic(campaign: Pick<Campaign, "id">, sheetId: string, option: string, paidWith: Paid = {}) {
  const mark = `${PREFIX}${option.toLowerCase()}`;
  write(campaign, sheetId, (conditions) => [...conditions.filter((entry) => textKey(entry) !== textKey(mark)), mark], mark, paidWith);
}

// After a spend went through: a variant that names a Metamagic option is
// marked, any other variant is not one.
export function markPaidOption(campaign: Pick<Campaign, "id">, sheetId: string, variant: string | undefined, paidWith: Paid = {}) {
  const option = variant?.trim() ? optionsOfKind("metamagic").find((entry) => textKey(entry.n) === textKey(variant)) : undefined;
  if (option) {
    markMetamagic(campaign, sheetId, option.n, paidWith);
  }
}

// ---- Empowered Spell ----

// The damage dice the spell's roll may throw again, taken off the sorcerer
// as the roll uses it: the option for rollExpression (src/lib/dice.ts).
export function empoweredRoll(campaign: Pick<Campaign, "id">, casterId: string): { empower?: number } {
  const sheet = getSheetById(casterId);
  if (!sheet || !paid(sheet).includes(EMPOWERED)) {
    return {};
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== EMPOWERED));
  return { empower: charismaCount(sheet) };
}

// ---- Twinned Spell ----

// The cast settles Twinned Spell: the price is the spell's level whatever
// the spend named (the rest charged, or the excess given back), and a spell
// that cannot be twinned gives every point back. The line for the result.
export function settleTwin(campaign: Pick<Campaign, "id">, casterId: string, spell: string, ask: TwinAsk): { extra: 0 | 1; note: string } | null {
  const sheet = getSheetById(casterId);
  const plan = sheet ? twinPlan(sheet, ask) : null;
  if (!sheet || !plan) {
    return null;
  }
  const delta = plan.problem ? -plan.paid : plan.price - plan.paid;
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== TWINNED), undefined, {}, { id: plan.pool, delta });
  if (plan.problem) {
    return { extra: 0, note: `Twinned Spell does not take ${spell}: ${plan.problem}. The ${plan.paid} sorcery point${plan.paid === 1 ? "" : "s"} paid for it ${plan.paid === 1 ? "is" : "are"} back, and the spell is cast on its one target.` };
  }
  const settled = delta > 0 ? ` (${delta} more charged: the price is the spell's level)` : delta < 0 ? ` (${-delta} given back: the price is the spell's level)` : "";
  return { extra: 1, note: `Twinned Spell: ${spell} takes a second creature in range, for ${plan.price} sorcery point${plan.price === 1 ? "" : "s"}${settled}. The second target is another creature, never the first again.` };
}

// Heightened Spell for the save a spell cast at one creature asks: the
// option on the roll, taken off the sorcerer as it is used.
export function heightenedSave(campaign: Pick<Campaign, "id">, casterId: string): { disadvantage?: true } {
  const sheet = getSheetById(casterId);
  if (!sheet || !paid(sheet).includes(HEIGHTENED)) {
    return {};
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => textKey(entry) !== HEIGHTENED));
  return { disadvantage: true };
}

// A spell was cast: what was paid for it is used. Where the spell's save and
// its damage are still to come (`resolvesAfter`: cast at a creature, an area,
// a spell attack), Heightened Spell and Empowered Spell wait for them.
export function clearCastMarks(campaign: Pick<Campaign, "id">, casterId: string, resolvesAfter = false) {
  const sheet = getSheetById(casterId);
  const kept = resolvesAfter ? AFTER_CAST : [];
  if (!sheet || !paid(sheet).some((entry) => !kept.includes(entry))) {
    return;
  }
  write(campaign, casterId, (conditions) => conditions.filter((entry) => !isMark(entry) || kept.includes(textKey(entry))));
}
