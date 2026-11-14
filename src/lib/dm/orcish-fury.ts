// Orcish Fury spent through a bare use_resource: "once until a short or long
// rest, when you hit with a weapon attack, you can roll one of the weapon's
// damage dice an additional time and add it as extra damage of the weapon's
// damage type." A player chooses it on the card their weapon hit waits on
// (after-roll-table.ts orcish_fury, paid in attack-swing.ts); an agent seat or
// a companion has no card, so its call adds the die to its latest weapon hit
// this turn (the budget's lastWeaponDie, orcish-fury-logic.ts), and with none is told to attack first.
// Called from the use_resource arm through src/lib/dm/mt-species-spends.ts;
// must not import mutations.ts.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { rollOwnDice } from "@/lib/dm/character-roll";
import { publishSheet } from "@/lib/dm/combat-features";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { ORCISH_FURY } from "@/lib/srd/feat-combat";

export function orcishFurySpend(campaign: Campaign, turnId: string, sheet: CharacterSheet): ToolResult {
  const state = sheet.resources?.[ORCISH_FURY];
  if (!state || state.used >= state.max) {
    return { error: `${sheet.name} has no use of Orcish Fury left until a short or long rest. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const hit = encounter?.turnBudget?.ownerId === sheet.id ? (encounter.turnBudget.lastWeaponDie ?? null) : null;
  const turn = getDmTurn(turnId);
  if (!encounter || !hit || !turn) {
    return {
      error: `Orcish Fury adds one of the weapon's damage dice to a weapon hit ${sheet.name} landed this turn, and they have landed none yet. Make the weapon attack, then call use_resource "Orcish Fury" after it hits. Nothing was spent.`,
      retry: true,
    };
  }
  const enemy = resolveTargetFoe(campaign.id, encounter, hit.enemyId);
  if (!enemy || enemy.status !== "alive") {
    return { error: `The creature ${sheet.name}'s last weapon hit landed on is already down, so Orcish Fury has nothing to add to. Nothing was spent.`, refused: "rules" };
  }
  if (!spendFeatureUse(campaign, sheet.id, ORCISH_FURY, "Orcish Fury")) {
    return { error: `${sheet.name} has no use of Orcish Fury left until a short or long rest. Nothing was spent.`, refused: "rules" };
  }
  // Dice, so a critical hit's doubling takes them too (attack-swing.ts).
  const dice = `${hit.crit ? 2 : 1}d${hit.sides}`;
  const amount = Math.max(0, Number(rollOwnDice(campaign, sheet, `${sheet.name}: Orcish Fury, one more weapon die`, dice, { turn }).total));
  const sheets = listSheets(campaign.id).map((stale) => getSheetById(stale.id) ?? stale);
  const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
  applyEnemyDamage(campaign, turn, encounter, enemy, amount, sheets, sheetsById, hit.type || undefined, hit.magical ? { magical: true } : undefined);
  publishEncounter(campaign.id);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "Orcish Fury",
    left: `${state.max - state.used - 1}/${state.max}`,
    refills: "on a short or long rest",
    applied: [`Orcish Fury: ${dice} more on ${sheet.name}'s hit, ${amount}${hit.type ? ` ${hit.type}` : ""} damage to ${enemy.displayName}.`],
  };
}
