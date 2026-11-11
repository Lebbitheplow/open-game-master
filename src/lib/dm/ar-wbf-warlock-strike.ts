// What a granted attack's hit leaves on the creature it struck, beyond its
// damage: Tentacle of the Deeps, "the target's speed drops by 10 feet until
// the start of your next turn". The attack's row names the condition
// (GrantedAttack.leaves, src/lib/srd/condition-effects.ts), whose own row
// holds the number, so the engines that read conditions (an enemy's speed,
// the board's reach) hold it; this file lays it.
//
// Called by src/lib/dm/attack-blow.ts where every hit leaves its marks. A
// granted attack that slows, blinds or otherwise marks its target declares
// `leaves` on its row and needs nothing more here.
import { patchEnemyConditions } from "@/lib/db/encounters";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { getFoe } from "@/lib/dm/sheet-foe";
import { grantedAttackFor } from "@/lib/srd/granted-attacks";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The note for the roll, or null when the attack leaves nothing or the
// creature is gone. The mark ends as the attacker's next turn starts.
export function grantedStrikeMark(sheet: Pick<CharacterSheet, "id" | "name" | "conditions">, enemy: { id: string; displayName: string }, weapon: string): string | null {
  const granted = grantedAttackFor(sheet.conditions, weapon, "");
  const mark = granted?.attack.leaves;
  if (!granted || !mark) {
    return null;
  }
  const fresh = getFoe(enemy.id);
  if (!fresh || fresh.status !== "alive") {
    return null;
  }
  if (!fresh.conditions.includes(mark)) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, mark], { ...(fresh.conditionMeta as ConditionMetaMap), [mark]: { source: sheet.id, untilTurnOf: sheet.id } });
  }
  return `${granted.attack.name}: ${enemy.displayName} is ${mark} until the start of ${sheet.name}'s next turn`;
}
