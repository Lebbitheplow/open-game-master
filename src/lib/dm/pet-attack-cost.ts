// pet_attack's price: what commanding a pet's attack costs its owner in a
// fight. Split from pet-tools.ts, whose handler asks this before the roll and
// commits it once the attack is made.

import { getActiveEncounter } from "@/lib/db/encounters";
import { claimOncePerTurn, spendAction, spendAttack } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature } from "@/lib/srd/feature-names";

// The turn-budget mark a pet's attack leaves (Bestial Fury, Exceptional
// Training read it).
export const petAttackedKey = (name: string) => `pet-attacked:${textKey(name)}`;

// What commanding a pet's attack costs its owner in a fight (SRD 5.1 and
// the subclasses' own text): a Beast Master's companion takes the ranger's
// action, a drake the bonus action, a Pact of the Chain familiar attacks
// with its reaction in place of one of the warlock's attacks of the Attack
// action (once a turn), and a story pet the owner's action. The owner must
// be able to act, on their own turn. Out of a fight there is no turn to
// charge. Checked before the roll; commit() writes the charge.
export function petAttackCost(
  sheet: CharacterSheet,
  pet: SheetPet,
  encounter: NonNullable<ReturnType<typeof getActiveEncounter>>,
): ToolError | { commit: () => string } {
  const allowed = canAct({ sheet, encounter, kind: pet.kind === "drake" ? "bonus" : "action" });
  if (!allowed.ok) {
    return { ...toolError(allowed), error: `${allowed.error} ${pet.name} attacks when ${sheet.name} commands it on their turn.` };
  }
  const heldOff = heldTurnRefusal(encounter, sheet);
  if (heldOff) {
    return heldOff;
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget) {
    return { commit: () => `${pet.name} attacks; there is no turn in play to charge.` };
  }
  let spent;
  let economy: string;
  // The turn's mark that this creature attacked: Bestial Fury's second
  // attack follows it, and Exceptional Training's bonus command is refused
  // after it (src/lib/dm/pet-command.ts).
  const attacked = petAttackedKey(pet.name);
  const furyKey = `pet-fury:${textKey(pet.name)}`;
  // Bestial Fury (Beast Master 11): "Your companion makes two attacks when
  // you command it to attack": the second costs nothing more.
  const fury = pet.kind === "beast_companion" && holdsFeature(sheet, "Bestial Fury") && budget.oncePerTurn.includes(attacked) ? claimOncePerTurn(budget, furyKey) : null;
  if (fury) {
    spent = { ok: true as const, budget: fury };
    economy = `${pet.name} makes its second attack of the command (Bestial Fury).`;
  } else if (pet.kind === "familiar") {
    const once = claimOncePerTurn(budget, `familiar:${textKey(pet.name)}`);
    if (!once) {
      return { error: `${pet.name} has already attacked with its reaction this turn.`, refused: "rules" };
    }
    spent = spendAttack(once, sheet.name, { hasteOk: false });
    economy = `${pet.name} attacked with its reaction in place of one of ${sheet.name}'s attacks.`;
  } else if (pet.kind === "drake") {
    spent = spendAction(budget, "bonus", `commanding ${pet.name}`, sheet.name);
    economy = `Commanding ${pet.name} used ${sheet.name}'s bonus action.`;
  } else {
    spent = spendAction(budget, "action", `commanding ${pet.name}`, sheet.name);
    economy = `Commanding ${pet.name} used ${sheet.name}'s action.`;
  }
  if (!spent.ok) {
    return toolError(spent);
  }
  const priced = spent.budget.oncePerTurn.includes(attacked) ? spent.budget : { ...spent.budget, oncePerTurn: [...spent.budget.oncePerTurn, attacked] };
  return {
    commit: () => {
      const live = getActiveEncounter(encounter.campaignId) ?? encounter;
      storeBudget(live, priced);
      return economy;
    },
  };
}
