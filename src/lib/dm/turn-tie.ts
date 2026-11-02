// A condition a creature laid that lasts until the start or the end of a
// combatant's next turn (SRD 5.1: a mummy lord's Blasphemous Word stuns
// "until the end of the mummy lord's next turn", its Blinding Dust blinds
// "until the end of the creature's next turn", a ghast's stench poisons
// "until the start of its next turn"), tied to that turn. Counted as one
// round it ended at the next round's start, before that turn or after it by
// where the two stand in the order. The end of a turn takes what names it in
// `untilTurnEndOf` (src/lib/dm/turn-end.ts), the start what names it in
// `untilTurnOf` (src/lib/dm/condition-tick.ts).

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { instancesOf, packInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

export type TurnBound = { edge: "start" | "end"; turnOf: string };

// The instance `sourceId` laid of the condition, under whatever spelling it
// was written, tied to the turn instead of its count of rounds. Returns
// whether one was found.
export function tieToTurn(
  campaign: Campaign,
  holder: { kind: "sheet" | "enemy"; id: string },
  condition: string,
  sourceId: string,
  bound: TurnBound,
  reason: string,
): boolean {
  const tied = (meta: Record<string, ConditionMeta>) => {
    let found = false;
    const next = Object.fromEntries(
      Object.entries(meta).map(([name, held]) => {
        if (!isConditionNamed(name, condition)) {
          return [name, held];
        }
        const instances = instancesOf(held).map((entry) => {
          if (entry.source !== sourceId) {
            return entry;
          }
          found = true;
          const lasting: ConditionMeta = bound.edge === "end" ? { ...entry, untilTurnEndOf: bound.turnOf } : { ...entry, untilTurnOf: bound.turnOf };
          delete lasting.rounds;
          delete lasting.turnBegun;
          return lasting;
        });
        return [name, packInstances(instances) ?? {}];
      }),
    );
    return found ? next : null;
  };
  if (holder.kind === "sheet") {
    const now = getSheetById(holder.id);
    const meta = now ? tied(now.conditionMeta as Record<string, ConditionMeta>) : null;
    if (now && meta) {
      patchSheetAudited(campaign.id, now.id, { conditionMeta: meta as ConditionMetaMap }, {
        kind: "condition_clock",
        reason,
        delta: { ended: [], added: [] },
      });
    }
    return Boolean(meta);
  }
  const now = getEnemy(holder.id);
  const meta = now ? tied(now.conditionMeta as Record<string, ConditionMeta>) : null;
  if (now && meta) {
    patchEnemyConditions(now.id, now.conditions, meta as ConditionMetaMap);
    publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  }
  return Boolean(meta);
}
