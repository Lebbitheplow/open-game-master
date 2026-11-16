// A familiar's Help (SRD 5.1, Find Familiar: "A familiar can't attack, but
// it can take other actions as normal"; Help: "you can aid a friendly
// creature in attacking a creature within 5 feet of you ... If your ally
// attacks the target before your next turn, the first attack roll is made
// with advantage"). U06 gave a Beast Master's companion its commanded Help
// (pet-help.ts); a familiar had no door for it, because take_action takes a
// character as the helper, so the wizard spent their own action on the Help
// or the owl's was only narrated.
//
// take_action with the owner's characterId and the familiar's petName: the
// familiar's own action, once in its owner's turn (a pet acts on its owner's
// turn here, ruling D2), the owner's action untouched, and the same Help the
// companion lays, within 5 feet of the owner's square.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { claimOncePerTurn } from "@/lib/dm/action-budget";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { petHelp } from "@/lib/dm/pet-help";
import { findPet, noPet } from "@/lib/dm/pet-tools";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";

export function familiarAction(
  campaign: Campaign,
  owner: CharacterSheet,
  args: { petName: string; action: string; targetCharacterId?: string; targetEnemyId?: string },
): ToolResult {
  const pet = findPet(owner, args.petName);
  if (!pet) {
    return noPet(owner, args.petName);
  }
  if (pet.kind !== "familiar") {
    return {
      error: `${pet.name} is no familiar. A companion helps at its ranger's command (use_resource "Exceptional Training", variant help); take_action with petName is a familiar's own Help. Nothing was spent.`,
      retry: true,
    };
  }
  if (args.action !== "help") {
    return { error: `take_action with petName is a familiar's Help; ${pet.name}'s other doings are narrated. Nothing was spent.`, retry: true };
  }
  if (pet.hp <= 0) {
    return { error: `${pet.name} is down and takes no action. Nothing was spent.`, refused: "rules" };
  }
  const stopped = incapacitatedBy(pet.conditions ?? []);
  if (stopped) {
    return { error: `${pet.name} is ${stopped} and takes no action. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const fight = encounter && (encounter.status ?? "active") === "active" && (encounter.kind ?? "fight") === "fight" ? encounter : null;
  const budget = fight ? budgetFor(fight, owner.id, attacksAllowedFor(owner), conditionTurnShape(owner.conditions)) : null;
  if (fight && !budget) {
    return { error: `${pet.name} acts on ${owner.name}'s turn, standing with them, and it is not their turn. Nothing was spent.`, refused: "rules" };
  }
  const claimed = budget ? claimOncePerTurn(budget, `familiar-action:${textKey(pet.name)}`) : null;
  if (budget && !claimed) {
    return { error: `${pet.name} has already taken its action this turn. Nothing was spent.`, refused: "limit" };
  }
  const help = petHelp(campaign, owner, pet, { targetCharacterId: args.targetCharacterId, targetEnemyId: args.targetEnemyId });
  if ("error" in help) {
    return help;
  }
  if (fight && claimed) {
    storeBudget(getActiveEncounter(campaign.id) ?? fight, claimed);
  }
  return {
    ok: true,
    help: `${pet.name} takes the Help action with its own action; ${owner.name}'s are untouched.`,
    helped: help.lay(),
  };
}
