// Find Familiar's pocket dimension (SRD 5.1): "As an action, you can
// temporarily dismiss your familiar into a pocket dimension. Alternatively,
// you can dismiss it forever. As an action while it is temporarily
// dismissed, you can cause it to reappear in any unoccupied space within 30
// feet of you."
//
// dismiss_pet struck the familiar off the sheet, so calling it back was a
// new casting: another hour and another 10 gp. Now a familiar dismissed is
// kept on its owner's sheet, `pocketed`, and dismissing it again from there
// lets it go for good; summon_pet calls a pocketed familiar back. Each is the
// owner's action in a fight, on their own turn; out of one it costs nothing.
// While pocketed nothing reaches it: findPet (pet-tools.ts) passes it over,
// so no attack, damage, save, heal or command finds it, and the areas, zones
// and reactions that walk an owner's pets skip it (pocketed below).

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { heldTurnRefusal } from "@/lib/dm/held-turn";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { publishPersisted } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { findFamiliarForm } from "@/lib/srd/familiar-forms";

export const pocketed = (pet: Pick<SheetPet, "pocketed">): boolean => pet.pocketed === true;

// The owner's action, in a fight: asked before anything changes, written by
// commit(). Out of a fight there is no turn to charge.
function ownerAction(owner: CharacterSheet, what: string): ToolError | { commit: () => string | null } {
  const encounter = getActiveEncounter(owner.campaignId);
  const allowed = canAct({ sheet: owner, encounter, kind: "action" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  const heldOff = encounter ? heldTurnRefusal(encounter, owner) : null;
  if (heldOff) {
    return heldOff;
  }
  const budget = encounter ? budgetFor(encounter, owner.id, attacksAllowedFor(owner), conditionTurnShape(owner.conditions)) : null;
  if (!encounter || !budget) {
    return { commit: () => null };
  }
  const spent = spendAction(budget, "action", what, owner.name);
  if (!spent.ok) {
    return toolError(spent);
  }
  return {
    commit: () => {
      storeBudget(getActiveEncounter(owner.campaignId) ?? encounter, spent.budget);
      return `It took ${owner.name}'s action.`;
    },
  };
}

function writePets(campaign: Campaign, owner: CharacterSheet, pets: SheetPet[]) {
  const updated = patchSheet(owner.id, { pets });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// dismiss_pet on a familiar: into its pocket dimension, or, from there, gone.
export function dismissFamiliar(campaign: Campaign, ownerRef: CharacterSheet, pet: SheetPet): ToolResult {
  const owner = getSheetById(ownerRef.id) ?? ownerRef;
  const same = (entry: SheetPet) => entry.name === pet.name && entry.kind === pet.kind;
  if (pocketed(pet)) {
    writePets(campaign, owner, owner.pets.filter((entry) => !same(entry)));
    return { ok: true, dismissed: `${pet.name} (${pet.form}) is dismissed forever; only a new casting of Find Familiar brings a familiar back.` };
  }
  const cost = ownerAction(owner, `dismissing ${pet.name}`);
  if ("error" in cost) {
    return cost;
  }
  const economy = cost.commit();
  writePets(campaign, owner, owner.pets.map((entry) => (same(entry) ? { ...entry, pocketed: true } : entry)));
  return {
    ok: true,
    pocketed: `${pet.name} waits in its pocket dimension, out of reach of everything. summon_pet calls it back (an action, no casting); dismiss_pet again lets it go for good.`,
    ...(economy ? { economy } : {}),
  };
}

// summon_pet on an owner whose familiar is pocketed, naming its form or none:
// it reappears beside them. Null when there is none to call back, or the
// call asks another form (that is a new casting).
export function recallFamiliar(campaign: Campaign, ownerRef: CharacterSheet, form: string | undefined): ToolResult | null {
  const owner = getSheetById(ownerRef.id) ?? ownerRef;
  const waiting = owner.pets.find((entry) => entry.kind === "familiar" && pocketed(entry));
  if (!waiting) {
    return null;
  }
  const asked = form?.trim() ? (findFamiliarForm(form)?.form ?? form) : waiting.form;
  if (textKey(asked) !== textKey(waiting.form)) {
    return null;
  }
  const cost = ownerAction(owner, `calling ${waiting.name} back`);
  if ("error" in cost) {
    return cost;
  }
  const economy = cost.commit();
  writePets(campaign, owner, owner.pets.map((entry) => (entry === waiting ? { ...entry, pocketed: undefined } : entry)));
  return {
    ok: true,
    recalled: `${waiting.name} (${waiting.form}) reappears beside ${owner.name}, as it was when it left: ${waiting.hp}/${waiting.maxHp} HP. No casting, nothing burned.`,
    ...(economy ? { economy } : {}),
  };
}
