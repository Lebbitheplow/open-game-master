// The Rune Knight's runes that act off the knight's own turn, before what
// they answer lands (src/lib/srd/authored-effects-w2-mt-fb.ts):
//   - the Stone Rune's charm, laid by its reaction as a creature ends its turn
//     within 30 feet (authored-reactions.ts save_condition): charmed,
//     incapacitated and at speed 0 for a minute, all three held by the one
//     Wisdom save at the end of each of its turns (condition-tick.ts ends
//     them on one roll);
//   - the Storm Rune's prophetic state on a d20 just thrown: "When you or
//     another creature you can see within 60 feet of you makes an attack roll,
//     a saving throw, or an ability check, you can use your reaction to cause
//     the roll to have advantage or disadvantage." A player's roll that waits
//     on its card (after-roll.ts allyChoicesFor) is offered advantage, from the
//     knight's own screen for an ally's roll; an attack that hit the knight or
//     such a creature is the reaction card's disadvantage (authored-reactions.ts
//     disadv_vs_hit with anyAlly).
// The Cloud Rune turns a hit at a stop before its damage: cloud-rune.ts.
//
// Every after-the-roll spend of the prophetic state goes through
// spendPropheticState, which asks the reach and the reaction again.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { rollExpression, type RollResult } from "@/lib/dice";
import { extraD20Expression, withExtraD20, type AfterRollOption } from "@/lib/dm/after-roll-logic";
import { rowWords } from "@/lib/dm/after-roll-table";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { canReactNow } from "@/lib/dm/chronal-shift";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { fateSucceeds, type JudgedRoll } from "@/lib/dm/fate-turn-logic";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import type { Ability } from "@/lib/schemas/abilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const PROPHETIC_STATE = "prophetic state";
export const PROPHETIC_RANGE_FEET = 60;

// The conditions a save-ending reaction lays together (the Stone Rune's
// charm), each from the knight, for the same rounds and the same save, so the
// one roll that ends one ends the rest. Its line for the call's result.
export function layHeldCharm(
  ctx: { campaign: Campaign; sheet: CharacterSheet },
  enemy: EncounterEnemy,
  hold: { names: string[]; rounds?: number; saveEnds?: { ability: Ability; dc: number } },
  failed: string,
): string {
  const meta = { source: ctx.sheet.id, ...(hold.rounds ? { rounds: hold.rounds } : {}), ...(hold.saveEnds ? { saveEnds: hold.saveEnds } : {}) };
  const laid: string[] = [];
  for (const name of hold.names) {
    const fresh = getEnemy(enemy.id) ?? enemy;
    if (immuneToCondition(fresh, name)) continue;
    layEnemyConditionInstance(ctx.campaign, fresh, name, meta);
    laid.push(name);
  }
  publishEncounter(ctx.campaign.id);
  const lasting = hold.rounds ? ` for ${hold.rounds} rounds` : "";
  const ends = hold.saveEnds ? `, saving again on ${hold.saveEnds.ability.toUpperCase()} at the end of each of its turns` : "";
  return `${failed} and is ${laid.join(", ")}${lasting}${ends}.`;
}

// Whether the knight could turn this creature's roll now: in the prophetic
// state with a reaction to take, and the roller themselves or a creature they
// can see within 60 feet. With no fight the fiction decides the reach.
export function inPropheticReach(campaignId: string, knight: CharacterSheet, roller: CharacterSheet): boolean {
  if (!knight.conditions.some((entry) => isConditionNamed(entry, PROPHETIC_STATE)) || !canReactNow(campaignId, knight)) {
    return false;
  }
  if (knight.id === roller.id) {
    return true;
  }
  const encounter = getActiveEncounter(campaignId);
  return !encounter || (withinFeet(encounter.id, knight.id, roller.id, PROPHETIC_RANGE_FEET) && !unseenBecause(encounter.id, knight, roller));
}

// A roll thrown with one d20 and failing as it stands: advantage could carry
// it. One thrown with two already has an edge the reaction would only cancel.
function advantageHelps(roll: JudgedRoll): boolean {
  const lead = roll.outcome.terms[0];
  return Boolean(lead && lead.kind === "dice" && lead.sides === 20 && lead.dice.length === 1) && fateSucceeds(roll) === false;
}

// What the card of this roll offers: the roller's own prophetic state, and
// each of `others` (seats whose players can answer) in one with the roller in reach.
export function propheticChoicesFor(campaignId: string, roller: CharacterSheet, roll: JudgedRoll, others: readonly CharacterSheet[], ownToo: boolean): AfterRollOption[] {
  if (!advantageHelps(roll)) {
    return [];
  }
  // The words are the row's (after-roll-table.ts).
  const kind = "ac" in roll ? "attack" : roll.kind;
  const own: AfterRollOption[] = ownToo && inPropheticReach(campaignId, roller, roller) ? [{ id: "prophetic_state", ...rowWords("prophetic_state", { kind }) }] : [];
  const help = others.flatMap((knight): AfterRollOption[] =>
    knight.id !== roller.id && inPropheticReach(campaignId, knight, roller) ? [{ id: "prophetic_state", by: knight.id, ...rowWords("prophetic_state", { kind, name: roller.name, other: true }) }] : [],
  );
  return [...own, ...help];
}

// The card's choice, paid for and on the dice (after-roll.ts spendAfterRoll):
// the knight's reaction, and one more d20 obeying what the first obeyed, the
// higher kept. Null when it is no longer on offer; nothing is spent then.
export function spendPropheticState(campaign: Campaign, roller: CharacterSheet, outcome: RollResult, payer?: CharacterSheet): { outcome: RollResult; choosing: boolean } | null {
  const knight = payer ?? roller;
  if (!inPropheticReach(campaign.id, knight, roller)) {
    return null;
  }
  const extra = rollExpression(extraD20Expression(outcome.expression)).terms[0];
  const pooled = extra?.kind === "dice" ? withExtraD20(outcome, extra.dice[0]) : null;
  if (!pooled) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    markReactionUsed(encounter, knight.id);
  }
  return { outcome: pooled, choosing: false };
}
