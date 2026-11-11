// One Superiority Die paid for a maneuver the engine itself resolves: a
// maneuver named on pc_attack (Precision, Trip, Menacing and the rest), a
// reaction maneuver (Parry, Riposte, Brace). Every engine spend of the pool
// goes through here, naming its maneuver, so the record says what the die
// bought.
//
// use_resource "Superiority Dice" with no maneuver refuses (the maintainer's
// decisions R10 and D4 of the 2026-11-09 gap sweep: "move the engine's own
// maneuver spends to name the maneuver as the variant, then refuse a bare
// spend"): a die spent with nothing named bought nothing. The engine does not
// call use_resource for these, because its option table refuses a swing or
// reaction maneuver there with a pointer to pc_attack and use_reaction, which
// is the right answer to the model and the wrong one to the swing itself.
//
// The caller has already judged the fighter able (the attack or reaction is
// theirs to make), so this checks only that a die is left.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { audit } from "@/lib/dm/mutations";
import type { ToolError } from "@/lib/dm/tool-errors";

export function spendManeuverDie(campaign: Campaign, turnId: string, holder: CharacterSheet | { id: string }, maneuver: string): ToolError | null {
  const sheet = getSheetById(holder.id) ?? ("resources" in holder ? holder : null);
  if (!sheet) {
    return { error: `No character holds the Superiority Dice for ${maneuver}.`, refused: "rules" };
  }
  const state = sheet.resources.sub_superiority_dice;
  if (!state || state.used >= state.max) {
    return { error: `${sheet.name} has no Superiority Dice left for ${maneuver}.`, refused: "rules" };
  }
  const patch = { resources: { ...sheet.resources, sub_superiority_dice: { max: state.max, used: state.used + 1 } } };
  const updated = patchSheet(sheet.id, patch);
  audit(campaign, turnId, sheet, "use_resource", { characterId: sheet.id, resource: "Superiority Dice", variant: maneuver, spent: 1 }, maneuver, patch);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return null;
}
