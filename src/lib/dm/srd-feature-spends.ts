// The SRD class features the final recount found spent through use_resource
// with nothing behind them (SRD 5.1):
//
//   - Peerless Skill (College of Lore 14): a Bardic Inspiration use adds the
//     die to the bard's own next ability check ("peerless skill (dX)", spent
//     by that check in src/lib/dm/rolls.ts).
//   - Quivering Palm (Way of the Open Hand 17): 3 ki after the monk's
//     unarmed strike sets the vibrations in a creature they attacked this
//     turn; the monk's action ends them later: a CON save against the ki DC,
//     0 hit points on a failure and 10d10 necrotic on a success.
//   - Elemental Affinity's resistance, Dragon Wings and Draconic Presence
//     (Draconic Bloodline 6, 14, 18): src/lib/dm/draconic-spends.ts.
//   - Hide in Plain Sight (ranger 10): a minute of camouflage outside a
//     fight: "camouflaged", +10 to Stealth checks (a condition-effects row).
//   - Primeval Awareness (ranger 3): a spell slot (the level in `amount`, else
//     the lowest free one) for a minute a level of sensing.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path; must not import mutations.ts. The action-pricing helpers are
// combat-features.ts's.

import { spellStoringItemSpend } from "@/lib/dm/spell-storing-item";
import { infuseItemSpend } from "@/lib/dm/infuse-item";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { getDmTurn } from "@/lib/db/dm-turns";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { spentSlotRefusal } from "@/lib/dm/cast-rules";
import { textKey } from "@/lib/language/text-logic";
import { draconicPresence, dragonWings, elementalAffinityResistance } from "@/lib/dm/draconic-spends";
import { countercharm } from "@/lib/dm/mt-srd-bard";
import { magicalTinkering, rightToolForTheJob } from "@/lib/dm/mt-srd-artificer";
import { asksToEndRage, endRage } from "@/lib/dm/mt-srd-barbarian";
import { asksForCure, cleansingTouch, layOnHandsCure } from "@/lib/dm/mt-srd-paladin";
import { strokeOfLuckCheck } from "@/lib/dm/mt-srd-rogue";
import { bookOfShadows, pactOfTheBlade } from "@/lib/dm/mt-srd-warlock";
import { radiantLight } from "@/lib/dm/infusion-charges";
import { windingPath } from "@/lib/dm/infusion-servant";

export type SrdSpendArgs = { variant?: string; targetEnemyId?: string; amount?: number; targetCharacterId?: string; item?: string; x?: number; y?: number };

export function srdFeatureSpend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceName: string,
  args: SrdSpendArgs,
): Record<string, unknown> | null {
  // A Hand card names its counter's id ("dragon_wings"), a call the feature.
  const name = textKey(resourceName.replace(/_/g, " "));
  const sheet = getSheetById(stale.id) ?? stale;
  // An artificer's spell laid in an item (spell-storing-item.ts).
  const stored = spellStoringItemSpend(campaign, sheet, resourceName, args);
  if (stored) return stored;
  // An artificer's infusion laid in an item (infuse-item.ts).
  const infused = infuseItemSpend(campaign, sheet, resourceName, args);
  if (infused) return infused;
  // An infused Radiant Weapon's light (infusion-charges.ts).
  if (name === "radiant weapon") return radiantLight(campaign, sheet, args.variant);
  // Infused Boots of the Winding Path (infusion-servant.ts).
  if (name === "boots of the winding path") return windingPath(campaign, sheet, args);
  if (name === "rage" && asksToEndRage(args.variant)) return endRage(campaign, sheet);
  if (name === "lay on hands" && asksForCure(args.variant)) return layOnHandsCure(campaign, sheet, args);
  if (name === "cleansing touch") return cleansingTouch(campaign, turnId, sheet, args);
  if (name === "stroke of luck") {
    // A failed ability check to answer, or the counter's own path.
    const luck = strokeOfLuckCheck(campaign, sheet);
    if (luck) return luck;
  }
  if (name === "countercharm") return countercharm(campaign, sheet, args.variant);
  if (name === "magical tinkering") return magicalTinkering(campaign, sheet, args.variant);
  if (name === "the right tool for the job" || name === "right tool for the job" || name === "art right tool") return rightToolForTheJob(campaign, sheet, args.variant);
  if (name === "pact of the blade" || name === "pact weapon") return pactOfTheBlade(campaign, turnId, sheet, args.variant);
  if (name === "book of shadows" || name === "pact of the tome") return bookOfShadows(campaign, turnId, sheet);
  if (name === "peerless skill") return peerlessSkill(campaign, sheet);
  if (name === "quivering palm") return quiveringPalm(campaign, turnId, sheet, args.targetEnemyId, args.variant);
  if (name === "draconic presence") return draconicPresence(campaign, turnId, sheet, args.variant);
  if (name === "dragon wings") return dragonWings(campaign, sheet, args.variant);
  if (name === "elemental affinity" || name === "elemental affinity resistance") return elementalAffinityResistance(campaign, sheet);
  if (name === "hide in plain sight") return hideInPlainSight(campaign, sheet);
  if (name === "primeval awareness") return primevalAwareness(campaign, sheet, args.amount);
  return null;
}

function spendPool(campaign: Campaign, sheet: CharacterSheet, id: string, amount: number) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const state = fresh.resources[id];
  const updated = patchSheet(fresh.id, { resources: { ...fresh.resources, [id]: { max: state.max, used: state.used + amount } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function poolLeft(sheet: CharacterSheet, id: string): number {
  const state = sheet.resources?.[id];
  return state ? state.max - state.used : 0;
}

function addCondition(campaign: Campaign, sheet: CharacterSheet, condition: string, meta: Record<string, unknown>) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(condition));
  patchSheet(fresh.id, {
    conditions: [...kept, condition],
    conditionMeta: { ...(fresh.conditionMeta as ConditionMetaMap), [condition]: meta },
  });
  publishSheet(campaign, fresh.id);
}

// ---- Peerless Skill ----

function peerlessSkill(campaign: Campaign, sheet: CharacterSheet): ToolResult {
  if (!holdsFeature(sheet, "peerless skill")) {
    return { error: `${sheet.name} does not have Peerless Skill (a College of Lore bard's 14th level feature).`, refused: "rules" };
  }
  if (poolLeft(sheet, "bardic_inspiration") < 1) {
    return { error: `${sheet.name} has no Bardic Inspiration left for Peerless Skill. Nothing was spent.`, refused: "rules" };
  }
  const level = classLevelOf(sheet, "bard") || sheet.level;
  const die = level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6";
  spendPool(campaign, sheet, "bardic_inspiration", 1);
  addCondition(campaign, sheet, `peerless skill (${die})`, { rounds: 10 });
  return { ok: true, resource: "Peerless Skill", applied: `${sheet.name} adds 1${die} to their next ability check; the server rolls it with the check and spends it.` };
}

// ---- Quivering Palm ----

export const QUIVERING = "quivering palm";

// A day of six-second rounds: the vibrations "last for a number of days equal
// to your monk level".
const ROUNDS_A_DAY = 14400;

// "You can choose to end the vibrations harmlessly without using an action":
// the words a call may name that choice with.
const HARMLESS = new Set(["end", "end harmlessly", "harmlessly", "release", "dismiss"]);

// This monk's vibrations off one creature, with no save and no damage.
function stillVibrations(enemy: { id: string; conditions: string[]; conditionMeta: unknown }) {
  const rest = { ...(enemy.conditionMeta as ConditionMetaMap) };
  delete rest[QUIVERING];
  patchEnemyConditions(enemy.id, enemy.conditions.filter((entry) => entry !== QUIVERING), rest as never);
}

function quiveringPalm(campaign: Campaign, turnId: string, sheet: CharacterSheet, targetEnemyId: string | undefined, variant?: string): ToolResult {
  if (!holdsFeature(sheet, "quivering palm")) {
    return { error: `${sheet.name} does not have Quivering Palm (a Way of the Open Hand monk's 17th level feature).`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter && targetEnemyId ? resolveTargetFoe(encounter.campaignId, encounter, targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "Quivering Palm needs targetEnemyId: the living creature the monk struck. Nothing was spent.", retry: true };
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const set = enemy.conditions.includes(QUIVERING) && meta[QUIVERING]?.source === sheet.id;
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.wis;
  if (variant && HARMLESS.has(textKey(variant))) {
    if (!set) {
      return { error: `${enemy.displayName} carries none of ${sheet.name}'s vibrations to end. Nothing was spent.`, refused: "rules" };
    }
    stillVibrations(enemy);
    publishEncounter(campaign.id);
    return { ok: true, resource: "Quivering Palm", cost: "no action", applied: `${sheet.name} lets the vibrations in ${enemy.displayName} fade harmlessly: no save, no damage.` };
  }
  if (!set) {
    const struck = encounter.targets?.round === encounter.round ? (encounter.targets.pairs[sheet.id] ?? []) : [];
    if (!struck.includes(enemy.id)) {
      return { error: `Quivering Palm sets its vibrations with an unarmed strike that hits; ${sheet.name} has not struck ${enemy.displayName} this turn. Nothing was spent.`, refused: "rules" };
    }
    if (poolLeft(sheet, "ki") < 3) {
      return { error: `${sheet.name} needs 3 ki for Quivering Palm. Nothing was spent.`, refused: "rules" };
    }
    spendPool(campaign, sheet, "ki", 3);
    // "You can have only one creature under the effect of this feature at a
    // time": ending the earlier ones harmlessly takes no action, so setting
    // new vibrations does it.
    const earlier = listEnemies(encounter.id).filter(
      (entry) => entry.id !== enemy.id && entry.conditions.includes(QUIVERING) && (entry.conditionMeta as ConditionMetaMap)[QUIVERING]?.source === sheet.id,
    );
    earlier.forEach(stillVibrations);
    const days = classLevelOf(sheet, "monk") || sheet.level;
    patchEnemyConditions(enemy.id, [...enemy.conditions, QUIVERING], {
      ...meta,
      [QUIVERING]: { source: sheet.id, rounds: ROUNDS_A_DAY * days },
    } as typeof enemy.conditionMeta);
    publishEncounter(campaign.id);
    return {
      ok: true,
      resource: "Quivering Palm",
      spent: "3 ki",
      applied: `Vibrations settle in ${enemy.displayName} for ${days} days${earlier.length ? `, and the ones in ${earlier.map((entry) => entry.displayName).join(", ")} fade harmlessly (one creature at a time)` : ""}. ${sheet.name} ends them with their action later (use_resource Quivering Palm again): a CON save against DC ${dc}; variant 'end' lets them fade harmlessly, no action.`,
    };
  }
  const price = priceTheAction(sheet, encounter, "ending Quivering Palm");
  if ("error" in price) {
    return toolError(price);
  }
  const cleared = enemy.conditions.filter((entry) => entry !== QUIVERING);
  const rest = { ...meta };
  delete rest[QUIVERING];
  patchEnemyConditions(enemy.id, cleared, rest as typeof enemy.conditionMeta);
  const save = rollEnemySave(campaign.id, enemy, "con", dc, { resist: true, record: { detail: `${enemy.displayName}: CON save against Quivering Palm` } });
  price.commit();
  const live = listEnemies(encounter.id).find((entry) => entry.id === enemy.id) ?? enemy;
  const amount = save.success ? rollCard(campaign, null, sheet.id, "damage", rollAgainst("Quivering Palm", live.displayName), "10d10", sheetAttacker(sheet)).total : live.currentHp;
  const sheets = listSheets(campaign.id);
  const turn = getDmTurn(turnId);
  // The damage path wants the DM turn; off one, the aura path lands it.
  const applied = turn
    ? applyEnemyDamage(campaign, turn, encounter, live, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), save.success ? "necrotic" : undefined)
    : { applied: hurtEnemy(campaign, encounter, live, amount, save.success ? "necrotic" : "", "Quivering Palm") };
  publishEncounter(campaign.id);
  return {
    ok: true,
    resource: "Quivering Palm",
    cost: "their action",
    save: save.total,
    dc,
    applied: save.success ? `${enemy.displayName} resists the vibrations and takes ${amount} necrotic damage.` : `${enemy.displayName} fails the CON save and drops to 0 hit points.`,
    ...applied,
  };
}

// ---- Hide in Plain Sight ----

export const CAMOUFLAGED = "camouflaged";

function hideInPlainSight(campaign: Campaign, sheet: CharacterSheet): ToolResult {
  if (!holdsFeature(sheet, "hide in plain sight")) {
    return { error: `${sheet.name} does not have Hide in Plain Sight (a ranger's 10th level feature).`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && (encounter.kind ?? "fight") === "fight") {
    return { error: "Hide in Plain Sight takes a minute of preparation, not a moment in the middle of a fight.", refused: "rules" };
  }
  addCondition(campaign, sheet, CAMOUFLAGED, { rounds: 14400 });
  return { ok: true, resource: "Hide in Plain Sight", applied: `${sheet.name} is camouflaged against a solid surface: +10 to Stealth checks while they stay still. Moving, or taking an action or reaction, ends it (clear_condition camouflaged).` };
}

// ---- Primeval Awareness ----

function primevalAwareness(campaign: Campaign, sheet: CharacterSheet, amount: number | undefined): ToolResult {
  if (!holdsFeature(sheet, "primeval awareness")) {
    return { error: `${sheet.name} does not have Primeval Awareness (a ranger's 3rd level feature).`, refused: "rules" };
  }
  const slots = sheet.spellcasting?.slots ?? {};
  const wanted = amount && amount >= 1 ? Math.floor(amount) : null;
  const level = wanted ?? Object.keys(slots).map(Number).sort((a, b) => a - b).find((entry) => slots[String(entry)].used < slots[String(entry)].max);
  const slot = level ? slots[String(level)] : undefined;
  if (!level || !slot || slot.used >= slot.max || !sheet.spellcasting) {
    return wanted
      ? spentSlotRefusal(sheet.name, sheet.spellcasting, { level: wanted, lowest: 1, what: "Primeval Awareness", withPact: false })
      : { error: `${sheet.name} has no free spell slot to spend on Primeval Awareness. Nothing was spent.`, refused: "rules" };
  }
  const updated = patchSheet(sheet.id, {
    spellcasting: { ...sheet.spellcasting, slots: { ...slots, [String(level)]: { max: slot.max, used: slot.used + 1 } } },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  // The minutes it lasts are on the clock: one a level of the slot.
  addCondition(campaign, updated ?? sheet, "primeval awareness", { rounds: level * 10 });
  return {
    ok: true,
    resource: "Primeval Awareness",
    spent: `a level ${level} spell slot`,
    applied: `For ${level} minute${level === 1 ? "" : "s"}, ${sheet.name} senses whether aberrations, celestials, dragons, elementals, fey, fiends or undead are within 1 mile (6 in their favored terrain): their kind, not their number or place.`,
  };
}
