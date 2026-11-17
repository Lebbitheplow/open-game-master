// The Help a pet takes at its owner's command (Exceptional Training: "a
// bonus action can command it to Dash, Disengage or Help"). SRD 5.1, Help:
// "you can aid a friendly creature in attacking a creature within 5 feet of
// you ... If your ally attacks the target before your next turn, the first
// attack roll is made with advantage"; or "lend your aid to another
// creature in the completion of a task", the creature's next check. The
// command marked the companion "helping" and laid nothing, so the ranger's
// next swing at the goblin their wolf distracted rolled one d20. Here it
// lays the same held Help take_action help lays (help-logic.ts), on the
// ally the call names or the owner by default, against a creature within 5
// feet of the pet, which stands in its owner's square (ruling D2), until
// its next turn, which is its owner's.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { addSheetCondition } from "@/lib/dm/action-common";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { HELP_FOR_A_CHECK, HELPED } from "@/lib/dm/help-logic";
import { petPlaceOf } from "@/lib/dm/pet-place";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ToolError } from "@/lib/dm/tool-errors";

// Checked before anything is spent; `lay` writes the Help once the command
// is paid for, and says what it gave.
export function petHelp(
  campaign: Campaign,
  owner: CharacterSheet,
  pet: SheetPet,
  args: { targetCharacterId?: string; targetEnemyId?: string },
): ToolError | { lay: () => string } {
  const sheets = listSheets(campaign.id);
  const ally = args.targetCharacterId ? resolveSheetRef(args.targetCharacterId, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet]))) : owner;
  if (!ally) {
    return unknownSheetRef("targetCharacterId", args.targetCharacterId ?? "", sheets);
  }
  const encounter = getActiveEncounter(campaign.id);
  const foe = args.targetEnemyId && encounter ? resolveTargetFoe(campaign.id, encounter, args.targetEnemyId) : null;
  if (args.targetEnemyId && (!foe || foe.status !== "alive")) {
    return { error: `${pet.name}'s Help on an attack needs a living targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  if (foe && encounter) {
    const apart = tilesBetween(encounter.id, petPlaceOf(owner), foe.id);
    if (apart !== null && apart > 1) {
      return {
        error: `${foe.displayName} is ${apart * 5} ft from ${pet.name}, which stands with ${owner.name}: Help on an attack is against a creature within 5 feet of the helper. Nothing was spent.`,
        retry: true,
      };
    }
    // A wall between is total cover, and the refusal names it rather than a
    // distance that is within reach (Y22, as take_action help's).
    if (wallBetween(encounter.id, petPlaceOf(owner), foe.id)) {
      return {
        error: `A wall stands between ${foe.displayName} and ${pet.name}, which stands with ${owner.name}: Help on an attack is against a creature the helper can reach, with no wall between. Nothing was spent.`,
        retry: true,
      };
    }
  }
  return {
    lay: () => {
      addSheetCondition(campaign, getSheetById(ally.id) ?? ally, HELPED, { untilTurnOf: owner.id }, foe ? foe.id : HELP_FOR_A_CHECK);
      return foe
        ? `${ally.name} has advantage on their next attack against ${foe.displayName} before ${owner.name}'s next turn; the server spends it on that roll.`
        : `${ally.name} has advantage on their next ability check before ${owner.name}'s next turn; the server spends it on that roll.`;
    },
  };
}
