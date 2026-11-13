import { getClock } from "@/lib/db/clock";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { effectiveMaxHp, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { MUMMY_ROT, ROT_DICE, holdsMummyRot, rotDaysBetween } from "@/lib/dm/mummy-rot-logic";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import { publishPersisted, publishWithSeq } from "@/lib/events";

// The clock's half of mummy rot (src/lib/dm/mummy-rot-logic.ts): when the
// curse took hold, and the 3d6 the maximum loses for every 24 hours after.

function metaKey(meta: ConditionMetaMap): string {
  return Object.keys(meta).find((name) => name.trim().toLowerCase() === MUMMY_ROT) ?? MUMMY_ROT;
}

// Marks the hour the curse took hold, once: a second rotting fist on a
// cursed hero does not restart its days.
export function startMummyRot(campaignId: string, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (!sheet || !holdsMummyRot(sheet.conditions)) {
    return;
  }
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  const key = metaKey(meta);
  if (typeof meta[key]?.rotFrom === "number") {
    return;
  }
  meta[key] = { ...meta[key], rotFrom: getClock(campaignId).instant };
  const updated = patchSheetAudited(campaignId, sheetId, { conditionMeta: meta }, { kind: "condition_clock", reason: "mummy rot took hold", delta: { rotFrom: meta[key].rotFrom } });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
}

// Every 24 hours the clock moved past since the curse took hold costs 3d6
// of the maximum, and a maximum brought to 0 kills. A curse laid with no
// hour on it (by hand, at the console) starts its days with this move.
export function mummyRotClock(campaignId: string, from: number, to: number) {
  const lines: string[] = [];
  for (const stale of listSheets(campaignId)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (!holdsMummyRot(sheet.conditions) || sheet.deathSaves?.dead) {
      continue;
    }
    const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
    const key = metaKey(meta);
    const rotFrom = meta[key]?.rotFrom ?? from;
    const days = rotDaysBetween(rotFrom, from, to);
    if (!days && typeof meta[key]?.rotFrom === "number") {
      continue;
    }
    let max = effectiveMaxHp(sheet);
    let taken = 0;
    for (let day = 0; day < days && max > 0; day += 1) {
      // No more than the maximum there is to take, so lifting the curse
      // gives back what it took and not a point more.
      const lost = Math.min(max, rollExpression(ROT_DICE).total);
      taken += lost;
      max -= lost;
    }
    meta[key] = { ...meta[key], rotFrom, ...(taken || meta[key]?.rotDrain ? { rotDrain: (meta[key]?.rotDrain ?? 0) + taken } : {}) };
    const updated = patchSheetAudited(campaignId, sheet.id, {
      conditionMeta: meta,
      ...(max <= 0 ? { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } } : {}),
    }, { kind: "condition_clock", reason: "mummy rot", delta: { rotDrain: taken } });
    if (updated) {
      publishPersisted(campaignId, "sheet_updated", { sheet: updated });
    }
    if (taken) {
      lines.push(max <= 0
        ? `Mummy rot takes the last of ${sheet.name}'s hit point maximum: they die, and their body turns to dust.`
        : `Mummy rot eats ${taken} of ${sheet.name}'s hit point maximum (now ${max}). Only Remove Curse or other magic ends it.`);
    }
  }
  if (lines.length) {
    const seq = tableNoteSeq(campaignId);
    const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-bell", content: lines.join(" ") });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }
}
