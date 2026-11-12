// Bastion of Law (Clockwork Soul 6): "Spend 1 to 5 sorcery points to give a
// creature that many d8s to spend reducing damage, until your next long
// rest." The feature it condenses: an action, yourself or a creature within
// 30 feet; the ward lasts until you finish a long rest or use the feature
// again; when the warded creature takes damage it can expend any number of
// the dice, roll them, and reduce the damage by the total. The row was
// narrated ("the GM rolls the dice spent off the damage"): the points went
// and nothing held the dice.
//
// Laying it (layWard, from authored-spend-effects.ts, kind damage_ward):
// use_resource "Bastion of Law" with the points in amount (1 to 5) and the
// creature in targetCharacterId (none: the sorcerer), an action in a fight.
// The creature carries "bastion of law (Nd8)" until its next long rest (the
// rest's own rule for untilLongRest; the table rests together, so that is the
// sorcerer's rest too). An earlier ward of this sorcerer's ends, wherever it
// is. Beyond 30 feet on a board it is refused with nothing spent.
//
// Spending it (spendWardDice, from the use_resource arm of mutations.ts): the
// warded creature, which need not hold the feature, calls use_resource
// "Bastion of Law" with variant "reduce" and the dice in amount (1 when
// none). The dice are rolled and taken off the heaviest damage on record
// against it this turn, as a reduce reaction takes its own (last-hit.ts,
// reaction-refund.ts): the hit points come back, and the ward keeps the dice
// left. It costs no reaction and nothing of the turn, and answers one blow
// once. Ruling: the record is of attacks and falls, the damage the server can
// give back; with none open the dice are kept and the call refused.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { BASTION_OF_LAW, WARD_DIE, WARD_REDUCE, wardCondition, wardOn } from "@/lib/dm/ar-ws-bastion-logic";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { answeredBy, answerKey, cutBlow, freshLastHit, type LastHit } from "@/lib/dm/last-hit";
import { settleLastHit } from "@/lib/dm/reaction-refund";
import { rollCard } from "@/lib/dm/roll-card";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";

type Does = Extract<SpendDoes, { kind: "damage_ward" }>;
type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// The sheet's conditions with its ward changed to `dice` left (none: gone).
function withWard(sheet: CharacterSheet, dice: number, sourceId: string | null): FullPatchSheetInput {
  const held = wardOn(sheet);
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  const kept = held ? instancesOf(meta[held.condition])[0] : undefined;
  if (held) {
    delete meta[held.condition];
  }
  const conditions = sheet.conditions.filter((entry) => entry !== held?.condition);
  if (dice <= 0) {
    return { conditions, conditionMeta: meta };
  }
  const name = wardCondition(dice);
  return { conditions: [...conditions, name], conditionMeta: { ...meta, [name]: { ...(sourceId ? { source: sourceId } : kept?.source ? { source: kept.source } : {}), untilLongRest: true } } };
}

const wardOf = (sheet: CharacterSheet, sorcererId: string) => {
  const held = wardOn(sheet);
  return held && instancesOf((sheet.conditionMeta as ConditionMetaMap)[held.condition]).some((instance) => instance.source === sorcererId) ? held : null;
};

export function layWard(ctx: SpendContext, does: Does): Resolution {
  const { sheet, campaign, spend } = ctx;
  const target = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
  if (!target || target.campaignId !== campaign.id) {
    return { error: `${spend.name} wards a creature at the table: pass targetCharacterId, or none for ${sheet.name}. Nothing was spent.`, retry: true };
  }
  if (target.deathSaves?.dead) {
    return { error: `${target.name} is dead; ${spend.name} wards a living creature. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && target.id !== sheet.id && !withinFeet(encounter.id, sheet.id, target.id, does.rangeFt)) {
    return { error: `${target.name} is beyond ${does.rangeFt} feet of ${sheet.name}; ${spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  // "Until you use this feature again": the earlier ward ends, wherever it is.
  const ended: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const other = getSheetById(stale.id) ?? stale;
    if (other.id !== sheet.id && other.id !== target.id && wardOf(other, sheet.id)) {
      patchSheetAudited(campaign.id, other.id, withWard(other, 0, null), { kind: "use_resource", reason: `${spend.name}: ${sheet.name} lays the ward anew` });
      ended.push(other.name);
    }
  }
  const mine = wardOf(sheet, sheet.id);
  const line = `${target.name} is warded by ${ctx.units}${WARD_DIE}: when they take damage they may spend any of the dice to reduce it (use_resource "${BASTION_OF_LAW}", variant "${WARD_REDUCE}", the dice in amount), until their next long rest.`;
  const result = { ward: wardCondition(ctx.units), applied: [line, ...(ended.length || (mine && target.id !== sheet.id) ? [`The earlier ward on ${[...ended, ...(mine && target.id !== sheet.id ? [sheet.name] : [])].join(", ")} ends.`] : [])] };
  if (target.id === sheet.id) {
    return { patch: withWard(sheet, ctx.units, sheet.id), result };
  }
  patchSheetAudited(campaign.id, target.id, withWard(target, ctx.units, sheet.id), { kind: "use_resource", reason: `${spend.name}: warded by ${sheet.name}` });
  return { ...(mine ? { patch: withWard(sheet, 0, null) } : {}), result };
}

// The swing of a record that dealt the most, or -1.
function heaviest(record: LastHit): number {
  let best = -1;
  record.swings.forEach((swing, index) => {
    if (swing.hit && swing.raw > 0 && (best < 0 || swing.raw > record.swings[best].raw)) {
      best = index;
    }
  });
  return best;
}

// A use_resource call that spends a ward's dice off a blow, or null when the
// call is not that (the sorcerer laying the ward, another resource).
export function spendWardDice(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceName: string,
  args: { amount?: number; variant?: string },
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult | null {
  if (!isNamed(resourceName, BASTION_OF_LAW)) {
    return null;
  }
  const sheet = getSheetById(stale.id) ?? stale;
  const ward = wardOn(sheet);
  const asked = textKey(args.variant ?? "") === WARD_REDUCE;
  // A warded creature that does not hold the feature can only mean its dice.
  if (!asked && (holdsFeature(sheet, BASTION_OF_LAW) || !ward)) {
    return null;
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead and spends no dice of ${BASTION_OF_LAW}. Nothing was spent.`, refused: "rules" };
  }
  if (!ward) {
    return { error: `${sheet.name} carries no ward of ${BASTION_OF_LAW} to spend dice from. Nothing was spent.`, refused: "rules" };
  }
  const dice = Math.floor(args.amount ?? 1);
  if (dice < 1 || dice > ward.dice) {
    return { error: `${sheet.name}'s ward holds ${ward.dice}${WARD_DIE}: pass in amount how many to spend, from 1 to ${ward.dice}. Nothing was spent.`, retry: true };
  }
  const label = answerKey(textKey(BASTION_OF_LAW), sheet.id);
  const record = freshLastHit(campaign.id, sheet.id, (hit) => !answeredBy(hit, label) && heaviest(hit) >= 0, (hit) => hit.swings[heaviest(hit)]?.raw ?? -1);
  const index = record ? heaviest(record) : -1;
  if (!record || index < 0) {
    return { error: `${BASTION_OF_LAW}'s ward takes its dice off damage ${sheet.name} has just taken, and the server has none on record against them this turn. The ward keeps its ${ward.dice}${WARD_DIE}. Nothing was spent.`, refused: "rules" };
  }
  const blow = record.swings[index];
  const rolled = Math.max(0, rollCard(campaign, getDmTurn(turnId), sheet.id, "custom", `${sheet.name}: ${BASTION_OF_LAW} (${dice}${WARD_DIE})`, `${dice}${WARD_DIE}`, null).total);
  const settled = settleLastHit(campaign, turnId, record, record.swings.map((swing, at) => (at === index ? cutBlow(swing, rolled) : swing)), label, sheets, sheetsById);
  const now = getSheetById(sheet.id) ?? sheet;
  patchSheetAudited(campaign.id, now.id, withWard(now, ward.dice - dice, null), { kind: "use_resource", reason: `${BASTION_OF_LAW}: ${dice}${WARD_DIE} spent off a blow` });
  return {
    ok: true,
    resource: BASTION_OF_LAW,
    spent: `${dice}${WARD_DIE} of the ward`,
    left: `${ward.dice - dice}${WARD_DIE}`,
    rolled: `${dice}${WARD_DIE}: ${rolled}`,
    applied: `${sheet.name}'s ward takes ${Math.min(rolled, blow.raw)} off the ${blow.attack ?? record.attack} damage (${blow.raw}): ${settled.given} hit points come back. HP ${settled.hp}. It costs no reaction.`,
    ...(settled.notes.length ? { notes: settled.notes } : {}),
  };
}
