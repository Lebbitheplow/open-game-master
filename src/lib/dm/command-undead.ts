// The features that hand an undead to the character who used them: Control
// Undead (Oath of the Oathbreaker, Channel Divinity: "one undead creature you
// can see within 30 feet of you ... must make a Wisdom saving throw. On a
// failed save, the target must obey your commands for the next 24 hours, or
// until you use this Channel Divinity option again. An undead whose challenge
// rating is equal to or greater than your paladin level is immune") and
// Command Undead (School of Necromancy: a Charisma save, "it becomes friendly
// to you and obeys your commands until you use this feature again").
//
// Before this Control Undead spent the use and did nothing, and Command
// Undead laid a plain "charmed" that left the creature fighting for its old
// side. The charm now names the feature and its holder, so the creature
// fights on the holder's side for as long as it lasts
// (src/lib/dm/combat-sides-logic.ts dominatorOf), and the holder's next use
// lets the last one go.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { addConditionInstance, removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import { getDmTurn } from "@/lib/db/dm-turns";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import { computeSheetDerived } from "@/lib/srd";
import { classLevelOf } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
const CONTROL_RANGE_FEET = 30;

export const CHARMED = "charmed";
// 24 hours, in six-second rounds.
export const DAY_ROUNDS = 14_400;

// Whether the creature is an undead, by its block's type (creature-type.ts
// reads "Undead (shapechanger)" as undead).
export function isUndead(stats: { type?: string }): boolean {
  return creatureTypeOf(stats) === "undead";
}

// Control Undead's immunity: "an undead whose challenge rating is equal to or
// greater than your paladin level is immune". A block with no challenge
// rating is read as beyond any level, as Turn Undead reads it.
export function immuneToControl(cr: unknown, paladinLevel: number): boolean {
  const rating = Number(cr);
  return !Number.isFinite(rating) || rating >= paladinLevel;
}

const ownCharm = (holderId: string, feature: string) => (entry: { spell?: string; source?: string }) =>
  entry.source === holderId && textKey(entry.spell ?? "") === textKey(feature);

// Ends the holder's last use: the creature it commanded goes back to its own
// side. Every enemy of the fight and every sheet of the campaign is read, so
// a creature that lasted past its fight is let go as well. Those let go.
export function releaseCommanded(campaign: Campaign, holderId: string, feature: string): Array<{ id: string; name: string }> {
  const freed: Array<{ id: string; name: string }> = [];
  const encounter = getActiveEncounter(campaign.id);
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    const next = removeConditionInstances(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, CHARMED, ownCharm(holderId, feature));
    if (next.removed) {
      patchEnemyConditions(enemy.id, next.conditions, next.meta as EncounterEnemy["conditionMeta"]);
      freed.push({ id: enemy.id, name: enemy.displayName });
    }
  }
  for (const sheet of listSheets(campaign.id)) {
    const next = removeConditionInstances(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, CHARMED, ownCharm(holderId, feature));
    if (next.removed) {
      const updated = patchSheet(sheet.id, { conditions: next.conditions, conditionMeta: next.meta });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
      freed.push({ id: sheet.id, name: sheet.name });
    }
  }
  if (freed.length) {
    publishEncounter(campaign.id);
  }
  return freed;
}

// Lays the commanding charm on the creature, after letting the holder's last
// one go. `rounds`: how long it lasts (null until the holder uses it again).
// False when the creature cannot be charmed at all.
export function commandCreature(
  campaign: Campaign,
  enemy: EncounterEnemy,
  holderId: string,
  feature: string,
  rounds: number | null,
  immune: (enemy: EncounterEnemy) => boolean,
): { commanded: boolean; freed: string[] } {
  const freed = releaseCommanded(campaign, holderId, feature).filter((entry) => entry.id !== enemy.id).map((entry) => entry.name);
  const fresh = getEnemy(enemy.id) ?? enemy;
  if (immune(fresh)) {
    return { commanded: false, freed };
  }
  const placed = addConditionInstance(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, CHARMED, {
    source: holderId,
    spell: feature,
    ...(rounds ? { rounds } : {}),
  });
  patchEnemyConditions(fresh.id, placed.conditions, placed.meta as EncounterEnemy["conditionMeta"]);
  publishEncounter(campaign.id);
  return { commanded: true, freed };
}

// A class feature's save DC, "your spell save DC" for that class: the sheet's
// own DC when its spellcasting ability is the class's, else 8 + proficiency +
// the class's ability modifier (a paladin 3 / wizard 5 reads Charisma for
// Control Undead, not the wizard's Intelligence).
export function classSaveDc(sheet: CharacterSheet, ability: Ability): number {
  const derived = computeSheetDerived(sheet);
  if (derived.spellSaveDc !== null && derived.spellSaveDc !== undefined && sheet.spellcasting?.ability === ability) {
    return derived.spellSaveDc;
  }
  return 8 + derived.proficiencyBonus + derived.abilityMods[ability];
}

// Control Undead (Oath of the Oathbreaker 3): one undead the paladin can see
// within 30 feet makes a Wisdom save against the paladin's spell DC, or obeys
// them for 24 hours, or until they use this option again
// (src/lib/dm/command-undead.ts). One at or above the paladin's level in
// challenge rating is immune, which is said before anything is spent.
export function controlUndead(campaign: Campaign, turnId: string, sheet: CharacterSheet, targetEnemyId: string | undefined): ToolError | { result: Record<string, unknown> } {
  const encounter = getActiveEncounter(campaign.id)!;
  if (!targetEnemyId) {
    return { error: "Control Undead names one undead in the fight: pass targetEnemyId. Channel Divinity was not spent.", retry: true };
  }
  const enemy = resolveTargetFoe(campaign.id, encounter, targetEnemyId);
  if (!enemy || enemy.status !== "alive" || enemy.currentHp <= 0) {
    return { error: `No standing creature ${targetEnemyId} is in the fight. Channel Divinity was not spent.`, retry: true };
  }
  if (!isUndead(enemy.stats)) {
    return { error: `${enemy.displayName} is not an undead (${creatureTypeOf(enemy.stats)}); Control Undead takes an undead. Nothing was spent.`, refused: "rules" };
  }
  const level = classLevelOf(sheet, "paladin");
  const cr = enemy.stats.cr ?? enemy.cr;
  if (immuneToControl(cr, level)) {
    return { error: `${enemy.displayName} is immune: its challenge rating (${cr ?? "unknown"}) is not below ${sheet.name}'s paladin level (${level}). Nothing was spent.`, refused: "rules" };
  }
  if (!withinFeet(encounter.id, sheet.id, enemy.id, CONTROL_RANGE_FEET) || swallowCoverBetween(sheet.id, enemy.id)) {
    return { error: `${enemy.displayName} is beyond ${CONTROL_RANGE_FEET} feet of ${sheet.name}; Control Undead reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const unseen = unseenBecause(encounter.id, sheet, enemy);
  if (unseen) {
    return { error: `${sheet.name} cannot see ${enemy.displayName} (${unseen}), and Control Undead takes a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  const dc = classSaveDc(sheet, "cha");
  const turn = getDmTurn(turnId);
  const save = rollEnemySave(campaign.id, enemy, "wis", dc, {
    magical: true,
    resist: true,
    against: CHARMED,
    record: { ...(turn ? { turn } : {}), detail: `${enemy.displayName}: WIS save against Control Undead` },
  });
  if (save.success) {
    return {
      result: {
        controlUndead: `${enemy.displayName} resists (WIS ${save.total ?? "?"} vs DC ${dc})${save.legendaryResistance ? " with Legendary Resistance" : ""}.`,
      },
    };
  }
  const placed = commandCreature(campaign, enemy, sheet.id, "Control Undead", DAY_ROUNDS, (fresh) => immuneToCondition(fresh, CHARMED));
  if (!placed.commanded) {
    return { result: { controlUndead: `${enemy.displayName} failed the save (WIS ${save.total ?? "failed"} vs DC ${dc}) but cannot be charmed.` } };
  }
  return {
    result: {
      controlUndead: `${enemy.displayName} fails (WIS ${save.total ?? "failed"} vs DC ${dc}) and obeys ${sheet.name} for 24 hours, or until they use Control Undead again.`,
      ...(placed.freed.length ? { released: `${placed.freed.join(", ")} no longer obeys ${sheet.name}.` } : {}),
      note: commandedNote(sheet.name, enemy.displayName),
    },
  };
}

// What the model is told once the creature is the holder's.
export function commandedNote(holder: string, creature: string): string {
  return `${creature} now fights on ${holder}'s side and obeys ${holder}'s commands: give it a standing order with declare_intent (its enemyId and the creature to attack), and the server runs its turns against ${holder}'s foes. It still will not attack ${holder}.`;
}

// The sheet holder's name, read fresh.
export function holderName(holderId: string, fallback: string): string {
  return getSheetById(holderId)?.name ?? fallback;
}
