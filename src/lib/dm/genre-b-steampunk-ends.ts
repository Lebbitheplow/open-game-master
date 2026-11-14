// What a steampunk feature costs when its effect ends, and the marks its
// other effects use up (WAVE2 D5: the genre text is the rule).
//
//   Full Throttle (steam knight 18)  "double your speed and gain an extra
//     action each turn for 1 minute; take 3d10 fire when it ends."
//
// The minute can end in many places (its count running out as the knight's
// turn starts, the clock on the road, the GM taking it off), so the boiler's
// debt is a mark of its own, "boiler strain", as a Berserker's frenzy is
// (src/lib/dm/frenzy.ts): whatever ends "full throttle" leaves the strain
// behind, and settleFullThrottle turns a strain with no throttle over it into
// the 3d10 fire it owes. The spend lays both (the buff's `debt`,
// src/lib/dm/authored-spend-effects.ts); the settling runs at each round's
// wrap, after the clock's tick (src/lib/dm/condition-tick.ts) and when a
// fight ends (src/lib/dm/enemy-damage.ts settleFightState).
//
//   Galvanic Discharge (aether channeler 1)  the charge is spent by the first
//     creature it shocks (spendRetaliateMark, called by
//     src/lib/dm/authored-hooks.ts once a retaliate that names a mark has dealt
//     its damage).
//
// Before this Full Throttle's end cost nothing and the charge never ran out.
import type { Campaign } from "@/lib/db/campaigns";
import { closeStandInTurn, openStandInTurn } from "@/lib/db/dm-turns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions } from "@/lib/dm/condition-logic";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { rollCard } from "@/lib/dm/roll-card";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { BOILER_STRAIN, FULL_THROTTLE } from "@/lib/srd/genre-b-steampunk-conditions";

const carries = (sheet: Pick<CharacterSheet, "conditions">, name: string) => sheet.conditions.some((entry) => isConditionNamed(entry, name));

function write(campaign: Campaign, sheet: CharacterSheet, conditions: string[], conditionMeta: CharacterSheet["conditionMeta"]) {
  const updated = patchSheet(sheet.id, { conditions, conditionMeta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// One table line per knight whose Full Throttle has ended.
export function settleFullThrottle(campaign: Campaign): string[] {
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (carries(sheet, FULL_THROTTLE) || !carries(sheet, BOILER_STRAIN)) {
      continue;
    }
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, sheet.conditions.filter((entry) => isConditionNamed(entry, BOILER_STRAIN)));
    write(campaign, sheet, cleared.conditions, cleared.meta);
    if (sheet.deathSaves?.dead) {
      continue;
    }
    const turn = openStandInTurn(campaign.id);
    try {
      const amount = Number(rollCard(campaign, turn, sheet.id, "damage", `${sheet.name}: Full Throttle ends`, "3d10", null).total);
      const hurt = applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount, type: "fire", reason: "Full Throttle ends" });
      const after = getSheetById(sheet.id) ?? sheet;
      lines.push(`${sheet.name}'s Full Throttle ends and the boiler scalds them: ${hurt.error ? `${amount} fire` : `${sheet.currentHp - after.currentHp} fire damage of the ${amount} rolled`} (HP ${after.currentHp}/${after.maxHp}).`);
    } finally {
      closeStandInTurn(turn);
    }
  }
  return lines;
}

// A retaliate's mark, used up by the blow it answered.
export function spendRetaliateMark(campaign: Campaign, holderId: string, mark: string): void {
  const sheet = getSheetById(holderId);
  if (!sheet || !carries(sheet, mark)) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, sheet.conditions.filter((entry) => isConditionNamed(entry, mark)));
  write(campaign, sheet, cleared.conditions, cleared.meta);
}
