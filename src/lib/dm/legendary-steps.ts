// The parts of a legendary option the spend itself resolves or names
// (issue 685 audit, 4.G): a check the server rolls, hit points regained, a
// cloud laid around the creature, each checked before the action is spent;
// and, for the rest, the call that makes it, in the model's own tool words.
// legendary-tools.ts handleLegendaryAction is the one caller.

import { dmRoll } from "@/lib/dm/roll-card";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveBoard, getEnemy, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { abilityMod } from "@/lib/bestiary/block-sections";
import { regainBlockedBy } from "@/lib/dm/vitals-logic";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { enemyHpCap } from "@/lib/dm/monster-abilities";
import type { LegendaryStep } from "@/lib/dm/legendary-route-logic";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { ToolError } from "@/lib/dm/tool-errors";

// The roll's modifier for a check the block's numbers make: its skill bonus,
// else the ability's modifier.
function checkBonus(enemy: EncounterEnemy, ability: string, skill: string | null): number {
  const skills = enemy.stats.skills ?? {};
  if (skill && typeof skills[skill] === "number") {
    return skills[skill];
  }
  const score = (enemy.stats.abilities as Record<string, number> | undefined)?.[ability];
  return typeof score === "number" ? abilityMod(score) : 0;
}

const ABILITY_WORD: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

// What keeps an enemy from regaining hit points now (Chill Touch, a mummy
// lord's negative energy), or null.
function enemyRegainBlocked(enemy: EncounterEnemy): string | null {
  return regainBlockedBy({ conditions: enemy.conditions, currentHp: enemy.currentHp });
}

// The steps an option resolves on its own, with nothing more to name: a
// check the server rolls, hit points regained, a cloud laid around it. Each
// is checked before the action is spent (a refusal spends nothing) and made
// once it is.
export type SelfStep = Extract<LegendaryStep, { kind: "check" | "heal" | "cloud" }>;

export function selfStepRefusal(campaign: Campaign, enemy: EncounterEnemy, step: SelfStep, option: string): ToolError | null {
  if (step.kind === "heal") {
    const blocked = enemyRegainBlocked(enemy);
    return blocked ? { error: `${enemy.displayName} cannot regain hit points while ${blocked} holds it. Nothing was spent.`, refused: "rules" } : null;
  }
  if (step.kind === "cloud") {
    const board = getActiveBoard(campaign.id);
    const map = board ? getBattleMapForEncounter(board.id) : null;
    if (!zoneRowFor({ spell: option }) || !map || !getTokenByRef(map.id, enemy.id)) {
      return { error: `${option} is laid around ${enemy.displayName} on the battle map, and it is on none. Nothing was spent.`, retry: true };
    }
  }
  return null;
}

export function resolveSelfStep(campaign: Campaign, turn: DmTurn | null, enemy: EncounterEnemy, step: SelfStep, option: string, dc: number | null): Record<string, unknown> {
  if (step.kind === "check") {
    const bonus = checkBonus(enemy, step.ability, step.skill);
    const what = `${ABILITY_WORD[step.ability] ?? step.ability}${step.skill ? ` (${step.skill.replace(/\b\w/g, (letter) => letter.toUpperCase())})` : ""}`;
    const rolled = dmRoll(campaign.id, turn, step.skill ? "skill_check" : "ability_check", `${enemy.displayName}: ${what} check`, `1d20${bonus >= 0 ? "+" : ""}${bonus}`);
    return { check: `${enemy.displayName}'s ${what} check: ${rolled.total}.` };
  }
  if (step.kind === "heal") {
    const live = getEnemy(enemy.id) ?? enemy;
    const rolled = dmRoll(campaign.id, turn, "custom", `${enemy.displayName}: ${option}`, step.dice).total;
    const healed = Math.min(enemyHpCap(live), live.currentHp + Math.max(0, rolled));
    patchEnemyHp(live.id, healed, "alive");
    return { healed: `${enemy.displayName} regains ${healed - live.currentHp} hit points.` };
  }
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  const laid = placeSpellZone(campaign, { spell: option, caster: { kind: "enemy", id: enemy.id, name: enemy.displayName }, dc, at: token ? { x: token.x, y: token.y } : null });
  return { area: laid ?? `${option} spreads around ${enemy.displayName}.` };
}

// The step the console's card or the AI resolves next, in the model's own
// tool words: one per kind.
export function nextStep(enemy: EncounterEnemy, step: LegendaryStep | undefined): string | null {
  switch (step?.kind) {
    case "attack":
      return `Resolve it now with enemy_attack (enemyId ${enemy.id}, attack "${step.attack}"): one attack.`;
    case "swallow":
      return `Resolve it now with enemy_attack (enemyId ${enemy.id}, attack "${step.attack}") against a ${step.maxSize} or smaller creature it grapples: on a hit the creature is swallowed.`;
    case "save":
      return `Resolve it now with aoe_damage (or cast_at_player for one target) with casterEnemyId ${enemy.id} and enemyAbility "${step.ability}"; the server takes its DC and dice from the block.`;
    case "spell":
      return step.cantrip
        ? `Resolve it now with the cantrip from its list: cast_at_player or aoe_damage with casterEnemyId ${enemy.id} and spell.`
        : `Resolve it now with a spell from its list: cast_at_player or aoe_damage with casterEnemyId ${enemy.id} and spell; the spell's slot is spent as normal.`;
    case "move":
      return `Move it now with move_token (token ${enemy.id}): it goes up to ${step.feet ? `${step.feet} feet` : `${step.fraction < 1 ? "half " : ""}its ${step.mode === "fly" ? "flying " : ""}speed`}${step.provokes ? "" : " without provoking opportunity attacks"}, none of its own turn's movement spent.`;
    case "teleport":
      return `Move it now with teleport_token (token ${enemy.id}) to an open square up to ${step.feet} feet away.`;
    default:
      return null;
  }
}
