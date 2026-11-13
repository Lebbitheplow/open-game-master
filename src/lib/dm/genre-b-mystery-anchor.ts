// Anchor of the Living (spirit medium, 18th level): "when a creature within
// 30 ft dies, hold its spirit: it can be revived within 24 hours as if freshly
// dead" (WAVE2 D5: the genre text is the rule, on the SRD 5.1 engine).
//
// The hold is written to the dead character's audit trail beside the moment of
// their death (src/lib/dm/revival.ts), with the world's clock. While it lasts
// revival.ts minutesSinceDeath answers 0 for that death, so the one door every
// spell that returns the dead asks (heal-spell.ts) finds the character freshly
// dead: Revivify's minute does not run out for a day.
//
// Before this the use was spent and Revivify refused a hero a minute later.
import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase, parseJson } from "@/lib/db/core";
import { getClock } from "@/lib/db/clock";
import { insertSheetAudit } from "@/lib/db/sheet-audit";

const KIND = "spirit_anchor";
// "within 24 hours", in the clock's minutes.
const HOLD_MINUTES = 24 * 60;

export function anchorSpirit(campaignId: string, characterId: string, by: string) {
  insertSheetAudit({
    campaignId,
    characterId,
    kind: KIND,
    delta: { instant: getClock(campaignId).instant, by },
    reason: `${by} holds the spirit (Anchor of the Living)`,
    seq: allocateSeq(campaignId),
  });
}

// Whether a death at `diedAt` is under a hold still running, a day at most.
export function spiritHeld(campaignId: string, characterId: string, diedAt: number): boolean {
  const row = getDatabase()
    .prepare(`SELECT delta_json FROM sheet_audit WHERE character_id = ? AND kind = ? AND reverted_at IS NULL ORDER BY seq DESC LIMIT 1`)
    .get(characterId, KIND) as { delta_json: string } | undefined;
  const hold = row ? parseJson<{ instant?: number } | null>(row.delta_json, null) : null;
  // Laid as the creature lay dying (at most a minute before the death) or
  // once it was dead; an earlier death's hold does not carry over.
  if (!hold || typeof hold.instant !== "number" || hold.instant < diedAt - 1) {
    return false;
  }
  return getClock(campaignId).instant - Math.max(hold.instant, diedAt) <= HOLD_MINUTES;
}
