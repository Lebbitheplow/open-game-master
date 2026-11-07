// A Draconic Bloodline sorcerer's spends (SRD 5.1, Sorcerer), resolved by
// the engine through use_resource (src/lib/dm/srd-feature-spends.ts):
//
//   - Elemental Affinity (6): "you can spend 1 sorcery point to gain
//     resistance to that damage type for 1 hour", the dragon ancestor's type
//     (src/lib/srd/dragon-ancestor.ts). The condition "elemental affinity
//     (fire)" carries the type, read as resistance by condition-effects.ts.
//     Only its Charisma bonus to damage was built; the resistance was not.
//   - Dragon Wings (14): a bonus action sprouts the wings, a flying speed
//     equal to the current speed until a bonus action dismisses them; never
//     while wearing armor. The condition "dragon wings" holds the flight
//     (src/lib/battlemap/types.ts flyingSpeedOf); any feature named for wings
//     used to fly for good.
//   - Draconic Presence (18): 5 sorcery points and the action raise an aura
//     of awe (charmed) or fear (frightened) to 60 feet for a minute, held by
//     concentration. It was one save at once; the SRD has each hostile
//     creature save as it STARTS ITS TURN in the aura, and one that succeeds
//     is immune to it for 24 hours (draconicPresenceTurnStart below, called
//     from turn-start-effects.ts as Holy Nimbus is).
//
// Issue #833. Must not import mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { wearsBodyArmor } from "@/lib/srd/authored-effects";
import { chosenElementType, chosenElementWords } from "@/lib/srd/dragon-ancestor";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { setConcentration } from "@/lib/dm/concentration";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { feetBetween, priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import { AFFINITY_CAST, affinityCastType } from "@/lib/dm/affinity-cast";

// The condition names the three features leave.
export const ELEMENTAL_AFFINITY = "elemental affinity";
export const DRAGON_WINGS = "dragon wings";
export const DRACONIC_PRESENCE = "draconic presence";
// The mark a creature carries for 24 hours once it withstood the aura, one
// per sorcerer ("withstood draconic presence (Ysolde)"): a second sorcerer's
// aura is not the first's, and one shared mark let each overwrite the other's
// immunity (issue #833 review).
export const PRESENCE_WITHSTOOD = "withstood draconic presence";
export function presenceMark(sheet: Pick<CharacterSheet, "name">): string {
  return `${PRESENCE_WITHSTOOD} (${sheet.name})`;
}

const HOUR_ROUNDS = 600;
const DAY_ROUNDS = 14400;
const PRESENCE_FEET = 60;

function poolLeft(sheet: CharacterSheet, id: string): number {
  const state = sheet.resources?.[id];
  return state ? state.max - state.used : 0;
}

function spendPoints(campaign: Campaign, sheet: CharacterSheet, amount: number) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const state = fresh.resources.sorcery_points;
  const updated = patchSheet(fresh.id, { resources: { ...fresh.resources, sorcery_points: { max: state.max, used: state.used + amount } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function setOwnCondition(campaign: Campaign, sheet: CharacterSheet, condition: string, meta: Record<string, unknown> | null, family?: string) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const drop = (entry: string) => textKey(entry) === textKey(condition) || (family !== undefined && textKey(entry).startsWith(textKey(family)));
  const kept = fresh.conditions.filter((entry) => !drop(entry));
  const keptMeta = Object.fromEntries(Object.entries((fresh.conditionMeta ?? {}) as ConditionMetaMap).filter(([name]) => !drop(name)));
  patchSheet(fresh.id, {
    conditions: meta ? [...kept, condition] : kept,
    conditionMeta: (meta ? { ...keptMeta, [condition]: meta } : keptMeta) as CharacterSheet["conditionMeta"],
  });
  publishSheet(campaign, fresh.id);
}

// ---- Elemental Affinity ----

export function elementalAffinityResistance(campaign: Campaign, sheet: CharacterSheet): ToolResult {
  if (!holdsFeature(sheet, "elemental affinity")) {
    return { error: `${sheet.name} does not have Elemental Affinity (a Draconic Bloodline sorcerer's 6th level feature).`, refused: "rules" };
  }
  // The dragon's damage type, or the element a workshop bloodline's choice
  // names (issue #833).
  const type = chosenElementType(sheet);
  if (!type) {
    return {
      error: `${sheet.name} has no dragon ancestor or element chosen, so Elemental Affinity has no damage type to resist. The player makes that choice on the character sheet first. Nothing was spent.`,
      refused: "rules",
    };
  }
  // SRD 5.1: the point is spent "when you cast a spell that deals damage of
  // the type", so only after such a spell (src/lib/dm/affinity-cast.ts).
  if (affinityCastType(sheet) !== type) {
    return {
      error: `Elemental Affinity's resistance comes with a spell that deals ${type} damage, the type of ${chosenElementWords(sheet)}, as it is cast; ${sheet.name} has cast none this turn. Nothing was spent.`,
      refused: "rules",
    };
  }
  if (poolLeft(sheet, "sorcery_points") < 1) {
    return { error: `${sheet.name} has no sorcery point left for Elemental Affinity's resistance. Nothing was spent.`, refused: "rules" };
  }
  spendPoints(campaign, sheet, 1);
  // The cast's mark goes with the spend: one resistance per spell.
  setOwnCondition(campaign, sheet, `${AFFINITY_CAST} (${type})`, null, AFFINITY_CAST);
  setOwnCondition(campaign, sheet, `${ELEMENTAL_AFFINITY} (${type})`, { rounds: HOUR_ROUNDS, source: sheet.id }, ELEMENTAL_AFFINITY);
  return {
    ok: true,
    resource: "Elemental Affinity",
    spent: "1 sorcery point",
    applied: `${sheet.name} resists ${type} damage for 1 hour, the damage of ${chosenElementWords(sheet)}.`,
  };
}

// ---- Dragon Wings ----

export function dragonWings(campaign: Campaign, sheet: CharacterSheet, variant: string | undefined): ToolResult {
  if (!holdsFeature(sheet, "dragon wings")) {
    return { error: `${sheet.name} does not have Dragon Wings (a Draconic Bloodline sorcerer's 14th level feature).`, refused: "rules" };
  }
  const out = sheet.conditions.some((entry) => textKey(entry) === DRAGON_WINGS);
  const wanted = textKey(variant ?? "");
  if (wanted && wanted !== "manifest" && wanted !== "dismiss") {
    return { error: `Dragon Wings takes variant 'manifest' or 'dismiss', or none to switch them; "${variant}" is neither. Nothing was spent.`, retry: true };
  }
  const dismiss = wanted ? wanted === "dismiss" : out;
  if (dismiss && !out) {
    return { error: `${sheet.name}'s dragon wings are not out; there is nothing to dismiss.`, refused: "rules" };
  }
  if (!dismiss && out) {
    return { error: `${sheet.name}'s dragon wings are already out; they stay until dismissed with a bonus action.`, refused: "rules" };
  }
  if (!dismiss) {
    if (wearsBodyArmor(sheet)) {
      const armor = acBreakdownFor(sheet).armorName ?? "armor";
      return {
        error: `${sheet.name} is wearing ${armor}, and dragon wings cannot sprout through armor unless it is made for them. They take it off first. Nothing was spent.`,
        refused: "rules",
      };
    }
  }
  const encounter = getActiveEncounter(campaign.id);
  const price = priceTheAction(sheet, encounter, dismiss ? "dismissing Dragon Wings" : "Dragon Wings", "bonus");
  if ("error" in price) {
    return toolError(price);
  }
  price.commit();
  setOwnCondition(campaign, sheet, DRAGON_WINGS, dismiss ? null : { source: sheet.id });
  return {
    ok: true,
    resource: "Dragon Wings",
    cost: "their bonus action",
    applied: dismiss
      ? `${sheet.name} folds their dragon wings away and loses the flying speed.`
      : `Dragon wings sprout from ${sheet.name}'s back: a flying speed equal to their current speed until they dismiss them with a bonus action.`,
  };
}

// ---- Draconic Presence ----

export function draconicPresence(campaign: Campaign, turnId: string, sheet: CharacterSheet, variant: string | undefined): ToolResult {
  if (!holdsFeature(sheet, "draconic presence")) {
    return { error: `${sheet.name} does not have Draconic Presence (a Draconic Bloodline sorcerer's 18th level feature).`, refused: "rules" };
  }
  // Awe (charmed) or fear (frightened), the sorcerer's choice: the variant
  // names one, never a default.
  const wanted = textKey(variant ?? "");
  const condition = wanted === "charm" || wanted === "awe" ? "charmed" : wanted === "fear" ? "frightened" : null;
  if (!condition) {
    return { error: `Draconic Presence takes variant 'fear' or 'charm'${wanted ? `; "${variant}" is neither` : ""}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
  }
  if (poolLeft(sheet, "sorcery_points") < 5) {
    return { error: `${sheet.name} needs 5 sorcery points for Draconic Presence. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "Draconic Presence answers creatures in a fight; there is none. Nothing was spent.", refused: "rules" };
  }
  const price = priceTheAction(sheet, encounter, "Draconic Presence");
  if ("error" in price) {
    return toolError(price);
  }
  spendPoints(campaign, sheet, 5);
  price.commit();
  setConcentration(campaign, turnId, sheet.id, "Draconic Presence");
  // The aura on the sorcerer, ended with the concentration
  // (concentration.ts clearSpellConditionsByName reads its spell).
  setOwnCondition(campaign, sheet, DRACONIC_PRESENCE, { source: sheet.id, spell: "Draconic Presence", rounds: 10, aura: condition }, DRACONIC_PRESENCE);
  return {
    ok: true,
    resource: "Draconic Presence",
    spent: "5 sorcery points",
    cost: "their action",
    concentration: "Draconic Presence",
    applied: `An aura of ${condition === "charmed" ? "awe" : "fear"} spreads 60 feet from ${sheet.name} for a minute: each hostile creature that starts its turn in it makes a WIS save against their spell save DC or is ${condition} until the aura ends; one that succeeds is immune to it for 24 hours. The server rolls those saves as each turn starts.`,
  };
}

// The hostile creatures whose turns are starting inside a sorcerer's
// Draconic Presence save or fall under it. Returns the table lines.
export function draconicPresenceTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const sorcerers = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => sheet.currentHp > 0 && sheet.conditions.some((entry) => textKey(entry) === DRACONIC_PRESENCE) && textKey(sheet.concentratingOn ?? "") === DRACONIC_PRESENCE);
  if (!sorcerers.length) {
    return lines;
  }
  const starting = new Set(combatantIds);
  let changed = false;
  for (const sheet of sorcerers) {
    const aura = (sheet.conditionMeta as ConditionMetaMap)?.[DRACONIC_PRESENCE] as { aura?: string; rounds?: number } | undefined;
    const condition = aura?.aura === "charmed" ? "charmed" : "frightened";
    const dc = computeSheetDerived(sheet).spellSaveDc ?? 13;
    for (const enemy of listEnemies(encounter.id)) {
      if (!starting.has(enemy.id) || enemy.status !== "alive") {
        continue;
      }
      const feet = feetBetween(encounter.id, sheet.id, enemy.id);
      if ((feet !== null && feet > PRESENCE_FEET) || swallowCoverBetween(sheet.id, enemy.id)) {
        continue;
      }
      const meta = (enemy.conditionMeta ?? {}) as ConditionMetaMap;
      const held = enemy.conditions.some((entry) => entry === condition && meta[condition]?.spell === "Draconic Presence" && meta[condition]?.source === sheet.id);
      const mark = presenceMark(sheet);
      const immune = enemy.conditions.some((entry) => textKey(entry) === textKey(mark) && meta[entry]?.source === sheet.id);
      if (held || immune) {
        continue;
      }
      if (String(enemy.stats.conditionImmune ?? "").toLowerCase().includes(condition)) {
        lines.push(`${enemy.displayName} starts its turn in ${sheet.name}'s Draconic Presence and cannot be ${condition}.`);
        continue;
      }
      const save = rollEnemySave(campaign.id, enemy, "wis", dc, { magical: true, resist: true, against: condition, record: { detail: `${enemy.displayName}: WIS save against Draconic Presence` } });
      if (save.success) {
        patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => textKey(entry) !== textKey(mark)), mark], {
          ...meta,
          [mark]: { source: sheet.id, rounds: DAY_ROUNDS },
        } as typeof enemy.conditionMeta);
        lines.push(`${enemy.displayName} starts its turn in ${sheet.name}'s Draconic Presence and withstands it (WIS ${save.total} vs DC ${dc}); it is immune to it for 24 hours.`);
      } else {
        patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => entry !== condition), condition], {
          ...meta,
          // Until the aura ends: with the concentration, or as its minute runs out.
          [condition]: { source: sheet.id, spell: "Draconic Presence", rounds: aura?.rounds ?? 10 },
        } as typeof enemy.conditionMeta);
        lines.push(`${enemy.displayName} starts its turn in ${sheet.name}'s Draconic Presence and is ${condition} until the aura ends (WIS ${save.total} vs DC ${dc}).`);
      }
      changed = true;
    }
  }
  if (changed) {
    publishEncounter(campaign.id);
  }
  return lines;
}
