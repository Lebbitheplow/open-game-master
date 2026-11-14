// What a creature dropping to 0 by a mystery or post-apocalyptic character's
// hand sets off (WAVE2 D5), asked by src/lib/dm/authored-hooks.ts
// authoredOnKill as the creature falls:
//
//   Message Sent (enforcer)      "After you drop a creature, its allies save
//                                (WIS) or are frightened of you until your next
//                                turn": every other creature still fighting
//                                the party
//   Skull Takers (road warrior)  "When you drop a creature, enemies within 15 ft
//                                save (WIS) or are frightened of you until your
//                                next turn": measured from the road warrior,
//                                who struck it
//
// The text names no DC: it is 8 + proficiency + the holder's best modifier, as
// every genre counter's save that names none (src/lib/srd/counter-rules.ts
// counterSaveDc). The fear is the holder's ("of you") and lasts the round.
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { computeSheetDerived } from "@/lib/srd";
import { counterSaveDc } from "@/lib/srd/counter-rules";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

const ROWS: Array<{ classId: string; feature: string; feet?: number }> = [
  { classId: "enforcer", feature: "Message Sent" },
  { classId: "road_warrior", feature: "Skull Takers", feet: 15 },
];

export function genreBOnKill(campaign: Campaign, encounter: Encounter, fallen: EncounterEnemy, killerId: string | null): string[] {
  const killer = killerId ? getSheetById(killerId) : null;
  if (!killer) {
    return [];
  }
  const lines: string[] = [];
  for (const row of ROWS.filter((entry) => holdsGenreFeature(killer, entry.classId, entry.feature))) {
    const derived = computeSheetDerived(killer);
    const dc = counterSaveDc(undefined, derived, Math.max(...Object.values(derived.abilityMods)));
    const caught = listEnemies(encounter.id).filter((enemy) => enemy.id !== fallen.id && enemy.status === "alive" && (!row.feet || withinFeet(encounter.id, killer.id, enemy.id, row.feet)));
    for (const enemy of caught) {
      const save = rollEnemySave(campaign.id, enemy, "wis", dc, {
        resist: bindsWorthResisting(["frightened"]),
        against: "frightened",
        origin: { ref: killer.id },
        record: { detail: `${enemy.displayName}: WIS save against ${row.feature}` },
      });
      const fresh = getEnemy(enemy.id) ?? enemy;
      if (save.success || immuneToCondition(fresh, "frightened")) {
        lines.push(`${row.feature}: ${enemy.displayName} ${save.success ? "holds its nerve" : "cannot be frightened"} (WIS ${save.total} vs DC ${dc}).`);
        continue;
      }
      layEnemyConditionInstance(campaign, fresh, "frightened", { source: killer.id, rounds: 1 });
      lines.push(`${row.feature}: ${enemy.displayName} is frightened of ${killer.name} until their next turn (WIS ${save.total} vs DC ${dc}).`);
    }
  }
  if (lines.length) {
    publishEncounter(campaign.id);
  }
  return lines;
}
