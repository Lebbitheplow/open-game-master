// The command Animate Dead and Create Undead give their caster (SRD 5.1,
// Animate Dead): "On each of your turns, you can use a bonus action to
// mentally command any creature you made with this spell if the creature is
// within 60 feet of you (if you control multiple creatures, you can command
// any or all of them at the same time, issuing the same command to each
// one). ... If you issue no commands, the creature only defends itself
// against hostile creatures." Create Undead says the same within 120 feet.
//
// Before this the command was charged nowhere: the undead attacked on their
// group's turn at no cost to the caster, ordered or not.
//
// The command rides the spell's own tool (cast_buff, the spell with variant
// "command", cast-buff.ts), as Heat Metal's and Spiritual Weapon's later
// bonus actions ride theirs: no slot, the caster's bonus action, and every
// creature of the spell within reach is under orders until the caster's next
// turn starts. One not under orders attacks, on its own turn, only a creature
// that has attacked it in this fight or stands within 5 feet of it
// (pc-attack-gate.ts asks uncommandedRefusal). Off the board the distance is
// the GM's, as every reach check's is.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { attackedBy } from "@/lib/db/rolls";
import { spendAction } from "@/lib/dm/action-budget";
import { addSheetCondition } from "@/lib/dm/action-common";
import { withinFeet } from "@/lib/dm/authored-saves";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { summonsOf } from "@/lib/dm/summon-store";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { SummonSpell } from "@/lib/srd/summon-spells";

// Not "commanded": that is the Command spell's condition (condition-effects).
export const UNDER_ORDERS = "under its caster's orders";

// How far each spell's command reaches, by the spell it runs as.
const COMMAND_FEET: Record<string, number> = { "animate dead": 60, "create undead": 120 };

// Whether a cast_buff call is the spell's command rather than a casting.
export function commandsUndead(spell: Pick<SummonSpell, "name">, variant: string | undefined): boolean {
  return textKey(variant ?? "") === "command" && COMMAND_FEET[textKey(spell.name)] !== undefined;
}

const underOrders = (sheet: Pick<CharacterSheet, "conditions">) => sheet.conditions.some((entry) => textKey(entry) === textKey(UNDER_ORDERS));

// The caster's bonus action, and every standing creature of the spell within
// its reach under orders. Nothing is spent on a refusal.
export function commandUndead(campaign: Campaign, caster: CharacterSheet, spell: SummonSpell, castAs: string): ToolResult {
  const feet = COMMAND_FEET[textKey(spell.name)] ?? 60;
  const made = summonsOf(campaign.id, caster.id, castAs).filter((sheet) => sheet.currentHp > 0);
  if (!made.length) {
    return { error: `${caster.name} has no creature of ${castAs} to command. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(campaign.id);
  const near = encounter ? made.filter((sheet) => withinFeet(encounter.id, caster.id, sheet.id, feet)) : made;
  if (!near.length) {
    return { error: `None of ${caster.name}'s creatures of ${castAs} is within ${feet} feet of them, and the command reaches no further. Nothing was spent.`, refused: "rules" };
  }
  let economy = "There is no turn in play to charge.";
  const allowed = canAct({ sheet: caster, encounter, kind: "bonus" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  const heldOff = encounter ? heldTurnRefusal(encounter, caster) : null;
  if (heldOff) {
    return heldOff;
  }
  const budget = encounter ? budgetFor(encounter, caster.id, attacksAllowedFor(caster), conditionTurnShape(caster.conditions)) : null;
  if (encounter && budget) {
    const spent = spendAction(budget, "bonus", `commanding ${castAs}'s creatures`, caster.name);
    if (!spent.ok) {
      return toolError(spent);
    }
    storeBudget(getActiveEncounter(campaign.id) ?? encounter, spent.budget);
    economy = `Commanding them used ${caster.name}'s bonus action.`;
  }
  for (const sheet of near) {
    addSheetCondition(campaign, getSheetById(sheet.id) ?? sheet, UNDER_ORDERS, { untilTurnOf: caster.id }, caster.id);
  }
  const beyond = made.length - near.length;
  return {
    ok: true,
    spell: castAs,
    commanded: near.map((sheet) => sheet.name),
    economy,
    note: `${near.map((sheet) => sheet.name).join(", ")} follow${near.length === 1 ? "s" : ""} ${caster.name}'s command until ${caster.name}'s next turn: each acts on its own turn with pc_attack.${beyond ? ` ${beyond} more ${beyond === 1 ? "is" : "are"} beyond ${feet} feet and only defend${beyond === 1 ? "s" : ""} itself.` : ""}`,
  };
}

// Why an undead of these spells, not under orders, may not attack this
// creature on its own turn, or null.
export function uncommandedRefusal(campaignId: string, encounterId: string, sheet: CharacterSheet, foe: { id: string; displayName: string }): ToolError | null {
  if (!sheet.summon?.controlExpires || underOrders(sheet)) {
    return null;
  }
  if (attackedBy(campaignId, sheet.id, foe.id) || withinFeet(encounterId, sheet.id, foe.id, 5)) {
    return null;
  }
  const caster = sheet.summon.casterName || "its caster";
  return {
    error: `${sheet.name} has no command from ${caster}, and an undead left without one only defends itself: it attacks a creature that has attacked it or stands within 5 feet of it, and ${foe.displayName} has done neither. ${caster} commands it with a bonus action on their own turn (cast_buff, spell "${sheet.summon.spell}", variant "command"). Nothing was spent.`,
    refused: "rules",
  };
}
