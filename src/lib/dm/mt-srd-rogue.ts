// Stroke of Luck's second half (SRD 5.1, rogue 20): "Alternatively, if you
// fail an ability check, you can treat the d20 roll as a 20."
//
// The attack half is the Hand's card on a miss (pc_attack). A check has no
// such card: use_resource Stroke of Luck answers the rogue's own last roll
// when that roll is an ability check that failed, as Indomitable answers a
// failed save (feature-spends.ts). The d20 it kept is read as a 20, the total
// is worked out again against the check's own DC, and the use is spent. With
// no failed check to answer it returns null and the counter's own refusal
// (resource-tools.ts) points at the attack's card.

import type { Campaign } from "@/lib/db/campaigns";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { publishSheet } from "@/lib/dm/combat-features";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COUNTER = "stroke_of_luck";

export function strokeOfLuckCheck(campaign: Campaign, stale: CharacterSheet): ToolResult | null {
  const sheet = getSheetById(stale.id) ?? stale;
  const pool = sheet.resources?.[COUNTER];
  if (!pool) {
    return null;
  }
  // Their last roll, whatever it was: an older check is not what just failed.
  const last = listRecentRolls(campaign.id, 60).find((roll) => roll.characterId === sheet.id && roll.kind !== "damage");
  if (!last || (last.kind !== "skill_check" && last.kind !== "ability_check") || last.dc === null || last.total >= last.dc) {
    return null;
  }
  const natural = last.breakdown?.natural;
  if (typeof natural !== "number") {
    return null;
  }
  if (pool.used >= pool.max) {
    return { error: `${sheet.name} has used Stroke of Luck; it comes back on a short or long rest. Nothing was spent.`, refused: "rules" };
  }
  const total = last.total - natural + 20;
  if (total < last.dc) {
    return { error: `Even with the d20 as a 20 the check comes to ${total} against DC ${last.dc}, so Stroke of Luck would change nothing. Nothing was spent.`, refused: "rules" };
  }
  patchSheetAudited(campaign.id, sheet.id, { resources: { ...sheet.resources, [COUNTER]: { max: pool.max, used: pool.used + 1 } } }, {
    kind: "use_resource",
    reason: "Stroke of Luck",
    delta: { resource: "Stroke of Luck", spent: 1 },
  });
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: "Stroke of Luck",
    spent: 1,
    left: `${pool.max - pool.used - 1}/${pool.max}`,
    check: { detail: last.detail, d20: 20, total, dc: last.dc, success: true },
    applied: `${sheet.name}'s failed check (${last.detail}: ${last.total} against DC ${last.dc}) is read with the d20 as a 20: ${total}, a success. Narrate it as made.`,
  };
}
