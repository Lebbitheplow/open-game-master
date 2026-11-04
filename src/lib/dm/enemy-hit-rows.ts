// What a stat block's hit carries when it lands on another creature's row
// (issue 503, enemy-strike.ts): the rider the attack prints (a save or be
// knocked prone, poison halved on a save, a grapple with its escape DC, Life
// Drain), resolved as enemy-hit.ts resolveOnHit resolves it on a character,
// with the struck creature's own save (forced-save.ts rollEnemySave) and its
// own damage path (enemy-damage.ts applyEnemyDamage). Being swallowed whole
// and what the block leaves to the DM are named for the DM to resolve.

import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, patchEnemyHp, shiftEnemyMaxHp, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { asleepOnFailure } from "@/lib/bestiary/attack-text";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { isValidExpression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollAgainst } from "@/lib/roll-labels";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { enemyHpCap } from "@/lib/dm/monster-abilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { swallowCreature } from "@/lib/dm/swallow";
import { swallowRuleOf } from "@/lib/dm/swallow-logic";

type Sheets = { sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> };

export function resolveRowOnHit(
  campaign: Campaign,
  turn: DmTurn,
  attacker: EncounterEnemy,
  attack: EnemyAttack,
  targetId: string,
  { sheets, sheetsById, dealt }: Sheets & { dealt: { total: number; necrotic: number } },
): Record<string, unknown> | null {
  const rider = attack.onHit;
  const target = getEnemy(targetId);
  const encounter = getActiveEncounter(campaign.id);
  if (!rider || !target || !encounter || target.status !== "alive" || target.currentHp <= 0) {
    return null;
  }
  if (rider.maxSize && sizeRank(target.stats.size ?? "medium") > sizeRank(rider.maxSize)) {
    return { rider: `${target.displayName} is too large for ${attack.name}'s rider.` };
  }
  const out: Record<string, unknown> = {};
  let saved = false;
  let saveTotal: number | null = null;
  if (rider.save && rider.dc) {
    const save = rollEnemySave(campaign.id, target, rider.save, rider.dc, {
      record: { turn, detail: `${target.displayName}: ${rider.save.toUpperCase()} save vs ${attacker.displayName}'s ${attack.name}` },
      // Cover between the attacker and the target counts on a DEX rider.
      origin: { ref: attacker.id },
    });
    saved = save.success;
    saveTotal = save.total;
    out.riderSave = `${save.total ?? "failed automatically"} vs DC ${rider.dc}`;
    out.riderSaved = saved;
  }
  if (rider.damage && isValidExpression(rider.damage)) {
    const outcome = rollExpression(rider.damage);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(`${attack.name} (${rider.damageType ?? "rider"})`, target.displayName),
      result: outcome,
      attacker: { kind: "enemy", id: attacker.id, name: attacker.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
    turn.rollIds.push(roll.id);
    const amount = saved ? (rider.halfOnSave ? Math.floor(outcome.total / 2) : 0) : outcome.total;
    out.riderDamage = amount;
    if (amount > 0) {
      applyEnemyDamage(campaign, turn, encounter, getEnemy(targetId) ?? target, amount, sheets, sheetsById, rider.damageType, { holdVictory: true });
    }
  }
  // A poison's sleep on a bad enough save, as on a character (enemy-hit.ts).
  const asleep = Boolean(rider.save && rider.dc) && asleepOnFailure(rider, saveTotal);
  const conditions = rider.condition && !saved ? [rider.condition, ...(rider.alsoCondition ? [rider.alsoCondition] : []), ...(asleep ? ["unconscious"] : [])] : [];
  for (const condition of conditions) {
    const now = getEnemy(targetId);
    if (!now || now.status !== "alive" || (now.currentHp <= 0 && condition === "prone")) {
      continue;
    }
    // Its own immunities, and a petrified creature's to poison.
    if (immuneToCondition(now, condition)) {
      out.riderRefused = `${now.displayName} cannot be ${condition}.`;
      continue;
    }
    const meta: ConditionMetaMap = {
      ...(now.conditionMeta as ConditionMetaMap),
      [condition]: {
        source: attacker.id,
        ...(rider.rounds ? { rounds: rider.rounds } : {}),
        ...(rider.repeatSave && rider.save && rider.dc ? { saveEnds: { ability: rider.save, dc: rider.dc } } : {}),
        ...(rider.untilLongRest ? { untilLongRest: true } : {}),
        ...(condition === "grappled" && rider.escapeDc ? { escapeDc: rider.escapeDc } : {}),
        ...(condition === "unconscious" && rider.wakesOnDamage ? { endsOnDamage: true } : {}),
      },
    };
    const held = now.conditions.some((entry) => isConditionNamed(entry, condition));
    patchEnemyConditions(now.id, held ? now.conditions : [...now.conditions, condition], meta);
    out.riderCondition = [...((out.riderCondition as string[] | undefined) ?? []), condition];
  }
  if (rider.escapeDc && ((out.riderCondition as string[] | undefined) ?? []).includes("grappled")) {
    out.escapeDc = rider.escapeDc;
  }
  // Life Drain on a stat block: its maximum falls by the drained part.
  if (rider.drainMaxHp && !saved) {
    const amount = rider.drainMaxHp === "necrotic" ? dealt.necrotic : dealt.total;
    const drained = amount > 0 ? shiftEnemyMaxHp(targetId, -amount) : null;
    if (drained) {
      out.maxHpDrained = `${drained.displayName}'s hit point maximum is reduced by ${amount} (now ${drained.maxHp}).`;
      if (rider.drainHeals) {
        const self = getEnemy(attacker.id);
        if (self && self.status === "alive") {
          const healed = Math.min(enemyHpCap(self), self.currentHp + amount);
          patchEnemyHp(self.id, healed, "alive");
          out.drainHealed = `${attacker.displayName} regains ${healed - self.currentHp} hit points.`;
        }
      }
    }
  }
  // Swallowed whole, as a character is (swallow.ts).
  if (rider.swallow && !saved) {
    const swallowed = swallowCreature(campaign, turn.id, attacker, { kind: "enemy", id: target.id }, swallowRuleOf(attacker.stats, attack.name));
    if ("swallowed" in swallowed) {
      out.swallowed = swallowed.swallowed;
    } else {
      out.notSwallowed = swallowed.notSwallowed;
    }
  }
  if (rider.manual?.length) {
    out.manual = `The server does not model this part of ${attack.name}; resolve it by hand: ${rider.manual.join(" ")}`;
  }
  return Object.keys(out).length ? out : null;
}
