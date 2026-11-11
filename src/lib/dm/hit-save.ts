// A save a character's hit forces while a feature runs, once on each of their
// turns: Form of Dread (Undead patron 1), "once on each of your turns, when
// you hit a creature with an attack roll, you can make it save on Wisdom
// against your spell save DC or be frightened of you until the end of your
// next turn". Before this the fright was the GM's to add by hand.
//
// Read from the authored "hit_save" effect (its gate the running condition),
// called by authoredOnHit (authored-hooks.ts), which every character hit
// reaches. The save is the creature's own, rolled from its stat block as
// every forced save is (forced-save.ts rollEnemySave); a creature immune to
// the condition takes nothing (pc-attack-riders.ts riderBarred). The text's
// "you can" is taken as yes: a warlock in their dread form frightens.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { budgetApplies, claimOncePerTurn } from "@/lib/dm/action-budget";
import { storeBudget } from "@/lib/dm/turn-budget";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { applyRiderCondition, riderBarred } from "@/lib/dm/pc-attack-riders";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { counterSaveDc } from "@/lib/srd/counter-rules";
import { computeSheetDerived } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function hitSavesOnHit(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet, struck: EncounterEnemy): string[] {
  const lines: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "hit_save")) {
    const enemy = getEnemy(struck.id);
    if (!enemy || enemy.status !== "alive") {
      return lines;
    }
    // Once on each of the holder's own turns: the turn's once-a-turn marks.
    const live = getActiveEncounter(campaign.id) ?? encounter;
    const budget = live.turnBudget;
    if (!budgetApplies(budget, sheet.id, live.round)) {
      continue;
    }
    const claimed = claimOncePerTurn(budget, `authored:hit_save:${textKey(held.feature)}`);
    if (!claimed) {
      continue;
    }
    storeBudget(live, claimed);
    const barred = riderBarred(enemy, effect.condition, null);
    if (barred) {
      lines.push(`${held.feature}: ${barred}`);
      continue;
    }
    const dc = counterSaveDc("spell", computeSheetDerived(sheet), 0);
    const save = rollEnemySave(campaign.id, enemy, effect.save, dc, { against: effect.condition, origin: { ref: sheet.id } });
    const shown = save.total ?? "an automatic failure";
    if (save.success) {
      lines.push(`${held.feature}: ${enemy.displayName} holds (${shown} vs DC ${dc}); not ${effect.condition}.`);
      continue;
    }
    applyRiderCondition(campaign, enemy, effect.condition, { meta: untilTurnEnd(sheet.id, { source: sheet.id }) });
    lines.push(`${held.feature}: ${enemy.displayName} fails the ${effect.save.toUpperCase()} save (${shown} vs DC ${dc}) and is ${effect.condition} of ${sheet.name} until the end of their next turn.`);
  }
  return lines;
}
