// What the rigger's features do to the drones (WAVE2 D5: a drone is a
// summoned construct, src/lib/dm/genre-a-summons.ts), each called from the
// one door its moment passes through:
//   Self-Repair Protocol, "Each drone regains 2d6 HP at the start of your
//     turn, once per rest each": the rigger's turn start
//     (src/lib/dm/authored-turns.ts). Its counter holds one use per drone
//     (Drone Swarm's second, Drone Legion's third) and each drone keeps a
//     mark of the use it took, so a drone mended since the rest is passed
//     over while a drone not yet mended still is, whatever the order.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { regainHitPoints } from "@/lib/dm/regain";
import { rollCard } from "@/lib/dm/roll-card";
import { riggerDrones } from "@/lib/dm/genre-a-summons";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SELF_REPAIR = "cyberpunk_self_repair_protocol";
const MENDED = "self-repaired";

// The counter's use this drone took, or null: a mark from before the rest
// (the counter since refilled below it) no longer counts.
function mendedSinceRest(drone: CharacterSheet, used: number): boolean {
  const mark = drone.conditions.find((entry) => textKey(entry) === MENDED);
  const took = Number((drone.conditionMeta as Record<string, { use?: number }> | undefined)?.[mark ?? ""]?.use ?? 0);
  return Boolean(mark) && took > 0 && took <= used;
}

export function selfRepairDrones(campaign: Campaign, rigger: CharacterSheet): string[] {
  if (!holdsFeature(rigger, "Self-Repair Protocol")) {
    return [];
  }
  const lines: string[] = [];
  for (const stale of riggerDrones(campaign.id, rigger.id)) {
    const drone = getSheetById(stale.id) ?? stale;
    const pool = (getSheetById(rigger.id) ?? rigger).resources?.[SELF_REPAIR];
    if (!pool || pool.used >= pool.max) {
      break;
    }
    if (drone.currentHp <= 0 || drone.currentHp >= drone.maxHp || mendedSinceRest(drone, pool.used)) {
      continue;
    }
    const amount = rollCard(campaign, null, rigger.id, "custom", `Self-Repair Protocol: ${drone.name} regains`, "2d6", null).total;
    const given = regainHitPoints(campaign, null, drone, amount, "Self-Repair Protocol, as the rigger's turn starts");
    if (given <= 0) {
      continue;
    }
    const use = pool.used + 1;
    const now = getSheetById(rigger.id) ?? rigger;
    patchSheetAudited(campaign.id, rigger.id, { resources: { ...now.resources, [SELF_REPAIR]: { max: pool.max, used: use } } }, { kind: "use_resource", reason: "Self-Repair Protocol, as the turn starts", delta: { resource: "Self-Repair Protocol", spent: 1 } });
    const mended = getSheetById(drone.id) ?? drone;
    const conditions = [...mended.conditions.filter((entry) => textKey(entry) !== MENDED), MENDED];
    const conditionMeta = { ...((mended.conditionMeta as Record<string, unknown> | undefined) ?? {}), [MENDED]: { use, source: rigger.id } };
    patchSheetAudited(campaign.id, drone.id, { conditions, conditionMeta: conditionMeta as never }, { kind: "use_resource", reason: "Self-Repair Protocol", delta: { resource: "Self-Repair Protocol", spent: 0 } });
    lines.push(`Self-Repair Protocol: ${drone.name} regains ${given} hit points.`);
  }
  return lines;
}
