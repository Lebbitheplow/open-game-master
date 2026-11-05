import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { wakesOnDamage, type ConditionMeta } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import type { EnemyUse } from "@/lib/dm/enemy-casting";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
import { tieToTurn } from "@/lib/dm/turn-tie";

// What a creature's area ability or spell lays on another creature caught in
// it that fails the save: a brass dragon's sleep breath across a charmed
// ally, a mage's Hypnotic Pattern over a crowd of both sides. The character
// side is cast-at-player.ts layEnemyCondition, and this lays what it lays
// with the same lifetimes. Without it a creature caught in a monster's area
// took the damage and none of the conditions.
export function layEnemyUseOnEnemy(
  campaign: Campaign,
  target: EncounterEnemy,
  use: EnemyUse,
  save: { ability: SaveAbility; dc: number },
): { laid: string[]; refused: string[] } {
  const laid: string[] = [];
  const refused: string[] = [];
  if (!use.condition) {
    return { laid, refused };
  }
  const also = use.spellCondition ? (use.spellCondition.also ?? []) : (use.also ?? []);
  const names = [...new Set([use.condition, ...also].map((name) => canonicalCondition(name)))];
  const primary = canonicalCondition(use.condition);
  const sleeps = names.includes("unconscious");
  for (const name of names) {
    const now = getEnemy(target.id) ?? target;
    if (now.status !== "alive") {
      break;
    }
    if (immuneToCondition(now, name)) {
      refused.push(name);
      continue;
    }
    const meta: ConditionMeta = use.spellCondition
      ? spellConditionMeta(
          { ...use.spellCondition, ...use.spellCondition.variantRules?.[name] },
          { spell: use.name, casterId: use.enemy.id, slotLevel: use.slotLevel },
          save,
        )
      : {
          source: use.enemy.id,
          ...(use.untilLongRest ? { untilLongRest: true } : {}),
          ...(!use.untilLongRest && use.rounds ? { rounds: use.rounds } : {}),
          ...(!use.untilLongRest && (use.saveEnds || (!use.rounds && !use.lasting)) ? { saveEnds: save } : {}),
          // The block's own word on damage, on the sleep when it lays one
          // ("poisoned and unconscious ... wakes if it takes damage"), else on
          // all it lays; a sleep with no word wakes when hurt, as one laid by
          // name does (encounter-tools-extra.ts), unless it lasts to a rest.
          ...((use.endsOnDamage && (name === "unconscious" || !sleeps)) || (!use.untilLongRest && wakesOnDamage(name, now.currentHp))
            ? { endsOnDamage: true }
            : {}),
        };
    if (layEnemyConditionInstance(campaign, now, name, meta)) {
      laid.push(name);
      if (use.until && !use.spellCondition && name === primary) {
        tieToTurn(
          campaign,
          { kind: "enemy", id: now.id },
          name,
          use.enemy.id,
          { edge: use.until.edge, turnOf: use.until.whose === "source" ? use.enemy.id : now.id },
          `${name} lasts until the ${use.until.edge} of ${use.until.whose === "source" ? `${use.enemy.displayName}'s` : "its"} next turn`,
        );
      }
    }
  }
  return { laid, refused };
}
