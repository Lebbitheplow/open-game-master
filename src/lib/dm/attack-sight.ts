// What sight does to a player character's attack roll against one creature,
// as pc_attack reads it: who sees whom on the lit board (magical darkness
// included), blindsight or truesight past an invisible side, Feral Senses
// (an unseen target costs a level 18 ranger nothing), and a fear whose source
// is out of sight. pc-attack-situation.ts attackSituation reads it for the
// roll, and the board view's edges (src/lib/battlemap/view-tactics.ts) send
// it to the Hand, so the hit preview carries the advantage the roll gets.
// Anything that decides sight for a player's attack goes through here: the
// preview used to read the conditions alone, and in magical darkness showed
// one d20's odds where the roll had two.
//
// Server side: the board and the clock are read.
import { attackSenses, attackSight, characterSenses, enemySenses, fearAsRolled, lightOnAttack, type Sight } from "@/lib/dm/attack-light";
import { hasFeralSenses, seenTargetConditions } from "@/lib/dm/attack-features";
import type { PastSight } from "@/lib/dm/condition-logic";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type AttackSightVerdict = {
  sight: Sight | null;
  senses: { attackerSenses: PastSight; targetSenses: PastSight };
  // The light's own sources (an unseen target, an attacker unseen), after
  // Feral Senses.
  light: Array<"advantage" | "disadvantage">;
  // The conditions on each side as the roll reads them.
  attackerConditions: string[];
  targetConditions: string[];
  notes: string[];
};

export function attackSightVerdict(input: {
  campaignId: string;
  encounterId: string;
  sheet: CharacterSheet;
  enemy: Pick<EncounterEnemy, "id" | "displayName" | "conditions" | "stats">;
}): AttackSightVerdict {
  const { sheet, enemy } = input;
  const feral = hasFeralSenses(sheet);
  const attacker = { refId: sheet.id, senses: characterSenses(sheet) };
  const target = { refId: enemy.id, senses: enemySenses(enemy) };
  const sight = attackSight({ campaignId: input.campaignId, encounterId: input.encounterId, attacker, target });
  const light = lightOnAttack(sight && feral ? { ...sight, attackerSees: true } : sight, {
    attacker: sheet.name,
    target: enemy.displayName,
  });
  const notes: string[] = [];
  if (feral && ((sight !== null && !sight.attackerSees) || enemy.conditions.some((entry) => /^(invisible|hidden)$/i.test(entry.trim())))) {
    notes.push("Feral Senses: not seeing the target costs no disadvantage");
  }
  notes.push(...light.notes);
  return {
    sight,
    senses: attackSenses(input.encounterId, attacker, target),
    light: light.sources,
    // Frightened weighs on the roll only with its source in sight.
    attackerConditions: fearAsRolled(input.encounterId, sheet.id, sheet.conditions, sheet.conditionMeta),
    targetConditions: seenTargetConditions(sheet, enemy.conditions),
    notes,
  };
}
