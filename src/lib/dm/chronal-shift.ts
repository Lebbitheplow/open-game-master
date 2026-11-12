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
//
// The same stop carries Flash of Genius (an artificer's Intelligence modifier
// on an ally's failed save, or their own) and Favored by the Gods (a divine
// soul's 2d4 on their own failed save): a save a call throws inside an area,
// a spell at a character or an enemy's hit cannot wait on a card, so the
// player says "if it fails" at the stop and takeSaveHelp adds it at the save.

import { getCampaignById } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { RollTag } from "@/lib/dice-script-logic";
import { reactionFreeFor, rollsCanWait } from "@/lib/dm/after-roll";
import { allyShiftOption, CHRONAL_SHIFT, holdsRow, withBonusDie, withFlatBonus, type AfterRollOption } from "@/lib/dm/after-roll-logic";
import { afterRollRow, isSaveHelp, mostAdded, watchRow, type SaveHelp, type WatchRowId } from "@/lib/dm/after-roll-table";
import { rollExpression, type RollResult } from "@/lib/dice";
import { computeSheetDerived } from "@/lib/srd";
import { onlineUserIds } from "@/lib/events";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { inPlay } from "@/lib/dm/roster";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";

export const SHIFT_RANGE_FEET = 30;

function usesLeft(sheet: Pick<CharacterSheet, "resources">, resource = CHRONAL_SHIFT): number {
  const state = sheet.resources?.[resource];
  return state ? Math.max(0, state.max - state.used) : 0;
}

// Whether the character's player is at the table now. A helper's choice
// holds the roll until they press it, and an absent player never will: the
// table sat out the whole wait, or for good when nobody else was online
// (after-roll-timer.ts sets no clock then). As hit-dice.ts and table-wait.ts
// treat an absent player, the roll does not wait on them.
export function playerAtTable(campaignId: string, sheet: Pick<CharacterSheet, "userId">): boolean {
  return Boolean(sheet.userId) && onlineUserIds(campaignId).includes(sheet.userId);
}

// Whether the character could take a reaction now: theirs is free, and they
// are able to take one.
export function canReactNow(campaignId: string, sheet: CharacterSheet): boolean {
  return sheet.currentHp > 0 && !sheet.deathSaves?.dead && !incapacitatedBy(sheet.conditions) && reactionFreeFor(campaignId, sheet.id);
}

// Whether a stop can ask this character's own player: a seat with a card to
// press, its player at the table, the character in the fight. A stop made for
// one character alone (Slayer's Counter, foresight.ts) asks this; a seat it
// does not reach keeps the reaction's answer after the roll.
export function stopReaches(campaignId: string, sheet: CharacterSheet): boolean {
  return rollsCanWait(sheet) && playerAtTable(campaignId, sheet) && inPlay(campaignId, sheet);
}

// Whether the wizard could spend Chronal Shift now, wherever the roll is: the
// feature with a use left, and able to react.
export function canShiftNow(campaignId: string, wizard: CharacterSheet): boolean {
  return holdsFeature(wizard, "chronal shift") && usesLeft(wizard) > 0 && canReactNow(campaignId, wizard);
}

// Whether the creature is in the helper's reach: within `feet` (Chronal
// Shift's and Flash of Genius's 30, Restore Balance's and Violent
// Attraction's 60) and in sight. With no board the fiction decides, and it is.
export function inShiftReach(campaignId: string, wizard: CharacterSheet, creature: Parameters<typeof unseenBecause>[2], feet = SHIFT_RANGE_FEET): boolean {
  if (wizard.id === creature.id) {
    return true;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return true;
  }
  return withinFeet(encounter.id, wizard.id, creature.id, feet) && !unseenBecause(encounter.id, wizard, creature);
}

// The wizards at the table who could answer this character's failing roll on
// their own screen: another player's seat (an agent's has no card) whose
// player is here, not on the bench, not the roller, not one who already
// shifted or let it stand.
export function allyShifters(
  campaignId: string,
  roller: CharacterSheet,
  kind: string,
  done: { shiftedBy?: readonly string[]; declined?: readonly string[] } = {},
): AfterRollOption[] {
  const skip = new Set([roller.id, ...(done.shiftedBy ?? []), ...(done.declined ?? [])]);
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((wizard) => !skip.has(wizard.id) && rollsCanWait(wizard) && playerAtTable(campaignId, wizard) && inPlay(campaignId, wizard) && canShiftNow(campaignId, wizard) && inShiftReach(campaignId, wizard, roller))
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

// Whether the character could spend this feature on a failed save now: a use
// left, and the reaction for a row that costs one (Flash of Genius). Favored
// by the Gods costs no reaction.
export function canHelpSaveNow(campaignId: string, sheet: CharacterSheet, power: SaveHelp): boolean {
  const row = afterRollRow(power);
  return holdsRow(sheet, row) && (row.reaction ? canReactNow(campaignId, sheet) : !sheet.deathSaves?.dead);
}

// ---- the watch stop's answer, armed while its call runs ----

// The rolls a shift may answer, and which way each must go for it to:
// "success" rolls a creature's success again (a foe's save), "failure" an
// ally's failure (an ally's save, a companion's miss).
export type ShiftRoll = { tag: RollTag; reverse: "success" | "failure" };
// What a stop arms: a Chronal Shift rolls the d20 again; the save helps
// (after-roll-table.ts SAVE_HELPS) add to a failed save; Convergent Future
// and Bend Luck are armed here too, and answered by fate-turn.ts takeFate.
export type { SaveHelp } from "@/lib/dm/after-roll-table";
export type ArmedPower = WatchRowId;
type ArmedShift = { wizardId: string; rolls: readonly ShiftRoll[]; power: ArmedPower; used: boolean; note: string | null };

declare global {
  var __odmArmedShifts: Map<string, ArmedShift> | undefined;
}

export function armShift(campaignId: string, armed: { wizardId: string; rolls: readonly ShiftRoll[]; power?: ArmedPower }) {
  (globalThis.__odmArmedShifts ??= new Map()).set(campaignId, { ...armed, power: armed.power ?? "chronal_shift", used: false, note: null });
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

// Whether a watcher's answer is armed for this roll (a Chronal Shift, Flash of
// Genius or Favored by the Gods decided at the stop before it): the roll's
// own after-the-roll card would ask the same thing again (character-roll.ts).
export function shiftArmedFor(campaignId: string, tag: RollTag | undefined): boolean {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  return Boolean(armed && !armed.used && tag && armed.rolls.some((roll) => tagFits(roll.tag, tag)));
}

// The armed answer for this roll, when one is armed, not yet used, and names
// the roll: its power, whose it is, the way the roll must go for it to answer,
// and `use` to mark it spent with the line the call's answer carries. For the
// powers answered outside this file (fate-turn.ts).
export function armedFor(campaignId: string, tag: RollTag | undefined): { power: ArmedPower; holderId: string; reverse: ShiftRoll["reverse"]; use: (line: string) => void } | null {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  const roll = armed && !armed.used && tag ? armed.rolls.find((entry) => tagFits(entry.tag, tag)) : null;
  if (!armed || !roll) {
    return null;
  }
  return { power: armed.power, holderId: armed.wizardId, reverse: roll.reverse, use: (line) => { armed.used = true; armed.note = line; } };
}

// The roll site's question once it knows the outcome: does an armed shift
// answer this roll? When it does it is paid for here, and the caller rolls
// the d20 again and keeps the new roll. Returns the wizard's name, or null.
export function takeShift(campaignId: string, tag: RollTag | undefined, succeeded: boolean): string | null {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  if (!armed || armed.used || armed.power !== "chronal_shift" || !tag) {
    return null;
  }
  const answers = armed.rolls.some((roll) => tagFits(roll.tag, tag) && (roll.reverse === "success" ? succeeded : !succeeded));
  if (!answers || !payChronalShift(campaignId, armed.wizardId)) {
    return null;
  }
  armed.used = true;
  return getSheetById(armed.wizardId)?.name ?? "The wizard";
}

// The save site's question for a save help armed at the stop (Flash of
// Genius, Favored by the Gods): does it answer this failed save? It is paid
// only where the most it adds could carry the save (as its card offers it,
// after-roll-logic.ts helperOption): Flash of Genius's Intelligence modifier,
// Favored by the Gods' 8. Then the use (and a reaction, for a row that costs
// one) is spent here and the save comes back with the bonus on it. Null
// leaves the save as it was.
export function takeSaveHelp(campaignId: string, tag: RollTag, saver: string, outcome: RollResult, dc: number): { outcome: RollResult; line: string } | null {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  if (!armed || armed.used || !isSaveHelp(armed.power) || outcome.total >= dc || !armed.rolls.some((roll) => tagFits(roll.tag, tag))) {
    return null;
  }
  const campaign = getCampaignById(campaignId);
  const helper = getSheetById(armed.wizardId);
  if (!campaign || !helper || !canHelpSaveNow(campaignId, helper, armed.power)) {
    return null;
  }
  const row = watchRow(armed.power)!;
  const amount = row.amount;
  const modifier = amount?.kind === "ability" ? computeSheetDerived(helper).abilityMods[amount.ability] : 0;
  const most = mostAdded(row, { modifier });
  if ((amount?.kind === "ability" && modifier < 1) || outcome.total + most < dc) {
    return null;
  }
  if (!spendFeatureUse(campaign, helper.id, row.counter!, row.feature, "player")) {
    return null;
  }
  const encounter = row.reaction ? getActiveEncounter(campaignId) : null;
  if (encounter) {
    markReactionUsed(encounter, helper.id);
  }
  armed.used = true;
  let helped = outcome;
  if (amount?.kind === "dice") {
    for (let at = 0; at < amount.count; at += 1) {
      helped = withBonusDie(helped, { sides: amount.sides, value: rollExpression(`1d${amount.sides}`).total, kept: true });
    }
  } else {
    helped = withFlatBonus(outcome, amount?.kind === "flat" ? amount.value : modifier);
  }
  const feature = row.feature;
  const verdict = helped.total >= dc ? "it succeeds" : "it still fails";
  armed.note = `${helper.name} used ${feature}: ${saver}'s ${tag.kind === "check" ? "check" : "save"} went from ${outcome.total} to ${helped.total} against DC ${dc}, and ${verdict}.`;
  return { outcome: helped, line: `${feature}: ${outcome.total} became ${helped.total}` };
}

// The line the call's answer carries: who rolled again, and the two totals.
export function noteShift(campaignId: string, line: string) {
  const armed = globalThis.__odmArmedShifts?.get(campaignId);
  if (armed) {
    armed.note = line;
  }
}

// Runs one held call with the shift armed (the watch stop's answer).
export async function runWithShift<T>(campaignId: string, choice: { wizardId: string; rolls: readonly ShiftRoll[]; power?: ArmedPower } | null, run: () => Promise<T>): Promise<{ result: T; shift: string | null }> {
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
