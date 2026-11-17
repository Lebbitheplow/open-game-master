// What a concentration spell held for its whole duration leaves behind
// (src/lib/srd/full-duration.ts), settled before the time that ends it is
// counted on the creatures it holds.
//
// The clock and the conditions count on the same turn starts, the conditions
// first (condition-tick.ts countTurnStarts), so a minute's paralysis, a
// minute's banishment, had already run out when the concentration clock asked
// what the casting still held: a banished fiend held the whole minute came
// back, and Flesh to Stone held to its end turned nobody to stone. What runs
// out on this count is settled here first; the clock's own settle then finds
// it done.
//
// Banishment (SRD 5.1): "If the target is native to a different plane of
// existence than the one you're on ... If the spell ends before 1 minute has
// passed, the target reappears in the space it left ... Otherwise, the target
// doesn't return." The SRD's celestials, elementals, fey and fiends go home
// for good and leave the fight; any other target reappears as the spell ends.

import type { Campaign } from "@/lib/db/campaigns";
import { closeStandInTurn, openStandInTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { settleFullDuration } from "@/lib/dm/concentration";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { sendHome } from "@/lib/dm/spell-planes";
import { spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { fullDurationRule } from "@/lib/srd/full-duration";
import { textKey } from "@/lib/language/text-logic";

// The creatures of the rule's types this casting still holds go home and
// leave the fight. Lines for the table.
export function banishedHome(campaign: Campaign, spell: string, casterId: string): string[] {
  const resolved = spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) });
  const rule = fullDurationRule(resolved?.runsAs ?? resolved?.name ?? spell) ?? fullDurationRule(spell);
  const encounter = getActiveEncounter(campaign.id);
  if (!rule?.sendsHome || !encounter) {
    return [];
  }
  const names = new Set([textKey(spell), ...(resolved ? [textKey(resolved.name)] : [])]);
  const held = listEnemies(encounter.id).filter(
    (enemy) =>
      enemy.status === "alive" &&
      enemy.conditions.some((name) =>
        instancesOf((enemy.conditionMeta as ConditionMetaMap)[name]).some((entry) => Boolean(entry.spell && names.has(textKey(entry.spell))) && entry.source === casterId),
      ),
  );
  if (!held.length) {
    return [];
  }
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const turn = openStandInTurn(campaign.id);
  try {
    return held.flatMap((enemy) => {
      const line = sendHome(campaign, turn, enemy, rule.sendsHome!, spell, sheets, sheetsById, ", held there the whole minute, and does not return");
      return line ? [line] : [];
    });
  } finally {
    closeStandInTurn(turn);
  }
}

// Every concentration this count of `by` rounds runs out (the ones `counts`
// picks, as tickConcentrationClocks picks them): what it leaves for good is
// settled now, before the count reaches the creatures it holds.
export function settleRunningOut(campaign: Campaign, by: number, counts: (casterId: string) => boolean): string[] {
  if (by <= 0) {
    return [];
  }
  const lines: string[] = [];
  const settle = (spell: string, casterId: string) => {
    if (!fullDurationRule(spell) && !fullDurationRule(spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) })?.runsAs ?? "")) {
      return;
    }
    lines.push(...settleFullDuration(campaign, spell, casterId), ...banishedHome(campaign, spell, casterId));
  };
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const left = sheet.concentrationRounds;
    if (sheet.concentratingOn && typeof left === "number" && left - by <= 0 && counts(sheet.id)) {
      settle(sheet.concentratingOn, sheet.id);
    }
  }
  const encounter = getActiveEncounter(campaign.id);
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    const left = enemy.concentrationRounds;
    if (enemy.status === "alive" && enemy.concentration && typeof left === "number" && left - by <= 0 && counts(enemy.id)) {
      settle(enemy.concentration, enemy.id);
    }
  }
  return lines;
}
