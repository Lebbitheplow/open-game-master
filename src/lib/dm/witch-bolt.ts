// Witch Bolt's beam: a hit connects it to its target, and on each of the
// caster's later turns their action deals its damage automatically, with no
// slot and no attack roll. The spell ends if their action goes on anything
// else, or if the target moves out of range or gains total cover
// (src/lib/srd/authored-spells.json, the table's own restatement of the 2014
// Player's Handbook spell, which is not in SRD 5.1).
//
// The connection is a condition on the target, laid for the spell by this
// caster, so it ends with their concentration as every spell condition does
// (concentration.ts clearSpellConditionsByName).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { spellMechanicsFor } from "@/lib/content";
import { actionsSpent, budgetApplies, type TurnBudget } from "@/lib/dm/action-budget";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { storeBudget } from "@/lib/dm/turn-budget";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { spellReachTiles } from "@/lib/dm/cast-reach";
import { breakConcentration } from "@/lib/dm/concentration";
import { addConditionInstance, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { getFoe } from "@/lib/dm/sheet-foe";
import { heldBySpell } from "@/lib/dm/spell-effects";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

const BEAM = "witch bolt";

// Whether this caster's concentration is holding a spell whose later effect
// lands by itself (the mech row's repeatDice).
export function beamHeld(sheet: Pick<CharacterSheet, "concentratingOn">, spell: string, mech: SpellMech | null | undefined): boolean {
  return Boolean(mech?.repeatDice) && Boolean(sheet.concentratingOn) && textKey(sheet.concentratingOn ?? "") === textKey(spell);
}

// Whether this turn has spent an action on something other than the beam.
function actionWentElsewhere(budget: TurnBudget): boolean {
  return actionsSpent(budget) > (budget.beamActions ?? 0);
}

// This action went on the beam: the casting that connected it, or a strike.
export function noteBeamAction(campaignId: string, casterId: string) {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (encounter && budgetApplies(budget, casterId, encounter.round)) {
    storeBudget(encounter, { ...budget, beamActions: (budget.beamActions ?? 0) + 1 });
  }
}

// The caster's turn is ending: an action that went elsewhere ended the spell.
// The encounter is the one the pointer is leaving, its budget still that turn's.
export function beamTurnEnd(campaign: Campaign, encounter: Encounter, casterId: string): string | null {
  const budget = encounter.turnBudget ?? null;
  if (!budgetApplies(budget, casterId, encounter.round) || !actionWentElsewhere(budget)) {
    return null;
  }
  const sheet = getSheetById(casterId);
  const held = sheet?.concentratingOn ? spellMechanicsFor({ spell: sheet.concentratingOn, userIds: spellAuthorsFor(campaign) }) : null;
  if (!sheet || !held || !beamHeld(sheet, held.name, held.mech)) {
    return null;
  }
  breakConcentration(campaign, null, sheet.id, `${held.name} ended: their action went on something else`);
  return `${sheet.name}'s ${held.name} ends: their action went on something else.`;
}

type Target = { id: string; displayName: string; conditions: string[]; conditionMeta: unknown };

// Whether this caster's beam is connected to this creature.
export function beamConnected(sheet: Pick<CharacterSheet, "id">, target: Pick<Target, "conditions" | "conditionMeta">, spell: string): boolean {
  const meta = target.conditionMeta as ConditionMetaMap;
  return target.conditions.some((name) => heldBySpell(name, meta[name], new Set([textKey(spell)]), new Set(), sheet.id));
}

// Why the beam cannot strike this creature now, or null. A target out of range
// or behind total cover ends the spell, as its text says.
export function beamProblem(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  encounterId: string,
  target: Target,
  spell: string,
  facts: SpellFacts | null,
): ToolError | null {
  if (!beamConnected(sheet, target, spell)) {
    return { error: `${spell}'s beam is not connected to ${target.displayName}, so nothing lands on it. A new casting at it goes through pc_attack. Nothing was spent.`, refused: "rules" };
  }
  // Action Surge can leave an action after one spent elsewhere: the spell ended there.
  const fight = getActiveEncounter(campaign.id);
  const turn = fight?.turnBudget ?? null;
  if (fight && budgetApplies(turn, sheet.id, fight.round) && actionWentElsewhere(turn)) {
    breakConcentration(campaign, turnId, sheet.id, `${spell} ended: their action went on something else`);
    return { error: `${spell} ends: ${sheet.name}'s action went on something else this turn. Nothing was spent.`, refused: "rules" };
  }
  const apart = tilesBetween(encounterId, sheet.id, target.id);
  const reach = spellReachTiles(facts);
  // As any spell's reach reads the board (cast-reach.ts): a wall does not part
  // creatures side by side.
  const gone =
    apart === null
      ? null
      : reach !== null && apart > reach
        ? `${target.displayName} is out of its range`
        : apart > 1 && wallBetween(encounterId, sheet.id, target.id)
          ? `${target.displayName} has total cover`
          : null;
  if (gone) {
    breakConcentration(campaign, turnId, sheet.id, `${spell} ended: ${gone}`);
    return { error: `${spell} ends: ${gone}. Nothing was spent.`, refused: "rules" };
  }
  return null;
}

// The hit connects the beam, to an enemy or a character on the other side.
// Returns the line for the result.
export function connectBeam(campaign: Campaign, enemyId: string, casterId: string, spell: string): string | null {
  const foe = getFoe(enemyId);
  if (!foe || foe.status !== "alive") {
    return null;
  }
  const laid = addConditionInstance(foe.conditions, foe.conditionMeta as ConditionMetaMap, BEAM, { spell, source: casterId });
  patchEnemyConditions(foe.id, laid.conditions, laid.meta);
  publishEncounter(campaign.id);
  noteBeamAction(campaign.id, casterId);
  return `The beam stays connected. On later turns ${spell} deals its damage again for an action, with no slot and no attack roll: cast_at_enemy naming it. An action spent on anything else ends the spell.`;
}
