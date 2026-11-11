// The Hound of Ill Omen's bond to its quarry (Shadow Magic 6): "summon a
// shadow dire wolf that chases one creature". The hound the spend brings in
// (ar-ws-hound.ts) carries a condition whose meta names the creature it hunts,
// and that bond is read here by the two doors that keep it:
//
//   - pc-attack-gate.ts gatePcAttack: the hound attacks its quarry and no
//     other creature, whoever plays it;
//   - summon-store.ts sweepSummons: a hound whose quarry has fallen or left the
//     fight, or whose fight is over, is gone when the turn next moves on.
//
// Kept apart from ar-ws-hound.ts so summon-store.ts can ask it without a
// cycle (that module spawns through summon-store.ts).

import { getEnemy } from "@/lib/db/encounters";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const HOUND = "Hound of Ill Omen";
// The condition on the hound whose meta names its quarry (authored-conditions.ts).
export const HUNTING = "hunting its quarry";

type Bound = Pick<CharacterSheet, "conditions" | "conditionMeta">;

// The id of the creature this hound hunts, or null for any other sheet.
export function houndQuarryOf(sheet: Bound): string | null {
  const held = sheet.conditions.find((entry) => isConditionNamed(entry, HUNTING));
  return held ? ((sheet.conditionMeta as ConditionMetaMap)[held]?.quarry ?? null) : null;
}

// Why this sheet may not attack that creature: it is a hound, and the
// creature is not its quarry.
export function houndAttackRefusal(sheet: Bound & { name: string }, enemy: { id: string; displayName: string }): ToolError | null {
  const quarry = houndQuarryOf(sheet);
  if (!quarry || quarry === enemy.id) {
    return null;
  }
  const hunted = getEnemy(quarry);
  return {
    error: `${sheet.name} hunts ${hunted?.displayName ?? "its quarry"} and attacks no other creature: ${enemy.displayName} is not its quarry. Nothing was spent.`,
    refused: "rules",
  };
}

// The hounds whose quarry is no longer a living creature of the fight that is
// running (`encounterId`, null out of a fight): it fell, it left, or the fight
// it was hunted in is over.
export function houndsWithoutQuarry<Sheet extends Bound>(sheets: Sheet[], encounterId: string | null): Sheet[] {
  return sheets.filter((sheet) => {
    const quarry = houndQuarryOf(sheet);
    if (quarry === null) {
      return false;
    }
    const hunted = getEnemy(quarry);
    return !hunted || hunted.status !== "alive" || hunted.encounterId !== encounterId;
  });
}
