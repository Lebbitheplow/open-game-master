// The authored subclass features that act as a turn starts or ends and as
// a rest ends (src/lib/srd/authored-effects.ts): Elder Champion's 10 hit
// points, Aura of Conquest and Dread Lord on the enemies near the paladin,
// Protective Spirit, Celestial Resilience. Split from authored-hooks.ts,
// which holds the attack moments.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { computeSheetDerived } from "@/lib/srd";
import { activeAuthored, resolveFormula } from "@/lib/srd/authored-effects";
import { effectiveMaxHp, incapacitatedBy, removeConditionInstances, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { withActor } from "@/lib/dm/acting-party";
import { regainHitPoints } from "@/lib/dm/regain";
import { risesWithVengeance, searingVengeance } from "@/lib/dm/searing-vengeance";

function fielded(campaignId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => !sheet.deathSaves?.dead && sheet.currentHp > 0);
}

function modsOf(sheet: CharacterSheet): Record<string, number> {
  return computeSheetDerived(sheet).abilityMods;
}

function reach(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 10;
  for (const [atLevel, value] of range) {
    if (level >= atLevel) {
      feet = value;
    }
  }
  return feet;
}

function heal(campaign: Campaign, sheet: CharacterSheet, amount: number): number {
  // Under the heal tool's rules (regain.ts), audited: the turn that moved the
  // pointer takes it back (issue #622).
  return regainHitPoints(campaign, null, sheet, amount, "a feature, as their turn starts");
}

function setTempHp(campaign: Campaign, sheet: CharacterSheet, amount: number): boolean {
  if (amount <= sheet.tempHp) {
    return false;
  }
  patchSheetAudited(campaign.id, sheet.id, { tempHp: amount }, { kind: "grant_temp_hp", reason: "a feature, as their turn starts", delta: { tempHp: amount } });
  return true;
}

// ---- turns ----

// Combatants whose turns are starting: Elder Champion's 10 hit points; an
// enemy near an aura that hurts it (Aura of Conquest on the frightened,
// Dread Lord's darkness).
export function authoredTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const holders = fielded(campaign.id);
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (sheet && !sheet.deathSaves?.dead) {
      // A dying warlock's turn the pointer stopped on starts with the rise
      // their death save would have been (searing-vengeance.ts).
      if (risesWithVengeance(sheet)) {
        lines.push(...searingVengeance(campaign, sheet));
      }
      for (const { effect, held } of activeAuthored(sheet, "turn_heal")) {
        if (effect.when !== "start") {
          continue;
        }
        const amount = rollCard(campaign, null, sheet.id, "custom", `${held.feature}: hit points regained`, resolveFormula(effect.formula, held.level, modsOf(sheet)), null).total;
        const given = heal(campaign, getSheetById(id) ?? sheet, amount);
        if (given > 0) {
          lines.push(`${held.feature}: ${sheet.name} regains ${given} hit points.`);
        }
      }
      continue;
    }
    const enemy = getEnemy(id);
    if (!enemy || enemy.status !== "alive") {
      continue;
    }
    for (const holder of holders) {
      for (const { effect, held } of activeAuthored(holder, "enemy_turn_damage")) {
        const live = getEnemy(id);
        if (!live || live.status !== "alive") {
          break;
        }
        if (!withinFeet(encounter.id, holder.id, id, reach(effect.rangeFt, held.level))) {
          continue;
        }
        if (effect.frightenedOnly) {
          const scared = live.conditions.find((entry) => textKey(entry) === "frightened");
          if (!scared || (live.conditionMeta as ConditionMetaMap)[scared]?.source !== holder.id) {
            continue;
          }
        }
        const amount = rollCard(campaign, null, holder.id, "damage", rollAgainst(held.feature, live.displayName), resolveFormula(effect.formula, held.level, modsOf(holder)), sheetAttacker(holder)).total;
        if (amount > 0) {
          // The feature's holder is whose damage it is (acting-party.ts).
          lines.push(withActor({ kind: "sheet", ref: holder.id }, () => hurtEnemy(campaign, encounter, live, amount, effect.type, held.feature)));
        }
      }
    }
  }
  return lines;
}

// Combatants whose turns are ending: Protective Spirit, Twilight Sanctuary.
export function authoredTurnEnd(campaign: Campaign, combatantIds: string[]): string[] {
  const lines: string[] = [];
  lines.push(...turnEndAuras(campaign, combatantIds));
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (!sheet || sheet.deathSaves?.dead || sheet.currentHp <= 0) {
      continue;
    }
    for (const { effect, held } of activeAuthored(sheet, "turn_heal")) {
      if (effect.when !== "end") {
        continue;
      }
      const now = getSheetById(id) ?? sheet;
      if (effect.belowHalf && now.currentHp >= Math.ceil(effectiveMaxHp(now) / 2)) {
        continue;
      }
      const amount = rollCard(campaign, null, now.id, "custom", `${held.feature}: hit points regained`, resolveFormula(effect.formula, held.level, modsOf(now)), null).total;
      const given = heal(campaign, now, amount);
      if (given > 0) {
        lines.push(`${held.feature}: ${now.name} regains ${given} hit points.`);
      }
    }
  }
  return lines;
}

// Twilight Sanctuary: a character who ends a turn in the cleric's sphere loses
// one charm or fear on them or, with none, gains temporary hit points. The text
// leaves the pick to the cleric; ending the charm or fear is the pick that
// matters whenever there is one, and temporary hit points never stack, so the
// lower roll changes nothing. Before this the sanctuary spent the use and the
// GM had to remember it every turn for a minute.
function turnEndAuras(campaign: Campaign, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const encounter = getActiveEncounter(campaign.id);
  // The sanctuary ends with its cleric incapacitated or dead, not only waits:
  // stunned for a round, the cleric's sphere does not come back.
  for (const stale of listSheets(campaign.id)) {
    const holder = getSheetById(stale.id) ?? stale;
    if (!(holder.deathSaves?.dead || holder.currentHp <= 0 || incapacitatedBy(holder.conditions))) {
      continue;
    }
    for (const { effect, held } of activeAuthored(holder, "turn_end_aura")) {
      const gate = effect.gate && "condition" in effect.gate ? effect.gate.condition : undefined;
      const now = getSheetById(holder.id) ?? holder;
      const ended = gate ? now.conditions.filter((entry) => isConditionNamed(entry, gate)) : [];
      if (ended.length) {
        const cleared = removeConditions(now.conditions, now.conditionMeta, ended);
        patchSheetAudited(campaign.id, now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, { kind: "set_condition", reason: `${held.feature} ends`, delta: { removed: ended.join(", ") } });
        lines.push(`${held.feature} ends: ${now.name} is ${now.deathSaves?.dead ? "dead" : "incapacitated"}.`);
      }
    }
  }
  const holders = fielded(campaign.id).filter((holder) => !incapacitatedBy(holder.conditions) && activeAuthored(holder, "turn_end_aura").length);
  for (const id of combatantIds) {
    for (const holder of holders) {
      for (const { effect, held } of activeAuthored(holder, "turn_end_aura")) {
        const now = getSheetById(id);
        if (!now || now.deathSaves?.dead || (encounter && !withinFeet(encounter.id, holder.id, id, effect.rangeFt))) {
          continue;
        }
        const ending = effect.ends.find((name) => now.conditions.some((entry) => isConditionNamed(entry, name)));
        if (ending) {
          // One effect: a second charm from another source holds.
          let taken = false;
          const next = removeConditionInstances(now.conditions, now.conditionMeta as ConditionMetaMap, ending, () => !taken && (taken = true));
          patchSheetAudited(campaign.id, id, { conditions: next.conditions, conditionMeta: next.meta }, { kind: "set_condition", reason: `${held.feature} (${holder.name})`, delta: { removed: ending } });
          lines.push(`${held.feature}: ${now.name} is no longer ${ending}${next.ended ? "" : " by one of its sources"}.`);
          continue;
        }
        const amount = rollCard(campaign, null, holder.id, "custom", `${held.feature}: temporary hit points`, resolveFormula(effect.tempHp, held.level, modsOf(holder)), null).total;
        if (setTempHp(campaign, now, amount)) {
          lines.push(`${held.feature}: ${now.name} gains ${amount} temporary hit points.`);
        }
      }
    }
  }
  return lines;
}

// ---- rests ----

// Celestial Resilience: temporary hit points when a rest ends, for the
// warlock and up to five others. Temporary hit points never stack.
export function authoredRestTempHp(campaign: Campaign, restedIds: string[]): string[] {
  const lines: string[] = [];
  const rested = restedIds.map((id) => getSheetById(id)).filter((sheet): sheet is CharacterSheet => Boolean(sheet && !sheet.deathSaves?.dead));
  for (const holder of rested) {
    for (const { effect, held } of activeAuthored(holder, "rest_temp_hp")) {
      const mods = modsOf(holder);
      const own = Number(resolveFormula(effect.formula, held.level, mods)) || 0;
      if (setTempHp(campaign, getSheetById(holder.id) ?? holder, own)) {
        lines.push(`${held.feature}: ${holder.name} gains ${own} temporary hit points.`);
      }
      if (effect.allies) {
        const each = Number(resolveFormula(effect.allies.formula, held.level, mods)) || 0;
        for (const ally of rested.filter((entry) => entry.id !== holder.id).slice(0, effect.allies.count)) {
          if (setTempHp(campaign, getSheetById(ally.id) ?? ally, each)) {
            lines.push(`${held.feature}: ${ally.name} gains ${each} temporary hit points.`);
          }
        }
      }
    }
  }
  return lines;
}
