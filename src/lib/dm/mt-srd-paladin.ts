// The paladin's SRD 5.1 clauses that had no door of their own.
//
//   Lay on Hands: "you can expend 5 hit points from your pool of healing to
//     cure the target of one disease or neutralize one poison affecting it.
//     You can cure multiple diseases and neutralize multiple poisons with a
//     single use of Lay on Hands, expending hit points separately for each
//     one." layOnHandsCure, reached through use_resource with a variant that
//     names the cure.
//   Cleansing Touch: "you can use your action to end one spell on yourself or
//     on one willing creature that you touch." cleansingTouch.
//   Sacred Weapon: "The weapon also emits bright light in a 20-foot radius
//     and dim light 20 feet beyond that"; "If you are no longer holding or
//     carrying this weapon ... this effect ends." sacredWeaponMeta names the
//     weapon, and the sheet's write ends the effect once it is gone
//     (mt-srd-unconscious.ts).
//   Holy Nimbus: "bright light shines from you in a 30-foot radius, and dim
//     light shines 30 feet beyond that." shedLight, as Sacred Weapon's.
//   Purity of Spirit: "you are always under the effects of a protection from
//     evil and good spell." The charm and fear it refuses are in
//     trait-rules.ts; withStandingProtection gives the attack roll against
//     the paladin the same condition the spell would.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, setTokenLight } from "@/lib/db/battle-maps";
import { getClock } from "@/lib/db/clock";
import { getActiveBoard, getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { dropConditions, liveAfflictions } from "@/lib/dm/afflictions";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import { breakConcentration } from "@/lib/dm/concentration";
import { instancesOf, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { gearKindOf, heldRows } from "@/lib/dm/gear-hands";
import { targetReachProblem } from "@/lib/dm/mt-srd-reach";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { publishZones } from "@/lib/dm/zone-store";
import { textKey } from "@/lib/language/text-logic";
import { spellsOn } from "@/lib/srd/mt-srd-spells-on";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { holdsFeature } from "@/lib/srd/trait-rules";

type SpendArgs = { variant?: string; amount?: number; targetCharacterId?: string };

const holds = (conditions: readonly string[], name: string) => conditions.some((entry) => isConditionNamed(entry, name));

function poolLeft(sheet: CharacterSheet, id: string): number {
  const state = sheet.resources?.[id];
  return state ? state.max - state.used : 0;
}

function spendPool(campaign: Campaign, sheet: CharacterSheet, id: string, amount: number, reason: string) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const state = fresh.resources[id];
  patchSheetAudited(campaign.id, fresh.id, { resources: { ...fresh.resources, [id]: { max: state.max, used: state.used + amount } } }, {
    kind: "use_resource",
    reason,
    delta: { resource: reason, spent: amount },
  });
}

// ---- light ----

// A feature's light on its holder's token for its minutes: the brighter of
// it and what the token already carries stays.
export function shedLight(campaignId: string, sheetId: string, brightFeet: number, dimMoreFeet: number, minutes: number): boolean {
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const token = map ? getTokenByRef(map.id, sheetId) : null;
  const radius = Math.floor(brightFeet / 5);
  if (!token || token.lightRadius >= radius) {
    return false;
  }
  const instant = getClock(campaignId).instant;
  setTokenLight(token.id, radius, instant + minutes, minutes, radius + Math.floor(dimMoreFeet / 5));
  publishZones(campaignId);
  return true;
}

// ---- Sacred Weapon ----

// The weapon the paladin imbues: the one in hand, else the first they carry.
export function sacredWeaponMeta(sheet: Pick<CharacterSheet, "equipment">, rounds: number): ConditionMeta {
  const weapon = heldRows(sheet.equipment).find((row) => gearKindOf(row) === "weapon") ?? sheet.equipment.find((row) => gearKindOf(row) === "weapon" && (row.qty ?? 1) > 0);
  return weapon ? { rounds, weapon: weapon.name } : { rounds };
}

// ---- Purity of Spirit ----

const PROTECTED = "protected from evil and good";

// The conditions an attack against this character reads.
export function withStandingProtection(sheet: Pick<CharacterSheet, "features">, conditions: string[]): string[] {
  return holdsFeature(sheet, "purity of spirit") && !holds(conditions, PROTECTED) ? [...conditions, PROTECTED] : conditions;
}

// ---- Lay on Hands: cures ----

const CURE_WORDS = /\b(cure|disease|diseases|poison|poisons|neutralize)\b/;

export function asksForCure(variant: string | undefined): boolean {
  return Boolean(variant) && CURE_WORDS.test(textKey(variant!));
}

export function layOnHandsCure(campaign: Campaign, stale: CharacterSheet, args: SpendArgs): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!sheet.resources?.lay_on_hands) {
    return { error: `${sheet.name} has no Lay on Hands (a paladin's feature).`, refused: "rules" };
  }
  const target = args.targetCharacterId ? getSheetById(args.targetCharacterId) : sheet;
  if (!target || target.deathSaves?.dead) {
    return { error: "Lay on Hands needs a living creature to touch: pass targetCharacterId. Nothing was spent.", retry: true };
  }
  const beyond = targetReachProblem(campaign.id, { id: "lay_on_hands", displayName: "Lay on Hands" }, sheet, target);
  if (beyond) {
    return { error: `${beyond} Nothing was spent.`, refused: "rules" };
  }
  const word = textKey(args.variant ?? "");
  const wantsPoison = /poison|neutralize/.test(word);
  const wantsDisease = /disease/.test(word);
  const both = wantsPoison === wantsDisease;
  // One entry a cure: the poison, then each disease with the conditions it keeps.
  const cures: Array<{ what: string; conditions: string[] }> = [];
  const poisonedAs = target.conditions.find((entry) => isConditionNamed(entry, "poisoned"));
  if ((both || wantsPoison) && poisonedAs) {
    cures.push({ what: "a poison", conditions: [poisonedAs] });
  }
  if (both || wantsDisease) {
    for (const record of liveAfflictions(campaign.id, target)) {
      if (record.kind === "disease" && record.conditions.length) {
        cures.push({ what: "a disease", conditions: record.conditions });
      }
    }
  }
  if (!cures.length) {
    return { error: `${target.name} carries no ${both ? "disease or poison" : wantsPoison ? "poison" : "disease"} for Lay on Hands to end. Nothing was spent.`, refused: "rules" };
  }
  const amount = args.amount ?? 5;
  if (amount < 5 || amount % 5 !== 0) {
    return { error: `Each disease cured or poison neutralized takes 5 points of the pool; ${amount} is not a number of fives. Nothing was spent.`, retry: true };
  }
  const count = Math.min(cures.length, amount / 5);
  const cost = count * 5;
  if (poolLeft(sheet, "lay_on_hands") < cost) {
    return { error: `${sheet.name} has ${poolLeft(sheet, "lay_on_hands")} points of Lay on Hands left and this takes ${cost}. Nothing was spent.`, refused: "rules" };
  }
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "Lay on Hands");
  if ("error" in price) {
    return toolError(price);
  }
  const done = cures.slice(0, count);
  spendPool(campaign, sheet, "lay_on_hands", cost, "Lay on Hands");
  dropConditions(campaign.id, target.id, done.flatMap((entry) => entry.conditions));
  price.commit();
  publishSheet(campaign, target.id);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "Lay on Hands",
    spent: cost,
    left: `${poolLeft(getSheetById(sheet.id) ?? sheet, "lay_on_hands")}/${sheet.resources.lay_on_hands.max}`,
    cost: "their action",
    applied: `${sheet.name}'s touch ends ${done.map((entry) => entry.what).join(" and ")} on ${target.name}: no longer ${done.flatMap((entry) => entry.conditions).join(", ")}. 5 points of the pool for each.`,
  };
}

// ---- Cleansing Touch ----

export function cleansingTouch(campaign: Campaign, turnId: string, stale: CharacterSheet, args: SpendArgs): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!sheet.resources?.cleansing_touch) {
    return { error: `${sheet.name} does not have Cleansing Touch (a paladin's 14th level feature).`, refused: "rules" };
  }
  if (poolLeft(sheet, "cleansing_touch") < 1) {
    return { error: `${sheet.name} has no use of Cleansing Touch left; they come back on a long rest. Nothing was spent.`, refused: "rules" };
  }
  const target = args.targetCharacterId ? getSheetById(args.targetCharacterId) : sheet;
  if (!target || target.deathSaves?.dead) {
    return { error: "Cleansing Touch needs the paladin or a willing creature they touch: pass targetCharacterId. Nothing was spent.", retry: true };
  }
  const beyond = targetReachProblem(campaign.id, { id: "cleansing_touch", displayName: "Cleansing Touch" }, sheet, target);
  if (beyond) {
    return { error: `${beyond} Nothing was spent.`, refused: "rules" };
  }
  const spells = spellsOn(target);
  const names = [...spells.keys()];
  const wanted = textKey(args.variant ?? "");
  const named = wanted ? names.filter((spell) => textKey(spell) === wanted || (spells.get(spell) ?? []).some((condition) => textKey(condition) === wanted)) : names;
  if (!named.length) {
    return {
      error: names.length
        ? `${target.name} is under ${names.join(", ")}, not ${args.variant}. Name one of those in variant. Nothing was spent.`
        : `No spell lies on ${target.name} for Cleansing Touch to end. Nothing was spent.`,
      ...(names.length ? { retry: true as const } : { refused: "rules" as const }),
    };
  }
  if (named.length > 1) {
    return { error: `Cleansing Touch ends one spell, and ${target.name} is under ${named.join(", ")}. Ask the player which and name it in variant. Nothing was spent.`, retry: true };
  }
  const spell = named[0];
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "Cleansing Touch");
  if ("error" in price) {
    return toolError(price);
  }
  spendPool(campaign, sheet, "cleansing_touch", 1, "Cleansing Touch");
  // The target's own concentration on it ends the whole spell; otherwise what
  // it laid on this creature goes and the rest of the spell stands.
  const fresh = getSheetById(target.id) ?? target;
  if (fresh.concentratingOn && textKey(fresh.concentratingOn) === textKey(spell)) {
    breakConcentration(campaign, turnId, fresh.id, "Cleansing Touch ended the spell");
  }
  const left = (getSheetById(target.id) ?? fresh).conditions.filter((name) =>
    instancesOf(((getSheetById(target.id) ?? fresh).conditionMeta as ConditionMetaMap)[name]).some((entry) => entry.spell && textKey(entry.spell) === textKey(spell)),
  );
  dropConditions(campaign.id, target.id, left);
  price.commit();
  publishSheet(campaign, target.id);
  publishSheet(campaign, sheet.id);
  return { ok: true, resource: "Cleansing Touch", cost: "their action", applied: `${sheet.name}'s touch ends ${spell} on ${target.name}.` };
}
