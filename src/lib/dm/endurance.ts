// Hour-by-hour Constitution saves against exhaustion: a forced march past
// eight hours, a day in extreme heat or cold. One save at the end of each
// hour, each with its own DC, each failure one level of exhaustion (SRD 5.1,
// Travel Pace, Forced March; the DMG's weather rules the SRD's Gamemastering
// section carries). Before this a twelve-hour march rolled one save at the
// last hour's DC and could cost one level at most.
//
// Every save rides the character's own roll path, so a held Bardic
// Inspiration, Help or Guidance is folded in and spent by the save it rides.
// Each is thrown through the character's d20 door (character-roll.ts rollCharacterD20), so what
// a watch stop armed for it in a fight (a foretold number, a Chronal Shift,
// Flash of Genius, Favored by the Gods: src/lib/dm/foresight.ts) lands on the
// first hour's save it answers.

import { recordRoll } from "@/lib/dm/roll-record";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { heldDieWaits, rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { rollCharacterD20 } from "@/lib/dm/character-roll";
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type HourSave = {
  hour: number;
  dc: number;
  // Null when a condition failed the save with no die rolled.
  save: number | null;
  failed: boolean;
  exhaustion?: number;
  // The hour's level was the sixth (SRD 5.1, Exhaustion: "6: Death").
  dead?: true;
};

// "Ilse dies of exhaustion." for whoever an hour of saves killed, or "".
export function exhaustionDeaths(results: Array<{ name: string; saves?: HourSave[] }>): string {
  const dead = results.filter((entry) => entry.saves?.some((hour) => hour.dead)).map((entry) => entry.name);
  return dead.length ? ` ${dead.join(" and ")} ${dead.length === 1 ? "dies" : "die"} of exhaustion (level 6).` : "";
}

// One character's saves, hour by hour. Stops at death: exhaustion 6 kills.
export function hourlyConSaves(input: {
  campaign: Campaign;
  turn: DmTurn;
  sheet: CharacterSheet;
  hours: Array<{ hour: number; dc: number }>;
  disadvantage?: boolean;
  detail: (hour: number) => string;
  reason: string;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): HourSave[] {
  const { campaign, turn } = input;
  const out: HourSave[] = [];
  for (const { hour, dc } of input.hours) {
    const sheet = getSheetById(input.sheet.id) ?? input.sheet;
    if (sheet.deathSaves?.dead) {
      break;
    }
    const args = {
      kind: "saving_throw",
      ability: "con",
      dc,
      ...(input.disadvantage ? { advantage: "disadvantage" } : {}),
    } as unknown as RollArgs;
    const waits = heldDieWaits(sheet, dc);
    const resolved = resolveRollExpression(args, sheet, { ...rollExtrasFor(campaign, sheet, "saving_throw"), keepHeldDie: waits });
    if ("error" in resolved) {
      break;
    }
    let failed: boolean;
    let save: number | null = null;
    if ("autoFail" in resolved) {
      failed = true;
    } else {
      spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
      // The player's own save (src/lib/dm/character-roll.ts; WAVE1 R5): on
      // physical dice they roll it, hour by hour.
      const rolled = rollCharacterD20(campaign, sheet, { kind: "saving_throw", expression: resolved.expression, detail: input.detail(hour), parts: resolved.parts, dc, settleHeldDie: waits });
      save = rolled.total;
      recordRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "saving_throw",
        detail: input.detail(hour),
        parts: resolved.parts,
        dc,
        result: rolled,
        turn,
      });
      failed = rolled.total < dc;
    }
    const entry: HourSave = { hour, dc, save, failed };
    if (failed) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "set_condition",
        JSON.stringify({ characterId: sheet.id, condition: "exhaustion", reason: input.reason }),
        input.sheets,
        input.sheetsById,
      ).result as { level?: number; dead?: boolean };
      // set_condition's answer: the level reached, and a death at the sixth.
      // Neither was read before, so the GM heard only "failed".
      if (typeof applied.level === "number") {
        entry.exhaustion = applied.level;
      }
      if (applied.dead) {
        entry.dead = true;
      }
    }
    out.push(entry);
  }
  return out;
}
