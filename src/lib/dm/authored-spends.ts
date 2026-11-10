// use_resource on an authored subclass feature whose effect the server
// resolves (src/lib/srd/authored-effects-data*.ts, `spends`): the checks,
// the turn's cost, the pool it spends and the effect, in that order, so a
// refusal costs nothing. Before this a feature like Kensei's Shot, Symbiotic
// Entity or Touch of the Long Death had no counter and no effect: use_resource
// said the character had no such resource and the model narrated the text.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path. Must not import mutations.ts (which imports it).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { authoredSpendFor, gateHolds, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import { matchResource, resourceDef, resourceName as counterName } from "@/lib/srd/class-resources";
import { nameChoice } from "@/lib/srd/feature-names";
import type { SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { WEAPON_HIT, spendAction } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, prepareReaction, storeBudget } from "@/lib/dm/turn-budget";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { namedOption, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export type AuthoredSpendArgs = {
  amount?: number;
  variant?: string;
  targetCharacterId?: string;
  targetEnemyId?: string;
  targetEnemyIds?: string[];
};

function audit(campaign: Campaign, turnId: string, sheet: CharacterSheet, delta: Record<string, unknown>, reason: string, patch: Record<string, unknown>) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: turnId || null,
    kind: "use_resource",
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function gateSentence(spend: AuthoredSpend): ToolError {
  const gate = spend.gate ?? {};
  if (gate.raging) return { error: `${spend.name} works only while raging (and not in heavy armor).`, refused: "rules" };
  if (gate.condition) return { error: gate.because ? `${spend.name} ${gate.because}. Nothing was spent.` : `${spend.name} works only while ${gate.condition} holds.`, refused: "rules" };
  if (gate.choice) return { error: `${spend.name} belongs to the ${gate.choice} option, which this character has not chosen.`, refused: "rules" };
  if (gate.choiceOf) return { error: `${spend.name} belongs to the ${gate.choiceOf.value} ${gate.choiceOf.feature}, which this character has not chosen.`, refused: "rules" };
  return { error: `${spend.name} cannot be used right now.`, refused: "rules" };
}

// The turn's cost, checked first and written last (the resource-turn.ts
// pattern for features that are not counters).
function prepareCost(
  campaign: Campaign,
  sheet: CharacterSheet,
  cost: SpendAction | undefined,
  label: string,
  onceKey: string | null,
  afterWeaponHit = false,
): ToolError | { commit: () => ToolResult; marks?: string[] } {
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  // A spend that rides a weapon hit has none to ride out of a fight (Arcane
  // Jolt's healing was taken there with no hit, its card shut).
  if (afterWeaponHit && !inFight) {
    return { error: `${label} rides a weapon hit in a fight, and there is no fight. Nothing was spent.`, refused: "rules" };
  }
  if (!inFight || !encounter) {
    return { commit: () => ({}) };
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (onceKey && budget?.oncePerTurn.includes(onceKey)) {
    return { error: `${label} is used once a turn, and ${sheet.name} has used it this turn.`, refused: "rules" };
  }
  // Before this the use could be spent with no attack made at all, and off
  // the holder's turn (no budget of theirs) with no hit of this turn.
  if (afterWeaponHit && (!budget || !budget.oncePerTurn.some((mark) => mark.startsWith(WEAPON_HIT)))) {
    return { error: `${label} rides a weapon hit, and ${sheet.name} has landed none this turn: pc_attack first. Nothing was spent.`, refused: "rules" };
  }
  if (cost === "reaction") {
    return prepareReaction(encounter, sheet, label);
  }
  if (!cost || cost === "none") {
    return {
      ...(budget ? { marks: budget.oncePerTurn } : {}),
      commit: () => {
        const live = getActiveEncounter(campaign.id);
        if (onceKey && live && budget) {
          storeBudget(live, { ...budget, oncePerTurn: [...budget.oncePerTurn, onceKey] });
        }
        return {};
      },
    };
  }
  const able = canAct({ sheet, encounter, kind: cost });
  if (!able.ok) {
    return toolError(able);
  }
  const heldOff = heldTurnRefusal(encounter, sheet);
  if (heldOff) {
    return heldOff;
  }
  if (!budget) {
    return { commit: () => ({}) };
  }
  const spent = spendAction(budget, cost, label, sheet.name);
  if (!spent.ok) {
    return toolError(spent);
  }
  return {
    commit: () => {
      const live = getActiveEncounter(campaign.id);
      if (live) {
        storeBudget(live, { ...spent.budget, oncePerTurn: onceKey ? [...spent.budget.oncePerTurn, onceKey] : spent.budget.oncePerTurn });
      }
      return { cost: cost === "bonus" ? "their bonus action" : "their action" };
    },
  };
}

function pickVariant(does: SpendDoes, variant: string | undefined, spend: AuthoredSpend): { does: SpendDoes; action?: SpendAction; afterWeaponHit?: boolean } | ToolError {
  if (does.kind !== "variants") {
    return { does, action: spend.action, afterWeaponHit: spend.afterWeaponHit };
  }
  const key = namedOption(spend.name, variant, Object.keys(does.options));
  // An option that names no cost of its own costs the spend's (Bolstering
  // Magic's touch, Lunar Phenomenon's bonus action), as its card says.
  return typeof key === "string" ? { ...does.options[key], action: does.options[key].action ?? spend.action } : key;
}

// An option of a shared pool, named in the variant or after the pool's name
// ("Channel Divinity: Nature's Wrath"). It must spend the pool the call names.
function poolOptionSpend(sheet: CharacterSheet, resourceName: string, variant: string | undefined) {
  const option = variant ?? nameChoice(resourceName);
  const pool = matchResource(resourceName);
  const found = option && pool ? authoredSpendFor(sheet, option) : null;
  return found?.spend.pool?.id === pool?.id ? found : null;
}

// A use_resource call this module resolves, or null for the other paths.
export function authoredFeatureSpend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceName: string,
  args: AuthoredSpendArgs,
  reason: string,
): ToolResult | null {
  const sheet = getSheetById(stale.id) ?? stale;
  // A counter's id names the same spend as the feature's name. Without this a
  // call by id (sub_elder_champion) fell to the generic path, which spends the
  // use and applies nothing.
  const found = authoredSpendFor(sheet, resourceDef(resourceName)?.displayName ?? resourceName) ?? poolOptionSpend(sheet, resourceName, args.variant);
  if (!found) {
    return null;
  }
  const { spend, held } = found;
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is down and cannot use ${spend.name}.`, refused: "rules" };
  }
  if (!gateHolds(spend.gate, sheet, held)) {
    const refusal = gateSentence(spend);
    return { ...refusal, error: `${refusal.error} Nothing was spent.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  if (spend.fight === "out" && inFight) {
    return { error: `${spend.name} is chosen outside a fight, when a rest ends, not in the middle of one.`, refused: "rules" };
  }
  if (spend.oncePer && sheet.conditions.some((entry) => textKey(entry) === textKey(spend.oncePer!.marker))) {
    return { error: `${spend.name} has been used already (${spend.oncePer.marker}). Nothing was spent.`, refused: "rules" };
  }
  const picked = pickVariant(spend.does, args.variant, spend);
  if ("error" in picked) {
    return picked;
  }
  // The pool: how much, from which counter.
  let poolId: string | null = null;
  let units = 0;
  if (spend.pool) {
    units = spend.pool.perUnit ? Math.floor(args.amount ?? (spend.pool.optional ? 0 : 1)) : (spend.pool.amount ?? 1);
    if (spend.pool.max && units > spend.pool.max) {
      return { error: `${spend.name} takes at most ${spend.pool.max}; ${units} is more than it can hold. Nothing was spent.`, retry: true };
    }
    const candidates = [spend.pool.id, ...(spend.pool.fallback ? [spend.pool.fallback] : [])];
    poolId = candidates.find((id) => {
      const state = sheet.resources?.[id];
      return state && state.max - state.used >= units;
    }) ?? null;
    if (units > 0 && !poolId) {
      const state = sheet.resources?.[spend.pool.id];
      return {
        error: state
          ? `${sheet.name} has ${state.max - state.used}/${state.max} left of what ${spend.name} spends, and it takes ${units}. Nothing was spent.`
          : `${sheet.name} has no ${counterName(spend.pool.id)} to spend on ${spend.name}.`,
        refused: "rules",
      };
    }
  }
  const onceKey = spend.oncePerTurn ? (spend.onceKey ?? `authored:${textKey(spend.name)}`) : null;
  const charge = prepareCost(campaign, sheet, picked.action, spend.name, onceKey, picked.afterWeaponHit ?? spend.afterWeaponHit);
  if ("error" in charge) {
    return charge;
  }
  const ctx: SpendContext = {
    campaign,
    turnId,
    turn: getDmTurn(turnId),
    encounter,
    sheet,
    held: held as HeldAuthored,
    spend,
    args,
    units,
    mods: computeSheetDerived(sheet).abilityMods,
    reason,
    ...("marks" in charge && charge.marks ? { marks: charge.marks } : {}),
  };
  const outcome = resolveSpendEffect(ctx, picked.does);
  if ("error" in outcome) {
    return outcome;
  }
  // Only now is anything written: the effect's own patch, the pool, the
  // once-per marker, the turn.
  const now = getSheetById(sheet.id) ?? sheet;
  const patch: FullPatchSheetInput = { ...(outcome.patch ?? {}) };
  if (poolId && units > 0) {
    // On top of what the effect wrote: Psionic Recovery restores a Psionic
    // Energy die and spends its own use, and the pool written from the sheet
    // as read before the effect put the die straight back (it answered
    // "1 die back" and returned none).
    const resources = patch.resources ?? now.resources;
    const state = resources[poolId] ?? now.resources[poolId];
    patch.resources = { ...resources, [poolId]: { max: state.max, used: state.used + units } };
  }
  if (spend.oncePer) {
    const conditions = patch.conditions ?? now.conditions;
    const meta = patch.conditionMeta ?? now.conditionMeta;
    patch.conditions = [...conditions, spend.oncePer.marker];
    patch.conditionMeta = { ...meta, [spend.oncePer.marker]: { rounds: spend.oncePer.rounds } };
  }
  if (Object.keys(patch).length) {
    patchSheet(sheet.id, patch);
    audit(campaign, turnId, now, { resource: spend.name, spent: units || undefined, variant: args.variant }, reason, patch);
    const updated = patchSheet(sheet.id, {});
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const left = poolId ? getSheetById(sheet.id)?.resources?.[poolId] : null;
  return {
    ok: true,
    resource: spend.name,
    ...(poolId && units > 0 ? { spent: units, left: left ? `${left.max - left.used}/${left.max}` : undefined } : {}),
    ...outcome.result,
    ...charge.commit(),
  };
}
