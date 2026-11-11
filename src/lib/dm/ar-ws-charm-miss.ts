// Instinctive Charm (School of Enchantment 6) against an attack that missed.
// "When a creature you can see within 30 feet makes an attack roll against
// you, a reaction makes it save ... or target the creature closest to it
// instead, deciding before you know whether the attack hits."
//
// The reaction answered only a hit on record, so the wizard always knew, and
// could never spend it on an attack that would have missed anyway. Ruling
// (the fifth round of the arcane repair): the server resolves an attack in
// one step and cannot hold the roll back from the table, so what it can keep
// of the clause is that the reaction answers the attack ROLL, whichever way it
// went. A missed attack on the wizard is on record as a hit is (last-hit.ts),
// and the reaction takes it: the attacker saves, and on a failure the same
// roll is set against the Armor Class of the creature closest to it. If it
// lands there, the attacker's own damage is rolled now (a miss rolled none),
// as Tipsy Sway's turned miss is (authored-reactions-more.ts redirectMiss).
//
// Called by authored-reactions.ts, the "redirect" reaction with a save.

import { getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { Combatant } from "@/lib/dm/combatant";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { answeredBy, freshLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { settle, type Ctx } from "@/lib/dm/reaction-tools";
import { blowLandsOn } from "@/lib/dm/redirect-target";
import { enemyAttacker, rollCard } from "@/lib/dm/roll-card";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { rollAgainst } from "@/lib/roll-labels";

// The open attack on this character that missed and this reaction has not
// answered, with the swing that missed; null when there is none.
export function missedAttackOn(campaignId: string, characterId: string, key: string): { record: LastHit; index: number } | null {
  const missed = (hit: LastHit) => hit.source === "attack" && !answeredBy(hit, key) && hit.swings.some((swing) => !swing.hit);
  const record = freshLastHit(campaignId, characterId, missed);
  const index = record ? record.swings.findIndex((swing) => !swing.hit) : -1;
  return record && index >= 0 ? { record, index } : null;
}

// Whether the roll that missed the wizard lands on the creature it turns
// onto: a natural 1 misses anyone (SRD 5.1, Rolling 1 or 20).
function meets(campaignId: string, taker: Combatant, swing: SwingRecord): { ac: number; lands: boolean } {
  const against = blowLandsOn(campaignId, taker, swing);
  return { ac: against.ac, lands: swing.natural !== 1 && against.lands };
}

// The attacker's own attack, for the damage a miss never rolled.
function attackOf(record: LastHit, swing: SwingRecord) {
  const attacker = record.attacker.kind === "enemy" && record.attacker.id ? getEnemy(record.attacker.id) : null;
  const name = textKey(swing.attack ?? record.attack);
  const attack = (attacker?.stats.attacks ?? []).find((entry) => textKey(entry.name) === name) ?? null;
  return { attacker, attack: attack?.damage ? attack : null };
}

// Asked before the save is rolled or anything is spent: a turned miss that
// would land needs the attacker's damage, and a creature whose block the
// server does not hold has none on record.
export function turnedMissRefusal(campaignId: string, record: LastHit, index: number, taker: Combatant, feature: string): ToolError | null {
  const swing = record.swings[index];
  if (!meets(campaignId, taker, swing).lands || attackOf(record, swing).attack) {
    return null;
  }
  return { error: `${record.attacker.name}'s ${swing.attack ?? record.attack} missed, and turned onto ${taker.name} it would hit: the server has no damage on record for that attack to roll, so ${feature} cannot turn it. Nothing was spent.`, refused: "rules" };
}

// The attacker failed its save: the missed roll meets the taker's Armor
// Class, and lands the attacker's damage if it hits.
export function landTurnedMiss(ctx: Ctx, encounter: Encounter, found: { record: LastHit; index: number }, taker: Combatant, feature: string, key: string): Record<string, unknown> {
  const { record, index } = found;
  const swing = record.swings[index];
  // Nothing of the miss changes for the wizard; the record keeps the answer.
  settle(ctx, record, record.swings, key);
  const against = meets(ctx.campaign.id, taker, swing);
  const { attacker, attack } = attackOf(record, swing);
  if (!against.lands || !attack) {
    return { applied: `The attack turns onto ${taker.name} and misses them too (${swing.total} against AC ${against.ac}).` };
  }
  const rolled = Math.max(0, rollCard(ctx.campaign, ctx.turn, null, "damage", rollAgainst(`${attack.name} (${feature})`, taker.name), attack.damage!, attacker ? enemyAttacker(attacker) : null).total);
  const type = attack.type ?? record.type;
  const magical = hasTrait(attacker?.stats, "magicWeapons") || attack.magical === true || attack.spellAttack === true;
  const applied =
    rolled < 1
      ? {}
      : taker.kind === "enemy"
        ? applyEnemyDamage(ctx.campaign, ctx.turn, encounter, taker.enemy, rolled, ctx.sheets, ctx.sheetsById, type, magical ? { magical: true } : undefined)
        : applyPcDamage(ctx.campaign, ctx.turn.id, getSheetById(taker.id) ?? taker.sheet, { amount: rolled, type, reason: `${record.attacker.name}'s ${attack.name}, turned by ${feature}` });
  publishEncounter(ctx.campaign.id);
  return {
    rolled: `${attack.damage}: ${rolled}`,
    applied: `The attack that missed ${ctx.sheet.name} turns onto ${taker.name} and hits (${swing.total} against AC ${against.ac}).`,
    redirected: applied,
  };
}
