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
import { authoredSpendFor, gateHolds, hasCondition, heldAuthored, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import { matchResource, resourceDef, resourceName as counterName } from "@/lib/srd/class-resources";
import { holdsFeature, isNamed, nameChoice } from "@/lib/srd/feature-names";
import type { SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { WEAPON_HIT, spendAction } from "@/lib/dm/action-budget";
import { spellHurt } from "@/lib/dm/spell-damage-logic";
import { castFirstRefusal } from "@/lib/dm/ar-ws-tempest-logic";
import { curseHealTakenBack, curseMoveRefusal } from "@/lib/dm/master-of-hexes";
import { attacksAllowedFor, budgetFor, prepareReaction, storeBudget } from "@/lib/dm/turn-budget";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { choiceChange } from "@/lib/dm/ar-ws-stone";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { namedOption, toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { drinkerTempHp, lowestSlotLeft, nearZoneRefusal, rollOption, spendSlotOf } from "@/lib/dm/authored-spend-divine-dra";
import { triggerSpecFor } from "@/lib/srd/trigger-table";
import { answerTriggers, triggerRefusal, type TriggerAsk } from "@/lib/dm/reaction-triggers";
import { answerKey } from "@/lib/dm/last-hit";
import { needRefusal } from "@/lib/dm/mt-mr-needs";
import { destroyTrinket, trinketCount } from "@/lib/dm/mt-mr-trinkets";
import { chargeRefusal, naturalHitRefusal } from "@/lib/dm/mt-fb-charge";
import { holdsOn } from "@/lib/dm/vitals-logic";
import { otherPrice, type OtherPrice } from "@/lib/srd/counter-rules";

export type AuthoredSpendArgs = {
  amount?: number;
  variant?: string;
  targetCharacterId?: string;
  targetEnemyId?: string;
  targetEnemyIds?: string[];
  // A square the feature moves its holder to (src/lib/dm/feature-move.ts,
  // src/lib/dm/ar-ws-shadow-walk.ts): the one way a spend names a square.
  x?: number;
  y?: number;
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
  if (gate.pet) return { error: `${spend.name} commands ${gate.pet === "drake" ? "a drake" : gate.pet === "familiar" ? "a familiar" : "a companion"}, and none is out and standing (summon_pet first). Nothing was spent.`, refused: "rules" };
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
  afterSpellDamage = false,
): ToolError | { commit: () => ToolResult; marks?: string[] } {
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  // A spend that rides a weapon hit has none to ride out of a fight (Arcane
  // Jolt's healing was taken there with no hit, its card shut).
  if (afterWeaponHit && !inFight) {
    return { error: `${label} rides a weapon hit in a fight, and there is no fight. Nothing was spent.`, refused: "rules" };
  }
  if (afterSpellDamage && !inFight) {
    return { error: `${label} rides a wizard spell's damage in a fight, and there is no fight. Nothing was spent.`, refused: "rules" };
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
  if (afterSpellDamage && (!budget || !spellHurt(budget.oncePerTurn).length)) {
    return { error: `${label} rides a wizard spell that deals damage, and no spell of ${sheet.name}'s has hurt a creature this turn: cast it first. Nothing was spent.`, refused: "rules" };
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
          // Read again: the effect may have spent an attack of the turn itself
          // (a Piercing Arrow, src/lib/dm/mt-fb-arcane-shot.ts).
          const now = budgetFor(live, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) ?? budget;
          storeBudget(live, { ...now, oncePerTurn: [...now.oncePerTurn, onceKey] });
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
// The option is looked for in the variant first, then after the colon, so
// an option with a choice of its own (Knowledge of the Ages' skill) can name
// the option in the resource and the choice in the variant.
function poolOptionSpend(sheet: CharacterSheet, resourceName: string, variant: string | undefined) {
  const pool = matchResource(resourceName);
  for (const option of [variant, nameChoice(resourceName)]) {
    const found = option && pool ? authoredSpendFor(sheet, option) : null;
    // The pool named pays for it, at once or once the option's own free use is
    // gone (Telekinetic Movement, Bulwark of Force: `fallback`).
    if (found && pool && (found.spend.pool?.id === pool.id || found.spend.pool?.fallback === pool.id)) return found;
  }
  return null;
}

const hasOwnChoice = (does: SpendDoes) => does.kind === "variants" || (does.kind === "buff" && Boolean(does.variants));

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
  const direct = authoredSpendFor(sheet, resourceDef(resourceName)?.displayName ?? resourceName);
  const found = direct ?? poolOptionSpend(sheet, resourceName, args.variant);
  if (!found) {
    return null;
  }
  const { spend, held } = found;
  // A variant that names the option itself picks nothing of the option's
  // own choices: "Channel Divinity" with variant "Knowledge of the Ages".
  if (!direct && args.variant && hasOwnChoice(spend.does) && isNamed(args.variant, spend.name)) {
    return { error: `${spend.name} has a choice of its own: call use_resource with resource "${spend.name}" and the choice in variant. Nothing was spent.`, retry: true };
  }
  if (sheet.deathSaves?.dead || (sheet.currentHp <= 0 && !holdsOn(sheet))) {
    return { error: `${sheet.name} is down and cannot use ${spend.name}.`, refused: "rules" };
  }
  if (!gateHolds(spend.gate, sheet, held)) {
    const refusal = gateSentence(spend);
    return { ...refusal, error: `${refusal.error} Nothing was spent.` };
  }
  // Worked through something on the board within reach (Activate Cannon).
  const far = spend.nearZone ? nearZoneRefusal(campaign.id, sheet, spend.nearZone, spend.name) : null;
  if (far) {
    return far;
  }
  // What the row needs that a gate cannot say (mt-mr-needs.ts).
  const unmet = spend.needs ? needRefusal(campaign, sheet, spend.name, spend.needs) : null;
  if (unmet) {
    return unmet;
  }
  // A spend whose counter waits on a trigger (trigger-table.ts: Call the
  // Hunt's rage just entered) answers the record, refused before anything is
  // spent when none is open: the generic door (reaction-counters.ts) asks the
  // same, and this one runs first.
  // The creature the call names picks the record only where the trigger is
  // a creature's doing (aimsAt): the rage Call the Hunt answers is the holder's own.
  const spec = spend.pool ? triggerSpecFor("", { counterId: spend.pool.id }) : null;
  const trigger: TriggerAsk | null = spend.pool && spec
    ? { campaignId: campaign.id, reactor: sheet, name: spend.name, counterId: spend.pool.id, targetEnemyId: spec.aimsAt ? args.targetEnemyId : undefined, label: answerKey(spend.pool.id, sheet.id) }
    : null;
  const unanswered = trigger ? triggerRefusal(trigger) : null;
  if (unanswered) {
    return unanswered;
  }
  // A spend whose text opens with a trigger (Master of Hexes: "When the
  // creature cursed by your Hexblade's Curse dies") answers its record, never
  // the call's word: refused with nothing spent when none is open
  // (reaction-triggers.ts). Found by the spend's name, where the counter's
  // trigger above is found by its pool.
  const triggerAsk = { campaignId: campaign.id, reactor: sheet, name: spend.name, label: answerKey(textKey(spend.name), sheet.id) };
  const unheard = triggerRefusal(triggerAsk);
  if (unheard) {
    return unheard;
  }
  // Master of Hexes: the new creature stands within 30 feet of the one that died (master-of-hexes.ts).
  const beyond = spend.takesBackCurseHeal ? curseMoveRefusal(campaign.id, sheet, args.targetEnemyId) : null;
  if (beyond) {
    return beyond;
  }
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  // Transmuter's Stone: a change of its benefit needs a transmutation spell
  // just cast, and is then made in a fight too (ar-ws-stone.ts).
  const change = choiceChange(sheet, spend, held, args.variant);
  if (change && "error" in change) {
    return change;
  }
  if (spend.fight === "out" && inFight && !change) {
    return { error: `${spend.name} ${spend.outOfFightWhy ?? "is chosen outside a fight, when a rest ends, not in the middle of one"}.`, refused: "rules" };
  }
  if (spend.oncePer && sheet.conditions.some((entry) => textKey(entry) === textKey(spend.oncePer!.marker))) {
    return { error: `${spend.name} has been used already (${spend.oncePer.marker}). Nothing was spent.`, refused: "rules" };
  }
  // The variant a feature's chosen option fixes (Lunar Phenomenon: the
  // phase of Lunar Embodiment), never another one named.
  const fixed = fixedVariant(sheet, spend, args.variant);
  if (fixed && typeof fixed !== "string") {
    return fixed;
  }
  const variant = fixed ?? args.variant;
  // A die that picks the option when none is named (Experimental Elixir's
  // d6): rolled below, once the use is sure to be paid.
  const rollsOption = spend.does.kind === "variants" && Boolean(spend.does.roll) && !variant?.trim();
  let picked = rollsOption ? { does: spend.does, action: spend.action, afterWeaponHit: spend.afterWeaponHit } : pickVariant(spend.does, variant, spend);
  if ("error" in picked) {
    return picked;
  }
  // Twinkling Constellations: a form already up changes for free, once a
  // turn (spend.swap); taking it again spent another use and stacked a second
  // form beside the first.
  const swapping = Boolean(spend.swap && hasCondition(sheet, spend.swap.family) && sheet.features.some((feature) => isNamed(feature.name, spend.swap!.feature)));
  if (swapping) {
    picked = { ...picked, action: "none" };
  }
  const unrun = spend.chargeFeet && inFight ? chargeRefusal(campaign.id, sheet, spend.name, spend.chargeFeet, args.targetEnemyId) : null;
  if (unrun) {
    return unrun;
  }
  const unclawed = spend.afterNaturalHit ? naturalHitRefusal(campaign.id, sheet, spend.name, args.targetEnemyId) : null;
  if (unclawed) {
    return unclawed;
  }
  // The pool: how much, from which counter.
  let poolId: string | null = null;
  let units = 0;
  let slotLevel: number | null = null;
  let byTrinket = false;
  // What the pool is charged when another price pays (otherwise `units`),
  // and the spell slot that paid instead of a use.
  let paidUnits: number | null = null;
  let slotPaid: number | null = null;
  let freeDie: string | null = null;
  if (spend.pool && !swapping) {
    units = spend.pool.free && needRefusal(campaign, sheet, spend.name, spend.pool.free) === null
      ? 0
      : spend.pool.perUnit ? Math.floor(args.amount ?? (spend.pool.optional ? 0 : (spend.pool.min ?? 1))) : (spend.pool.amount ?? 1);
    if (spend.pool.min && units < spend.pool.min) {
      return { error: `${spend.name} takes at least ${spend.pool.min}: pass amount ${spend.pool.min} or more. Nothing was spent.`, retry: true };
    }
    if (spend.pool.max && units > spend.pool.max) {
      return { error: `${spend.name} takes at most ${spend.pool.max}; ${units} is more than it can hold. Nothing was spent.`, retry: true };
    }
    const candidates = [spend.pool.id, ...(spend.pool.fallback ? [spend.pool.fallback] : [])];
    const owed = (id: string) => (id !== spend.pool!.id && spend.pool!.fallbackAmount ? spend.pool!.fallbackAmount : units);
    poolId = candidates.find((id) => {
      const state = sheet.resources?.[id];
      return state && state.max - state.used >= owed(id);
    }) ?? null;
    if (poolId) {
      units = owed(poolId);
    }
    if (units > 0 && !poolId && spend.pool.orTrinket && trinketCount(sheet) > 0) {
      // A soul trinket pays for it (mt-mr-trinkets.ts): destroyed below, once
      // the effect has landed.
      byTrinket = true;
      units = 0;
    }
    // Master's Flourish: with no use left, the feature's own die and nothing spent.
    if (units > 0 && !poolId && spend.pool.freeDie && holdsFeature(sheet, spend.pool.freeDie.feature)) {
      freeDie = spend.pool.freeDie.die;
      units = 0;
    }
    // "Or by expending a spell slot of 1st level or higher": with the
    // counter spent, the lowest slot left pays (dra-slot-fallback).
    slotLevel = units > 0 && !poolId && spend.pool.slot ? lowestSlotLeft(sheet) : null;
    // "Or by expending a 5th-level spell slot" (Living Legend): a slot of
    // exactly that level, when one is left.
    const fixedLevel = spend.pool.slotFallback;
    const fixedSlot = fixedLevel ? sheet.spellcasting?.slots?.[String(fixedLevel)] : null;
    if (units > 0 && !poolId && slotLevel === null && fixedLevel && fixedSlot && fixedSlot.max - fixedSlot.used > 0) {
      slotLevel = fixedLevel;
    }
    if (slotLevel !== null && rollsOption) {
      return { error: `${spend.name} bought with a spell slot is brewed by choice: name its effect in variant (${spend.does.kind === "variants" ? Object.keys(spend.does.options).join(", ") : ""}). Nothing was spent.`, retry: true };
    }
    // With no use left, the other price the counter's row names pays
    // (src/lib/srd/counter-rules.ts otherPrice): so many sorcery points, or
    // a spell slot of the level the row names.
    const other = units > 0 && !poolId && slotLevel === null ? otherPriceOf(spend.pool.id, sheet) : null;
    if (other && "pool" in other) {
      poolId = other.pool.id;
      paidUnits = other.pool.amount;
    } else if (other) {
      slotPaid = other.slot;
    }
    if (units > 0 && !poolId && slotLevel === null && slotPaid === null) {
      const state = sheet.resources?.[spend.pool.id];
      return {
        error: state
          ? `${sheet.name} has ${state.max - state.used}/${state.max} left of what ${spend.name} spends, and it takes ${units}. Nothing was spent.`
          : `${sheet.name} has no ${counterName(spend.pool.id)} to spend on ${spend.name}.`
            + (spend.pool.slotFallback ? ` A level ${spend.pool.slotFallback} spell slot would buy it again, and none is left.` : ""),
        refused: "rules",
      };
    }
  }
  // Tempestuous Magic: in a fight, once a levelled spell is cast this turn.
  const uncast = spend.afterLevelledCast ? castFirstRefusal(spend.name, sheet, inFight ? encounter : null) : null;
  if (uncast) {
    return uncast;
  }
  const onceKey = spend.oncePerTurn ? (spend.onceKey ?? `authored:${textKey(spend.name)}`) : swapping ? `authored:${textKey(spend.name)} swap` : null;
  const charge = prepareCost(campaign, sheet, picked.action, spend.name, onceKey, picked.afterWeaponHit ?? spend.afterWeaponHit, spend.afterSpellDamage);
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
    ...(slotLevel !== null ? { paidBySlot: slotLevel } : {}),
    mods: computeSheetDerived(sheet).abilityMods,
    reason,
    ...("marks" in charge && charge.marks ? { marks: charge.marks } : {}),
    ...(freeDie ? { freeDie } : {}),
  };
  if (rollsOption && spend.does.kind === "variants") {
    const rolled = rollOption(ctx, spend.does);
    picked = { ...rolled.option, action: rolled.option.action ?? spend.action };
    ctx.args = { ...args, variant: rolled.key };
  }
  const outcome = resolveSpendEffect(ctx, picked.does);
  if ("error" in outcome) {
    return outcome;
  }
  const drunk = drinkerTempHp(ctx);
  // Only now is anything written: the effect's own patch, the pool, the
  // once-per marker, the turn.
  const now = getSheetById(sheet.id) ?? sheet;
  const patch: FullPatchSheetInput = { ...(outcome.patch ?? {}) };
  if (slotLevel !== null) {
    const casting = patch.spellcasting ?? now.spellcasting;
    if (casting) {
      patch.spellcasting = spendSlotOf(casting, slotLevel);
    }
  }
  if (poolId && units > 0) {
    // On top of what the effect wrote: Psionic Recovery restores a Psionic
    // Energy die and spends its own use, and the pool written from the sheet
    // as read before the effect put the die straight back (it answered
    // "1 die back" and returned none).
    const resources = patch.resources ?? now.resources;
    const state = resources[poolId] ?? now.resources[poolId];
    patch.resources = { ...resources, [poolId]: { max: state.max, used: state.used + (paidUnits ?? units) } };
  }
  if (slotPaid !== null) {
    const casting = patch.spellcasting ?? now.spellcasting;
    const slot = casting?.slots?.[String(slotPaid)];
    if (casting && slot) {
      patch.spellcasting = { ...casting, slots: { ...casting.slots, [String(slotPaid)]: { ...slot, used: slot.used + 1 } } };
    }
  }
  if (spend.oncePer) {
    const conditions = patch.conditions ?? now.conditions;
    const meta = patch.conditionMeta ?? now.conditionMeta;
    patch.conditions = [...conditions, spend.oncePer.marker];
    patch.conditionMeta = { ...meta, [spend.oncePer.marker]: { rounds: spend.oncePer.rounds } };
  }
  // Master of Hexes: the moved curse gives back the first death's healing.
  const takenBack = spend.takesBackCurseHeal ? curseHealTakenBack(sheet, { ...now, ...patch } as CharacterSheet) : null;
  if (takenBack) {
    Object.assign(patch, takenBack.patch);
  }
  if (Object.keys(patch).length) {
    patchSheet(sheet.id, patch);
    audit(campaign, turnId, now, { resource: spend.name, spent: units || undefined, variant: args.variant }, reason, patch);
    const updated = patchSheet(sheet.id, {});
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  if (trigger) {
    answerTriggers(trigger);
  }
  // The record it answered is answered (no second use of one death).
  answerTriggers(triggerAsk);
  const trinketsLeft = byTrinket ? destroyTrinket(campaign, sheet.id) : null;
  const left = poolId ? getSheetById(sheet.id)?.resources?.[poolId] : null;
  return {
    ok: true,
    resource: spend.name,
    ...(poolId && units > 0 ? { spent: paidUnits !== null ? `${paidUnits} ${counterName(poolId)} (no use was left)` : units, left: left ? `${left.max - left.used}/${left.max}` : undefined } : {}),
    ...(slotLevel !== null ? { spent: `a level ${slotLevel} spell slot (no use was left)` } : {}),
    ...(slotPaid !== null ? { spent: `a level ${slotPaid} spell slot (no use was left)` } : {}),
    ...(rollsOption ? { rolled: ctx.args.variant } : {}),
    ...outcome.result,
    ...(drunk ? { tempHp: drunk } : {}),
    ...(byTrinket ? { trinket: `A soul trinket is destroyed for it, no use spent (${trinketsLeft ?? 0} left).` } : {}),
    ...(takenBack ? { curseHealing: takenBack.line } : {}),
    ...charge.commit(),
  };
}

// The other price of a spend's own counter, when its row names one.
function otherPriceOf(counterId: string, sheet: CharacterSheet): OtherPrice | null {
  const def = resourceDef(counterId);
  return def ? otherPrice(def, sheet) : null;
}

// The option the spend's variantFrom feature holds, the refusal when none is
// chosen or another was named, or null for a spend without one.
export function fixedVariant(sheet: CharacterSheet, spend: AuthoredSpend, named: string | undefined): string | ToolError | null {
  if (!spend.variantFrom) {
    return null;
  }
  // With nothing chosen yet (a sheet from before the choice was kept), the
  // option is the call's, as it was.
  const choice = heldAuthored(sheet).find((entry) => textKey(entry.feature) === textKey(spend.variantFrom!))?.choice ?? null;
  if (!choice) {
    return null;
  }
  if (named?.trim() && textKey(named) !== textKey(choice)) {
    return { error: `${spend.name} releases ${sheet.name}'s current ${spend.variantFrom} option, ${choice}, not ${named.trim()}. Nothing was spent.`, refused: "rules" };
  }
  return choice;
}
