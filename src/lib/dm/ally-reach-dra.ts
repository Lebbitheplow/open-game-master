// Whether a creature a feature aims at stands within its range and in its
// holder's sight, for a feature whose words say "a creature you can see
// within N feet" (Balm of the Summer Court, Arcane Jolt's healing). One
// answer for every door that aims such a feature: the counter's spend
// (resource-tools.ts), an authored spend (authored-spend-divine-dra.ts).
//
// Off a fight, or with no board, nothing is measured: the fiction decides,
// as withinFeet and unseenBecause say.

import { getActiveEncounter } from "@/lib/db/encounters";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function allyReachRefusal(
  campaignId: string,
  holder: CharacterSheet,
  target: CharacterSheet,
  rule: { feature: string; rangeFt?: number; sight?: boolean; fromId?: string; fromName?: string },
): ToolError | null {
  if (target.id === holder.id && !rule.fromId) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  if (rule.sight && target.id !== holder.id) {
    const unseen = unseenBecause(encounter.id, holder, target);
    if (unseen) {
      return { error: `${holder.name} cannot see ${target.name} (${unseen}), and ${rule.feature} reaches a creature they can see. Nothing was spent.`, refused: "rules" };
    }
  }
  const from = rule.fromId ?? holder.id;
  if (rule.rangeFt && !withinFeet(encounter.id, from, target.id, rule.rangeFt)) {
    return { error: `${target.name} is beyond ${rule.rangeFt} feet of ${rule.fromName ?? holder.name}; ${rule.feature} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  return null;
}
