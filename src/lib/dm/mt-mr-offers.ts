// The monk and rogue subclasses' after-the-roll choices against the
// database (wave 2, part mr): what a parked attack tells the offers, and
// spending what the player chose (src/lib/dm/mt-mr-offers-logic.ts has the
// offers and their rules). The after-roll route calls mrSpendAfterRoll for
// these four ids in place of after-roll.ts spendAfterRoll, since two of them
// are paid only when they change the result and so read the roll's target.

import type { Campaign } from "@/lib/db/campaigns";
import type { PendingRoll } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { rollExpression, type RollResult } from "@/lib/dice";
import { budgetApplies } from "@/lib/dm/action-budget";
import { extraD20Expression, withBonusDie, withRerolledD20, type AfterRollId } from "@/lib/dm/after-roll-logic";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { isMonkWeapon } from "@/lib/dm/attack-logic";
import { recordTargetAc, type AttackRecord } from "@/lib/dm/attack-record";
import { ACCURACY_MARK, DRACONIC_PRESENCE, PSIONIC_ENERGY, psionicEnergyDie, type MrSwing } from "@/lib/dm/mt-mr-offers-logic";
import { holdsRow } from "@/lib/dm/mt-mr-turn";
import { markReactionUsed, storeBudget } from "@/lib/dm/turn-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { kenseiWeapons } from "@/lib/srd/mt-mr-kensei";
import { matchWeapon } from "@/lib/srd/weapons";

// The facts of an attack the offers read: the weapon by the record's own
// fields, the turn by the encounter's budget.
export function swingFacts(campaignId: string, sheet: CharacterSheet, record: Pick<AttackRecord, "weapon" | "base" | "unarmed">): MrSwing {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  const ownTurn = Boolean(encounter && budgetApplies(budget, sheet.id, encounter.round));
  const srd = record.base ? matchWeapon({ name: record.base }) : null;
  return {
    monkWeapon: record.unarmed !== true && Boolean(srd) && (isMonkWeapon(srd) || kenseiWeapons(sheet).includes(textKey(srd!.name))),
    psychicBlade: textKey(record.weapon ?? "") === "psychic blade",
    ownTurn,
    accuracyUsed: Boolean(ownTurn && budget?.oncePerTurn.includes(ACCURACY_MARK)),
  };
}

// The roll's d20s thrown again, one fresh die for each it threw; the new
// roll stands (as Chronal Shift's reroll, after-roll.ts).
function rerolled(outcome: RollResult): RollResult | null {
  const lead = outcome.terms[0];
  const count = lead && lead.kind === "dice" ? lead.dice.length : 0;
  const fresh = Array.from({ length: count }).flatMap(() => rollExpression(extraD20Expression(outcome.expression)).terms.flatMap((term) => (term.kind === "dice" ? term.dice.slice(0, 1) : [])));
  return withRerolledD20(outcome, fresh);
}

const dieOf = (die: string) => ({ sides: Number(die.slice(1)), value: rollExpression(`1${die}`).total, kept: true });

// The player's choice, paid for and on the dice. Null when it is no longer
// on offer; nothing is spent then.
export function mrSpendAfterRoll(campaign: Campaign, sheet: CharacterSheet, id: AfterRollId, outcome: RollResult, pending: Pick<PendingRoll, "campaignId" | "dc" | "attack">): { outcome: RollResult; choosing: boolean; touchOfDeath?: number; destructiveWrath?: boolean } | null {
  const record = pending.attack as AttackRecord | null;
  if (id === "unerring_accuracy") {
    const encounter = getActiveEncounter(campaign.id);
    const budget = encounter?.turnBudget ?? null;
    if (!record || !encounter || !budgetApplies(budget, sheet.id, encounter.round) || budget.oncePerTurn.includes(ACCURACY_MARK)) {
      return null;
    }
    const again = rerolled(outcome);
    if (!again) {
      return null;
    }
    storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, ACCURACY_MARK] });
    return { outcome: again, choosing: false };
  }
  if (id === "homing_strikes" || id === "psi_knack") {
    const held = holdsRow(sheet, id === "homing_strikes" ? "rogue::Soul Blades" : "rogue::Psi-Bolstered Knack");
    const state = sheet.resources?.[PSIONIC_ENERGY];
    const target = id === "homing_strikes" ? (record ? recordTargetAc(campaign.id, record) : null) : pending.dc;
    if (!held || !state || state.max - state.used < 1 || typeof target !== "number") {
      return null;
    }
    const added = withBonusDie(outcome, dieOf(psionicEnergyDie(held.level)));
    // "If the die closes the gap": a die that leaves the roll short is not spent.
    if (added.total >= target && !spendFeatureUse(campaign, sheet.id, PSIONIC_ENERGY, id === "homing_strikes" ? "Homing Strikes" : "Psi-Bolstered Knack", "player")) {
      return null;
    }
    return { outcome: added, choosing: false };
  }
  if (id === "draconic_presence") {
    const encounter = getActiveEncounter(campaign.id);
    const state = sheet.resources?.[DRACONIC_PRESENCE];
    if (encounter?.reactionsUsed.includes(sheet.id) || !state || state.max - state.used < 1 || typeof pending.dc !== "number") {
      return null;
    }
    const again = rerolled(outcome);
    if (!again) {
      return null;
    }
    if (encounter) {
      markReactionUsed(encounter, sheet.id);
    }
    // "Once this turns a failure into a success you can't do so again until a
    // long rest": the use goes only then.
    if (again.total >= pending.dc) {
      spendFeatureUse(campaign, sheet.id, DRACONIC_PRESENCE, "Draconic Presence", "player");
    }
    return { outcome: again, choosing: false };
  }
  return null;
}
