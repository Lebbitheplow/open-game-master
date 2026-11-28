// What a stat block's hit carries when it lands on another creature's row
// (issue 503, enemy-strike.ts): the rider the attack prints (a save or be
// knocked prone, poison halved on a save, a grapple with its escape DC, Life
// Drain), resolved as enemy-hit.ts resolveOnHit resolves it on a character,
// with the struck creature's own save (forced-save.ts rollEnemySave) and its
// own damage path (enemy-damage.ts applyEnemyDamage). Being swallowed whole
// and what the block leaves to the DM are named for the DM to resolve.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, patchEnemyHp, shiftEnemyMaxHp, type EncounterEnemy } from "@/lib/db/encounters";
import { recordRoll } from "@/lib/dm/roll-record";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { asleepOnFailure, riderSpares } from "@/lib/bestiary/attack-text";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { isValidExpression, rollExpression } from "@/lib/dice";
import { actionParts, foeTarget, riderNote } from "@/lib/roll-parts";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { enemyHpCap } from "@/lib/dm/monster-abilities";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { swallowCreature } from "@/lib/dm/swallow";
import { swallowRuleOf } from "@/lib/dm/swallow-logic";
import { allyCreatureConditionAura } from "@/lib/dm/aura";
import { drainCreature } from "@/lib/dm/creature-drain";

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
  // "A creature other than an elf or undead" (a ghoul's claws): a zombie it
  // claws is not paralyzed.
  // Its type and the subtype in brackets: "undead", "humanoid (elf)".
  const type = target.stats.type ?? "";
  const spared = riderSpares(rider, [type.replace(/\s*\(.*$/, ""), ...(/\(([^)]*)\)/.exec(type)?.[1].split(/\s*,\s*/) ?? [])]);
  if (spared) {
    return { rider: `${attack.name}'s rider passes over ${target.displayName} (${spared}): its text spares that kind of creature.` };
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
    recordRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      parts: actionParts(attack, foeTarget(target), riderNote(rider.damageType)),
      result: outcome,
      attacker: { kind: "enemy", id: attacker.id, name: attacker.displayName },
      turn,
      // Thrown here, on the server's dice.
      landing: null,
    });
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
    // Its own immunities, a petrified creature's to poison, and a spell's on
    // it; a creature's grip or web is no magic (Freedom of Movement).
    if (immuneToCondition(now, condition, attack.spellAttack === true)) {
      out.riderRefused = `${now.displayName} cannot be ${condition}.`;
      continue;
    }
    // A paladin's Aura of Courage or Devotion over a creature fighting for
    // the party (aura.ts).
    const shielded = allyCreatureConditionAura(campaign.id, now, condition);
    if (shielded) {
      out.riderRefused = `${shielded} keeps ${condition} off ${now.displayName}.`;
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
        // A giant spider's webbing: its escape and its numbers (creature-hold.ts).
        ...(condition === "restrained" && rider.hold ? { hold: rider.hold } : {}),
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
  // A drained score (a shadow's Strength Drain), as on a character
  // (enemy-hit.ts): creature-drain.ts.
  if (rider.scoreDrain && !saved) {
    const drained = drainCreature(campaign, turn, attacker, targetId, attack.name, rider.scoreDrain);
    if (drained) {
      out.scoreDrained = drained;
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
  // A creature's disease runs on no sheet: its poisoning holds (above), and
  // its daily save is the GM's.
  if (rider.disease && !saved) {
    out.disease = `${target.displayName} is poisoned until the disease is cured; on a creature its save every 24 hours (${rider.disease.dice} off the maximum on a failure) is the GM's.`;
  }
  if (rider.manual?.length) {
    out.manual = `The server does not model this part of ${attack.name}; resolve it by hand: ${rider.manual.join(" ")}`;
  }
  return Object.keys(out).length ? out : null;
}
