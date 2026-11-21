// A drained score on a creature's row (a shadow's Strength Drain striking a
// creature the party dominates, or a turncoat's row), as enemy-hit.ts keeps
// one on a character's sheet: the drain's dice rolled, one condition per
// score with its whole total, and death when the score reaches 0 where the
// block says so. The row's numbers fall with it as every reader reads them
// (creature-drain-logic.ts drainedBlock, through encounters.ts).
//
// A creature's row keeps no rests. A drain that ends on "a short or long
// rest" is held with untilRestEnds, which no rest of the party's reaches on
// a row, and which a later fight does not carry (foe-carry-logic.ts carries
// only a duration or a long rest's mark): it ends with the fight, the
// soonest a rest could come for the creature. One that ends on a long rest
// is carried, as Life Drain's is, until the long rests a later fight's
// clock counts.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyConditions, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import type { ScoreDrain } from "@/lib/bestiary/score-drain-text";
import { isValidExpression } from "@/lib/dice";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { partPair } from "@/lib/dm/enemy-riders";
import { dmRoll } from "@/lib/dm/roll-card";
import { drainConditionName, drainOf } from "@/lib/srd/ability-drain-logic";

export function drainCreature(campaign: Campaign, turn: DmTurn, attacker: EncounterEnemy, targetId: string, attackName: string, drain: ScoreDrain): string | null {
  const target = getEnemy(targetId);
  // The score read here is the row's own while it holds no drain of it; once
  // it does, the first drain's `scoreFrom` is.
  const own = target?.stats.abilities?.[drain.ability];
  if (!target || target.status !== "alive" || !isValidExpression(drain.dice)) {
    return null;
  }
  const rolled = Math.max(0, dmRoll(campaign.id, turn, "custom", `${attacker.displayName}'s ${attackName}: ${drain.ability.toUpperCase()} drained from ${target.displayName}`, drain.dice).total);
  const meta: ConditionMetaMap = { ...(target.conditionMeta as ConditionMetaMap) };
  const before = drainOf(target.conditions, drain.ability);
  const from = before ? meta[before.name]?.scoreFrom : own;
  const kept = before ? target.conditions.filter((name) => name !== before.name) : target.conditions;
  const shortOnly = drain.until === "short" && (!before || meta[before.name]?.untilRestEnds === true);
  if (before) {
    delete meta[before.name];
  }
  const name = drainConditionName(drain.ability, Math.min(30, (before?.total ?? 0) + rolled));
  meta[name] = { source: attacker.id, ...(typeof from === "number" ? { scoreFrom: from } : {}), ...(shortOnly ? { untilRestEnds: true } : { untilLongRest: true }) };
  patchEnemyConditions(target.id, [...kept, name], meta);
  const now = getEnemy(target.id);
  const score = now?.stats.abilities?.[drain.ability];
  const label = drain.ability.toUpperCase();
  // "The target dies if this reduces its Strength to 0": it dies, so
  // nothing that answers a creature dropping to 0 hit points (Undead
  // Fortitude, Relentless) holds it up.
  if (drain.diesAtZero && typeof score === "number" && score <= 0) {
    patchEnemyHp(target.id, 0, "dead");
    // A rider or a mount that dies this way parts from the other half, as a
    // death by damage does (enemy-riders.ts): the survivor gets the token.
    const parted = partPair(campaign, target, true);
    publishEncounter(campaign.id);
    return `${target.displayName}'s ${label} is drained by ${rolled} to 0: it dies.${parted ? ` ${parted}` : ""}`;
  }
  publishEncounter(campaign.id);
  return typeof score === "number"
    ? `${target.displayName}'s ${label} is reduced by ${rolled} (now ${score}): its ${label} saves, checks and attacks feel it ${shortOnly ? "until the fight ends" : "until it finishes a long rest"}.`
    : `${target.displayName}'s ${label} is reduced by ${rolled}; its block keeps no scores, so the GM keeps the count.`;
}
