// An enemy caught by a trap or a hazard: apply_hazard with enemyIds. A trap
// is the same trap whoever steps in it, and a monster saves with its own
// stat block (SRD 5.1, Monsters: Saving Throws): its save proficiencies, its
// conditions, Magic Resistance against a magic trap, Legendary Resistance
// against a binding condition (forced-save.ts rollEnemySave). Before this a
// goblin in the party's hunting trap took the save, the damage and the
// escape DC the GM typed into apply_damage.
//
// The characters' side is trap-run.ts and hazard-tools.ts; the escape from
// a trap's hold is trap-escape.ts, reached through take_action escape.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { canEnemyAct } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { enemyFalls } from "@/lib/dm/enemy-fall";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { mergeAdvantage, rollDerivation, removeConditions, wakesOnDamage, type ConditionMeta } from "@/lib/dm/condition-logic";
import { rollEnemySave, settleFailedSave, type SaveOrigin } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { enemyExhaustion } from "@/lib/dm/monster-abilities";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { dmRoll, rollCard } from "@/lib/dm/roll-card";
import { trapHoldOn } from "@/lib/dm/trap-escape";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { fieldedSheets } from "@/lib/dm/roster";
import { rollOn } from "@/lib/roll-labels";
import { abilityMod } from "@/lib/srd";
import type { TrapSpec } from "@/lib/srd/trap-specs";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The hazards an enemy can be caught in. The rest (air, weather, frigid
// water) are the party's clock and the characters' own sheets.
export const ENEMY_HAZARDS = ["trap", "generic", "falling"] as const;

// The enemies an apply_hazard call names, live in the fight: refused whole
// on a bad id, so nothing is rolled for half a call.
export function enemiesCaught(campaignId: string, refs: string[]): { encounter: Encounter; enemies: EncounterEnemy[] } | ToolError {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return { error: "No active encounter: enemyIds name creatures in a fight. Nothing was rolled.", retry: true };
  }
  const enemies: EncounterEnemy[] = [];
  for (const ref of refs) {
    const enemy = resolveEnemyRef(encounter.id, ref);
    if (!enemy) {
      return unknownEnemyRef(encounter.id, "enemyIds", ref, " Nothing was rolled.");
    }
    if (enemy.status !== "alive") {
      return { error: `${enemy.displayName} is not standing; leave it out of enemyIds. Nothing was rolled.`, retry: true };
    }
    if (!enemies.some((entry) => entry.id === enemy.id)) {
      enemies.push(enemy);
    }
  }
  return { encounter, enemies };
}

type Context = {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
};

// What one trap or hazard does to one enemy, in the order trap-run.ts runs
// it on a character: the attack, the fall, the damage nobody saves against,
// the conditions it lays on everyone, then the save and what a failure
// costs. `lasting`: what a failed save's condition lasts, the trap's own
// time (a Poison Needle's hour, a hunting trap's jaws until broken) or, for
// a hazard of the GM's own, a save at each round's end as a character's
// does through cast_at_player.
export function springOnEnemy(
  ctx: Context,
  start: EncounterEnemy,
  name: string,
  trap: TrapSpec,
  from: { fromX?: number; fromY?: number } = {},
  lasting: "trap" | "saveEnds" = "trap",
): Record<string, unknown> {
  const { campaign, turn, encounter, sheets, sheetsById } = ctx;
  const live = () => getEnemy(start.id) ?? start;
  const up = () => live().status === "alive";
  const lines: string[] = [];
  const row: Record<string, unknown> = { name: start.displayName };
  // A magic trap's harm is magical: "from nonmagical attacks" does not cover
  // it, and Magic Resistance answers its save.
  const magical = trap.kind === "magic";
  const land = (amount: number, type: string) => {
    const applied = applyEnemyDamage(campaign, turn, encounter, live(), amount, sheets, sheetsById, type, magical ? { magical: true } : undefined);
    Object.assign(row, applied, { name: start.displayName });
    return Number(applied.damageApplied ?? amount);
  };
  const lay = (condition: string, meta: ConditionMeta): boolean => {
    const enemy = live();
    // A mechanical trap's hold is no magic (Freedom of Movement).
    if (immuneToCondition(enemy, condition, magical)) {
      lines.push(`${enemy.displayName} is immune to ${condition}.`);
      return false;
    }
    const wakes = wakesOnDamage(canonicalCondition(condition), enemy.currentHp);
    if (!layEnemyConditionInstance(campaign, enemy, condition, { ...meta, ...(wakes ? { endsOnDamage: true } : {}), source: name })) {
      return false;
    }
    lines.push(`${enemy.displayName} is ${condition}.`);
    return true;
  };
  // An attack roll: a natural 1 misses, a natural 20 hits and is critical.
  let crit = false;
  if (trap.attackBonus !== undefined) {
    const ac = enemyAcWithEffects(campaign.id, live());
    const sign = trap.attackBonus >= 0 ? "+" : "-";
    const attack = rollCard(campaign, turn, null, "attack", rollOn(`${name} attacks (vs AC ${ac})`, [start.displayName]), `1d20${sign}${Math.abs(trap.attackBonus)}`, null);
    const hit = attack.crit !== "nat1" && (attack.crit === "nat20" || attack.total >= ac);
    if (!hit) {
      return { name: start.displayName, hit: false, note: `${name} misses ${start.displayName} (${attack.crit === "nat1" ? "a natural 1" : `${attack.total} vs AC ${ac}`}).` };
    }
    crit = attack.crit === "nat20";
    lines.push(`${name} hits ${start.displayName}${crit ? ": a critical hit" : ""}.`);
  }
  if (trap.fallFeet) {
    Object.assign(row, enemyFalls(campaign, turn, encounter, live(), trap.fallFeet, sheets, sheetsById), { name: start.displayName });
  }
  for (const part of trap.hit ?? []) {
    if (!up()) {
      break;
    }
    const dice = crit
      ? critDamageExpression(part.dice, 0, {
          powerfulCritical: campaign.gameSettings?.variantRules?.powerfulCritical,
          multiplyNumeric: campaign.gameSettings?.variantRules?.criticalDamageMods,
        })
      : part.dice;
    const amount = /^\d+$/.test(dice) ? Number(dice) : rollCard(campaign, turn, null, "damage", rollOn(`${name} (${dice} ${part.type})`, [start.displayName]), dice, null).total;
    if (amount > 0) {
      lines.push(`${land(amount, part.type)} ${part.type}.`);
    }
  }
  for (const condition of trap.conditionsAlways ?? []) {
    if (up()) {
      lay(condition, trap.rounds ? { rounds: trap.rounds } : {});
    }
  }
  if (!trap.save || !up()) {
    return { ...row, hit: true, ...(crit ? { crit: true } : {}), note: lines.join(" ") };
  }
  const { ability, dc, halfOnSave } = trap.save;
  const origin: SaveOrigin | undefined = from.fromX !== undefined && from.fromY !== undefined ? { at: { x: from.fromX, y: from.fromY } } : undefined;
  const save = rollEnemySave(campaign.id, live(), ability, dc, {
    magical,
    // A creature with Legendary Resistance spends one on a binding condition.
    resist: Boolean(trap.condition) && bindsWorthResisting([trap.condition ?? ""], false),
    ...(trap.condition ? { against: trap.condition } : {}),
    ...(origin ? { origin } : {}),
    ...(trap.damage ? { damageType: trap.damage.type } : {}),
    record: { turn, detail: `${start.displayName}: ${ability.toUpperCase()} save against ${name}` },
  });
  row.save = save.autoFailed ? `failed outright (${save.notes.join("; ")})` : `${save.total} vs DC ${dc}`;
  row.saved = save.success;
  if (save.legendaryResistance) {
    row.legendaryResistance = `${start.displayName} spends a Legendary Resistance: the failed save becomes a success.`;
  }
  const hpBefore = live().currentHp;
  if (trap.damage && (!save.success || halfOnSave)) {
    const rolled = rollCard(campaign, turn, null, "damage", rollOn(`${name} (${trap.damage.dice} ${trap.damage.type})`, [start.displayName]), trap.damage.dice, null).total;
    const amount = save.success ? Math.floor(rolled / 2) : rolled;
    if (amount > 0) {
      lines.push(`${land(amount, trap.damage.type)} ${trap.damage.type}${save.success ? " (half, on the save)" : ""}.`);
    }
  }
  const laid: string[] = [];
  if (!save.success && trap.condition && up()) {
    const lasts: ConditionMeta = lasting === "saveEnds" ? { saveEnds: { ability, dc } } : trap.rounds ? { rounds: trap.rounds } : {};
    if (lay(trap.condition, lasts)) {
      laid.push(trap.condition);
    }
  }
  // What a failure cost, so legendary_resist can settle it as a success.
  if (!save.success) {
    const lost = Math.max(0, hpBefore - (getEnemy(start.id)?.currentHp ?? hpBefore));
    settleFailedSave(campaign.id, start.id, { conditions: laid, refund: halfOnSave ? lost - Math.floor(lost / 2) : lost });
  }
  return { ...row, hit: true, ...(crit ? { crit: true } : {}), note: lines.join(" ") };
}

// An enemy's ability check from its block: the ability modifier, at
// disadvantage while poisoned or frightened or at a level of exhaustion
// (SRD 5.1, Conditions; Exhaustion). A character fighting the party checks
// as the character it is.
export function rollEnemyAbilityCheck(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy, ability: "str" | "dex", dc: number, detail: string): number {
  const asSheet = isSheetFoe(enemy) ? getSheetById(enemy.id) : null;
  if (asSheet) {
    const check = rollCharacterCheck(campaign, asSheet, { ability, dc }, detail);
    if (check.rollId) {
      turn.rollIds.push(check.rollId);
    }
    return check.autoFailed ? 0 : check.total;
  }
  const worn = enemyExhaustion(enemy.conditions) >= 1;
  const advantage = mergeAdvantage([...rollDerivation(enemy.conditions, "ability_check", ability).sources, ...(worn ? ["disadvantage" as const] : [])]);
  const score = enemy.stats.abilities?.[ability] ?? 10;
  return dmRoll(campaign.id, turn, "ability_check", detail, d20Expression(abilityMod(score), advantage), { roller: "enemy", kind: "check", who: enemy.displayName }).total;
}

// An enemy's action to break a trap's hold (a hunting trap's jaws, a
// falling net), by the trap's own escape: SRD 5.1, Hunting Trap, "A
// creature can use its action to make a DC 13 Strength check, freeing
// itself ... Each failed check deals 1 piercing damage to the trapped
// creature."
export function enemyTrapEscape(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  const hold = trapHoldOn(campaign, enemy);
  if (!encounter || !hold) {
    return { error: `${enemy.displayName} is held by nothing it can break free of.`, retry: true };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  spendEnemyAction(encounter, enemy.id);
  saveEncounter(encounter);
  const total = rollEnemyAbilityCheck(campaign, turn, enemy, hold.ability, hold.dc, `${enemy.displayName}: ${hold.ability.toUpperCase()} check to break free of the ${hold.trap}`);
  const escaped = total >= hold.dc;
  let bitten = 0;
  if (!escaped && hold.hurts) {
    bitten = rollCard(campaign, turn, null, "damage", rollOn(`${hold.trap} (${hold.hurts.dice} ${hold.hurts.type})`, [enemy.displayName]), hold.hurts.dice, null).total;
    if (bitten > 0) {
      // The party, for the XP if the bite ends the fight.
      const party = fieldedSheets(campaign);
      applyEnemyDamage(campaign, turn, encounter, getEnemy(enemy.id) ?? enemy, bitten, party, new Map(party.map((sheet) => [sheet.id, sheet])), hold.hurts.type);
    }
  }
  if (escaped) {
    const fresh = getEnemy(enemy.id) ?? enemy;
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [hold.condition]);
    patchEnemyConditions(fresh.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
  }
  return {
    ok: true,
    action: "escape",
    check: `${total} vs DC ${hold.dc}`,
    success: escaped,
    note: escaped
      ? `${enemy.displayName} breaks free of the ${hold.trap}; it used its action to do it.`
      : `${enemy.displayName} is still ${hold.condition} by the ${hold.trap}${bitten ? `, and takes ${bitten} ${hold.hurts?.type} damage from it` : ""}; its action is spent.`,
  };
}
