// The preconditions of a monk's or a rogue's subclass spend that a gate's
// words cannot say (authored-effects-types.ts SpendNeed): the light on the
// holder's square, or a mark this turn left (mt-mr-turn.ts).
// authored-spends.ts asks before anything is spent. The Hand shuts the card
// on the same facts (src/lib/battlemap/mt-mr-hand.ts mrCardGate): a need
// added here is added there, so no card is dealt for a play refused here.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { budgetApplies } from "@/lib/dm/action-budget";
import { FLURRY_SWUNG, UNARMED_IN_ACTION, holdsRow } from "@/lib/dm/mt-mr-turn";
import { shadowLightProblem } from "@/lib/dm/one-with-shadows";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpendNeed } from "@/lib/srd/authored-effects-types";
import { kenseiHeld } from "@/lib/srd/mt-mr-kensei";

// The marks of the holder's own turn; none off it or out of a fight.
function turnMarks(campaignId: string, sheetId: string): string[] {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget;
  return encounter && budget && budgetApplies(budget, sheetId, encounter.round) ? budget.oncePerTurn : [];
}

// Why the need is not met, or null when it is.
export function needRefusal(campaign: Pick<Campaign, "id">, sheet: CharacterSheet, name: string, need: SpendNeed): ToolError | null {
  switch (need) {
    case "shadows": {
      // "In dim light or darkness" (Shadow Step, Cloak of Shadows): the board's
      // light on the monk's square; off a board the GM judges it.
      const bright = shadowLightProblem(campaign.id, sheet);
      return bright ? { error: `${sheet.name} stands in bright light, and ${name} works only in dim light or darkness. Nothing was spent.`, refused: "rules" } : null;
    }
    case "unarmed_in_action": {
      // Agile Parry: "when you make an unarmed strike as part of the Attack
      // action while holding a kensei melee weapon".
      if (!kenseiHeld(sheet, "melee").length) {
        return { error: `${name} needs a kensei melee weapon in hand, and ${sheet.name} holds none of the kensei weapons they chose. Nothing was spent.`, refused: "rules" };
      }
      return turnMarks(campaign.id, sheet.id).includes(UNARMED_IN_ACTION)
        ? null
        : { error: `${name} follows an unarmed strike made as part of the Attack action, and ${sheet.name} has made none this turn: pc_attack with weapon "unarmed strike" first. Nothing was spent.`, refused: "rules" };
    }
    case "attack_action": {
      // "After the Attack action" (Searing Arc Strike): an attack of it made
      // this turn, and the action not gone on a spell.
      const encounter = getActiveEncounter(campaign.id);
      const budget = encounter?.turnBudget;
      const attacked = encounter && budget && budgetApplies(budget, sheet.id, encounter.round) && budget.attacksMade > 0 && !budget.castThisAction;
      return attacked ? null : { error: `${name} follows the Attack action, and ${sheet.name} has not taken it this turn: pc_attack first. Nothing was spent.`, refused: "rules" };
    }
    case "flurry_harm":
      // Flurry of Healing and Harm: "one of its attacks can carry Hand of Harm
      // free". The latest unarmed strike was one of Flurry of Blows'.
      return holdsRow(sheet, "monk::Flurry of Healing and Harm") && turnMarks(campaign.id, sheet.id).includes(FLURRY_SWUNG)
        ? null
        : { error: `${name} is free only on a Flurry of Blows strike of a monk with Flurry of Healing and Harm.`, refused: "rules" };
  }
}
