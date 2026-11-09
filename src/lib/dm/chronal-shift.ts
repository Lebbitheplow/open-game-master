// Chronal Shift (Chronurgy Magic 2) on another creature's roll: "After you
// or a creature you can see within 30 feet of you makes an attack roll, an
// ability check, or a saving throw, you can use your reaction to force that
// creature to reroll. You make this decision after you see whether the roll
// succeeds or fails. The target must use the result of the second roll."
//
// The wizard's own roll is answered on their own card, and a hit on them or
// an ally on the reaction card (src/lib/battlemap/hand-react.ts). The rest
// were the model's to narrate, with use_resource paying for a reroll nobody
// rolled. Now:
//   - a player's roll that waits on its card (src/lib/dm/after-roll.ts)
//     waits on the wizard too when it fails as it stands, and the wizard's
//     player answers it on their own screen (allyShifters);
//   - a roll the server makes inside a call (a creature's save against a
//     spell or an area, an ally's save against a hazard, a companion's
//     attack) is answered at the watch stop before the call runs
//     (src/lib/dm/foresight.ts): the wizard says "if it succeeds" or "if it
//     fails, roll it again", and the roll site asks takeShift once it knows.
//     Nothing pauses inside a call, so the decision is made at the stop, and
//     the use and the reaction are paid only if the roll goes the way the
//     wizard said: the result is the one the after-the-fact choice gives.

import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { RollTag } from "@/lib/dice-script-logic";
import { reactionFreeFor, rollsCanWait } from "@/lib/dm/after-roll";
import { allyShiftOption, CHRONAL_SHIFT, type AfterRollOption } from "@/lib/dm/after-roll-logic";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

export const SHIFT_RANGE_FEET = 30;

function usesLeft(sheet: Pick<CharacterSheet, "resources">): number {
  const state = sheet.resources?.[CHRONAL_SHIFT];
  return state ? Math.max(0, state.max - state.used) : 0;
}

// Whether the character could take a reaction now: theirs is free, and they
// are able to take one.
export function canReactNow(campaignId: string, sheet: CharacterSheet): boolean {
  return sheet.currentHp > 0 && !sheet.deathSaves?.dead && !incapacitatedBy(sheet.conditions) && reactionFreeFor(campaignId, sheet.id);
}

// Whether the wizard could spend Chronal Shift now, wherever the roll is: the
// feature with a use left, and able to react.
export function canShiftNow(campaignId: string, wizard: CharacterSheet): boolean {
  return holdsFeature(wizard, "chronal shift") && usesLeft(wizard) > 0 && canReactNow(campaignId, wizard);
}

// Whether the creature is in the wizard's reach for it: within 30 feet and
// in sight. With no board the fiction decides, and it is.
export function inShiftReach(campaignId: string, wizard: CharacterSheet, creature: Parameters<typeof unseenBecause>[2]): boolean {
  if (wizard.id === creature.id) {
    return true;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return true;
  }
  return withinFeet(encounter.id, wizard.id, creature.id, SHIFT_RANGE_FEET) && !unseenBecause(encounter.id, wizard, creature);
}

// The wizards at the table who could answer this character's failing roll on
// their own screen: another player's seat (an agent's has no card), not the
// roller, not one who already shifted or let it stand.
export function allyShifters(
  campaignId: string,
  roller: CharacterSheet,
  kind: string,
  done: { shiftedBy?: readonly string[]; declined?: readonly string[] } = {},
): AfterRollOption[] {
  const skip = new Set([roller.id, ...(done.shiftedBy ?? []), ...(done.declined ?? [])]);
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((wizard) => !skip.has(wizard.id) && rollsCanWait(wizard) && canShiftNow(campaignId, wizard) && inShiftReach(campaignId, wizard, roller))
    .map((wizard) => allyShiftOption(wizard.id, roller.name, kind));
}

// Pays for a wizard's Chronal Shift: the use, and the reaction in a fight.
// False when it can no longer be paid; nothing is spent then.
export function payChronalShift(campaignId: string, wizardId: string): boolean {
  const campaign = getCampaignById(campaignId);
  const wizard = getSheetById(wizardId);
  if (!campaign || !wizard || !canShiftNow(campaignId, wizard)) {
    return false;
  }
  if (!spendFeatureUse(campaign, wizard.id, CHRONAL_SHIFT, "Chronal Shift", "player")) {
    return false;
  }
  const encounter = getActiveEncounter(campaignId);
  if (encounter) {
    markReactionUsed(encounter, wizard.id);
  }
  return true;
}

// ---- the watch stop's shift, armed while its call runs ----

// The rolls a shift may answer, and which way each must go for it to:
// "success" rolls a creature's success again (a foe's save), "failure" an
// ally's failure (an ally's save, a companion's miss).
export type ShiftRoll = { tag: RollTag; reverse: "success" | "failure" };
type ArmedShift = { wizardId: string; rolls: readonly ShiftRoll[]; used: boolean; note: string | null };

declare global {
  var __odmArmedShifts: Map<string, ArmedShift> | undefined;
}

export function armShift(campaignId: string, armed: { wizardId: string; rolls: readonly ShiftRoll[] }) {
  (globalThis.__odmArmedShifts ??= new Map()).set(campaignId, { ...armed, used: false, note: null });
}

// What the shift did, once the call is over: the line for the model, or null
// when no roll went the way the wizard said.
export function disarmShift(campaignId: string): string | null {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  globalThis.__odmArmedShifts?.delete(campaignId);
  return armed?.used ? armed.note : null;
}

function tagFits(want: RollTag, got: RollTag): boolean {
  const names = [got.who ?? []].flat().map(textKey);
  return want.roller === got.roller && want.kind === got.kind && [want.who ?? []].flat().map(textKey).some((name) => names.includes(name));
}

// The roll site's question once it knows the outcome: does an armed shift
// answer this roll? When it does it is paid for here, and the caller rolls
// the d20 again and keeps the new roll. Returns the wizard's name, or null.
export function takeShift(campaignId: string, tag: RollTag | undefined, succeeded: boolean): string | null {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  if (!armed || armed.used || !tag) {
    return null;
  }
  const answers = armed.rolls.some((roll) => tagFits(roll.tag, tag) && (roll.reverse === "success" ? succeeded : !succeeded));
  if (!answers || !payChronalShift(campaignId, armed.wizardId)) {
    return null;
  }
  armed.used = true;
  return getSheetById(armed.wizardId)?.name ?? "The wizard";
}

// The line the call's answer carries: who rolled again, and the two totals.
export function noteShift(campaignId: string, line: string) {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  if (armed) {
    armed.note = line;
  }
}

// Runs one held call with the shift armed (the watch stop's answer).
export async function runWithShift<T>(campaignId: string, choice: { wizardId: string; rolls: readonly ShiftRoll[] } | null, run: () => Promise<T>): Promise<{ result: T; shift: string | null }> {
  if (!choice) {
    return { result: await run(), shift: null };
  }
  armShift(campaignId, choice);
  let result: T;
  let shift: string | null = null;
  try {
    result = await run();
  } finally {
    shift = disarmShift(campaignId);
  }
  return { result, shift };
}
