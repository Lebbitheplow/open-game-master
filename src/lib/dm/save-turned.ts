// A saving throw a character failed, turned into a success after it landed.
// The engine resolves a forced save where it is forced, so a feature that
// decides the save from outside the roll (Slayer's Counter: "if the attack
// hits, your save automatically succeeds"; Flash of Genius adding the
// artificer's Intelligence modifier to a save that could not wait on a card)
// arrives with the failure already paid for. This gives back what the failure
// alone cost, from the record of that save (last-save.ts):
//
//   - the damage a success would have spared (`damage.spared`, written by
//     cast-at-player.ts with the save's own half-or-none rule), as hit points;
//   - the conditions that failure laid which the same save ends (the ability
//     and the DC on the condition's saveEnds), as a reroll that succeeds takes
//     them off (feature-spends.ts indomitable, ar-ws-deflection.ts).
//
// What goes through here: every reaction or use that makes a failed save a
// success once it has landed. A condition with no save to end it, and damage
// dealt by a door that keeps no `spared`, are named in the line for the GM.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { effectiveMaxHp, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { markSaveTurned, openSaves, type LastSave } from "@/lib/dm/last-save";
import { reactionPatch } from "@/lib/dm/reaction-refund";
import { UNCONSCIOUS } from "@/lib/dm/vitals-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The conditions on the sheet that this save's failure laid and its success
// ends, with their notes, for a caller that lifts them for a moment.
export function laidBySave(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, save: Pick<LastSave, "ability" | "dc">): { names: string[]; meta: ConditionMetaMap } {
  const stood = standingBeforeSave(sheet, save);
  const names = sheet.conditions.filter((entry) => !stood.conditions.includes(entry));
  const all = (sheet.conditionMeta ?? {}) as ConditionMetaMap;
  return { names, meta: Object.fromEntries(names.filter((name) => all[name]).map((name) => [name, all[name]])) as ConditionMetaMap };
}

// The latest save this character failed that is still open (this fight, this
// turn), forced by the creature named when one is.
export function openFailedSave(campaignId: string, characterId: string, forcerId?: string | null): LastSave | null {
  return openSaves(campaignId).filter((save) => save.characterId === characterId && save.success === false && (!forcerId || save.forcer.id === forcerId)).at(-1) ?? null;
}

// The sheet as it stood before the save was failed: without the conditions
// that save ends. The reaction gate judges a reaction that comes "before the
// save" by it (reaction-tools.ts), so a failure that paralyzed them does not
// bar the answer to it.
export function standingBeforeSave<T extends Pick<CharacterSheet, "conditions" | "conditionMeta">>(sheet: T, save: Pick<LastSave, "ability" | "dc">): T {
  const meta = (sheet.conditionMeta ?? {}) as ConditionMetaMap;
  const laid = (entry: string) => {
    const ends = meta[entry]?.saveEnds;
    return Boolean(ends) && ends!.ability === save.ability && (save.dc === undefined || ends!.dc === save.dc);
  };
  return sheet.conditions.some(laid) ? { ...sheet, conditions: sheet.conditions.filter((entry) => !laid(entry)) } : sheet;
}

export type TurnedSave = { lifted: string[]; givenBack: number; hp: number; line: string };

// Makes the failed save a success: hit points back, its conditions off, the
// record marked made. Audited as a reaction's change, so "Revert this turn"
// undoes it with the reaction.
// `already`: conditions of that save a caller took off before this (a
// reaction made before the save, which acted as its holder stood then).
export function turnFailedSave(campaign: Campaign, turnId: string, save: LastSave, reason: string, already: string[] = []): TurnedSave {
  const now = getSheetById(save.characterId);
  if (!now) {
    return { lifted: [], givenBack: 0, hp: 0, line: "The save succeeds." };
  }
  const meta = (now.conditionMeta ?? {}) as ConditionMetaMap;
  const here = now.conditions.filter((entry) => {
    const ends = meta[entry]?.saveEnds;
    return Boolean(ends) && ends!.ability === save.ability && (save.dc === undefined || ends!.dc === save.dc);
  });
  const lifted = [...already, ...here];
  const spared = Math.max(0, save.damage?.spared ?? 0);
  const hp = Math.min(effectiveMaxHp(now), now.currentHp + spared);
  const givenBack = hp - now.currentHp;
  const woke = now.currentHp <= 0 && hp > 0;
  const off = [...here, ...(woke ? now.conditions.filter((entry) => isConditionNamed(entry, UNCONSCIOUS)) : [])];
  if (off.length || givenBack > 0) {
    const cleared = removeConditions(now.conditions, now.conditionMeta, off);
    reactionPatch(campaign, turnId, now.id, { currentHp: hp, conditions: cleared.conditions, conditionMeta: cleared.meta, ...(woke ? { deathSaves: null } : {}) }, reason);
  }
  markSaveTurned(campaign.id, save.id);
  const unknown = save.damage && save.damage.spared === undefined ? ` ${now.name} took ${save.damage.amount}${save.damage.type ? ` ${save.damage.type}` : ""} damage through the failure: give back what a success would have spared.` : "";
  return {
    lifted,
    givenBack,
    hp,
    line: `The ${save.ability.toUpperCase()} save against ${save.forcer.name} is a success now${givenBack > 0 ? `: ${givenBack} hit points come back (HP ${hp})` : ""}${lifted.length ? `${givenBack > 0 ? ", and" : ":"} ${lifted.join(", ")} no longer hold${lifted.length === 1 ? "s" : ""} ${now.name}` : ""}.${unknown}`,
  };
}
