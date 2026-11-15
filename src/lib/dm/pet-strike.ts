// An enemy's own attack at a character's pet: enemy_attack with targetPet
// (enemy-attack.ts), beside its mount branch. Before this no door rolled a
// creature's attack at a pet on the creature's turn: the GM narrated a hit
// and sent apply_damage with petName and a number, so a paralyzed familiar
// was never struck with advantage nor critically, a dodging companion never
// imposed disadvantage, and a ghoul's claws never paralyzed the wolf they
// hit. Only the walk's opportunity attack (opportunity-pets.ts) rolled one.
//
// SRD 5.1, Conditions (paralyzed: "Attack rolls against the creature have
// advantage. Any attack that hits the creature is a critical hit if the
// attacker is within 5 feet"; prone, restrained, the Dodge), and each
// attack's own rider ("must succeed on a DC 10 Constitution saving throw or
// be paralyzed for 1 minute"). The pet stands in its owner's square (ruling
// D2, pet-place.ts): the reach, the light and the cover are its owner's. Its
// AC, its conditions, its save (pet-save-roll.ts), its damage door
// (pet-tools.ts hurtPet) and the condition a failed save lays
// (pet-condition-lay.ts) are its own.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, isValidExpression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { rollAgainst } from "@/lib/roll-labels";
import { riderSpares, type OnHitRider } from "@/lib/bestiary/attack-text";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { attackSight, enemySenses, fearAsRolled, lightOnAttack, sensesReaching } from "@/lib/dm/attack-light";
import { attackContext, durationArgsFor, mergeAdvantage, type AdvantageState, type ConditionMeta } from "@/lib/dm/condition-logic";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { blowByType } from "@/lib/dm/enemy-hit";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { enemyOpportunityRiders } from "@/lib/dm/opportunity-strike";
import { petCreatureType } from "@/lib/dm/pet-build";
import { layPetCondition } from "@/lib/dm/pet-condition-lay";
import { petDamageShare } from "@/lib/dm/pet-save-logic";
import { rollPetSave } from "@/lib/dm/pet-save-roll";
import { findPet, hurtPet, noPet } from "@/lib/dm/pet-tools";
import { incomingConditionMeta } from "@/lib/dm/set-condition";
import { spendEnemyRiders } from "@/lib/dm/spell-retort";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";

// Refused before anything is spent: no such pet, or one already down.
export function petTargetProblem(owner: CharacterSheet, petName: string): ToolError | null {
  const pet = findPet(owner, petName);
  if (!pet) {
    return noPet(owner, petName);
  }
  return pet.hp > 0 ? null : { error: `${pet.name} is at 0 hit points; strike someone else. Nothing was spent.`, retry: true };
}

const currentPet = (ownerId: string, name: string): SheetPet | null => getSheetById(ownerId)?.pets.find((entry) => entry.name === name) ?? null;

export function strikePet(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounterId: string;
  enemy: EncounterEnemy;
  owner: CharacterSheet;
  petName: string;
  swings: Array<{ attack: EnemyAttack; ranged: boolean } | { attack: EnemyAttack; skipped: string }>;
  distance: number | null;
  cover: number;
  requested: AdvantageState;
}): ToolResult {
  const { campaign, turn, enemy, owner } = input;
  const first = findPet(getSheetById(owner.id) ?? owner, input.petName);
  if (!first) {
    return noPet(owner, input.petName);
  }
  const name = first.name;
  // The pet stands where its owner does: the same light and the same line.
  const sight = attackSight({
    campaignId: campaign.id,
    encounterId: input.encounterId,
    attacker: { refId: enemy.id, senses: enemySenses(enemy) },
    target: { refId: owner.id, senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, devilsSight: 0 } },
  });
  const light = lightOnAttack(sight, { attacker: enemy.displayName, target: name });
  const attackerSenses = sensesReaching(input.encounterId, { refId: enemy.id, senses: enemySenses(enemy) }, { refId: owner.id });
  const own = enemyOpportunityRiders(campaign.id, enemy);
  const rows: Array<Record<string, unknown>> = [];
  for (const swing of input.swings) {
    const pet = currentPet(owner.id, name);
    if (!pet || pet.hp <= 0) {
      break;
    }
    if ("skipped" in swing) {
      rows.push({ attack: swing.attack.name, skipped: swing.skipped });
      continue;
    }
    const { attack, ranged } = swing;
    // Read again each swing: the first claw's paralysis makes the second a
    // critical hit within 5 feet.
    const context = attackContext({
      attackerSenses,
      attackerConditions: fearAsRolled(input.encounterId, enemy.id, enemy.conditions, enemy.conditionMeta),
      targetConditions: pet.conditions ?? [],
      melee: !ranged,
      adjacent: input.distance === null ? !ranged : input.distance <= 1,
      requested: input.requested,
      attackerType: enemy.stats.type,
      targetSeesAttacker: sight?.targetSees !== false,
    });
    const effect = effectOutcome(campaign.id, { kind: "enemy", id: enemy.id }, "attack");
    const advantage = mergeAdvantage([...context.sources, ...light.sources, ...own.sources, ...(effect.advantage ? ["advantage" as const] : []), ...(effect.disadvantage ? ["disadvantage" as const] : [])]);
    const label = rollAgainst(attack.name, pet.name);
    const toHit = rollExpression(`${d20Expression(attack.toHit + effect.bonus, advantage)}${own.riders.diceSuffix}`, undefined, { purpose: { roller: "enemy", kind: "attack", who: enemy.displayName } });
    spendEnemyRiders(enemy, own.riders);
    const hitRoll = insertRoll({ campaignId: campaign.id, characterId: owner.id, requestedBy: "dm", kind: "attack", detail: label, advantage, result: toHit, attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName } });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: hitRoll, source: "digital" });
    turn.rollIds.push(hitRoll.id);
    const ac = pet.ac + input.cover;
    const hit = toHit.crit !== "nat1" && (toHit.crit === "nat20" || toHit.total >= ac);
    if (!hit) {
      rows.push({ attack: attack.name, rolled: toHit.total, vsAc: ac, hit: false, ...(context.notes.length ? { situation: context.notes.join("; ") } : {}) });
      continue;
    }
    const crit = toHit.crit === "nat20" || context.autoCrit;
    const variants = campaign.gameSettings.variantRules;
    const damage = rollExpression(
      crit ? critDamageExpression(attack.damage, 0, { powerfulCritical: variants.powerfulCritical, multiplyNumeric: variants.criticalDamageMods }) : attack.damage,
      undefined,
      { purpose: { roller: "enemy", kind: "damage", who: enemy.displayName } },
    );
    const damageRoll = insertRoll({ campaignId: campaign.id, characterId: owner.id, requestedBy: "dm", kind: "damage", detail: `${label}${crit ? " (CRIT)" : ""}`, result: damage, attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName } });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll: damageRoll, source: "digital" });
    turn.rollIds.push(damageRoll.id);
    const blow = blowByType(attack, damage, crit);
    const magical = hasTrait(enemy.stats, "magicWeapons") || Boolean(attack.magical);
    const { ok: _ok, pet: _name, ...landed } = hurtPet(campaign, getSheetById(owner.id) ?? owner, pet, { parts: blow.parts ?? [{ amount: blow.amount, type: blow.type }], magical });
    void _ok;
    void _name;
    const rider = attack.onHit ? landRider(campaign, turn, owner, enemy, attack, attack.onHit, name) : null;
    rows.push({ attack: attack.name, rolled: toHit.total, vsAc: ac, hit: true, ...(crit ? { crit: true } : {}), ...(context.notes.length ? { situation: context.notes.join("; ") } : {}), ...landed, ...(rider ?? {}) });
  }
  const after = currentPet(owner.id, name);
  return {
    ok: true,
    attack: rows[0]?.attack,
    target: name,
    owner: owner.name,
    swings: rows,
    ...(after ? { petHp: `${after.hp}/${after.maxHp}` } : {}),
    ...(light.notes.length ? { notes: light.notes } : {}),
  };
}

// What the hit carries onto the pet, as enemy-hit.ts lands it on a
// character: the save and its damage, the condition with the rider's own
// count, repeat save, long rest or turn, and a grapple's escape DC. What no
// engine runs on a pet (a drained score, a swallow, a webbing as an object)
// is named for the GM.
function landRider(campaign: Campaign, turn: DmTurn, owner: CharacterSheet, enemy: EncounterEnemy, attack: EnemyAttack, rider: OnHitRider, name: string): Record<string, unknown> | null {
  const pet = currentPet(owner.id, name);
  if (!pet || pet.hp <= 0) {
    return null;
  }
  // "A creature other than an elf or undead" (a ghoul's claws).
  const spared = riderSpares(rider, [petCreatureType(pet)]);
  if (spared) {
    return { rider: `${pet.name} is ${spared}: the ${attack.name}'s rider passes it by.` };
  }
  if (rider.maxSize && pet.size && sizeRank(pet.size) > sizeRank(rider.maxSize)) {
    return { rider: `${pet.name} is too large for the ${attack.name}'s rider (${rider.maxSize} or smaller).` };
  }
  const out: Record<string, unknown> = {};
  let saved = false;
  if (rider.save && rider.dc) {
    const save = rollPetSave(campaign, turn, getSheetById(owner.id) ?? owner, pet, { ability: rider.save, dc: rider.dc, magical: Boolean(attack.magical), source: `${enemy.displayName}'s ${attack.name}` });
    saved = save.success;
    out.riderSave = save.total === null ? `an automatic failure (DC ${rider.dc})` : `${save.total} vs DC ${rider.dc}`;
    out.riderSaved = saved;
  }
  if (rider.damage && isValidExpression(rider.damage)) {
    const share = rider.save && rider.dc ? petDamageShare({ saved, halfOnSave: Boolean(rider.halfOnSave), ability: rider.save, evasion: false }) : "full";
    if (share !== "none") {
      const rolled = rollExpression(rider.damage, undefined, { purpose: { roller: "enemy", kind: "damage", who: enemy.displayName } });
      const roll = insertRoll({ campaignId: campaign.id, characterId: owner.id, requestedBy: "dm", kind: "damage", detail: rollAgainst(`${attack.name} (rider)`, pet.name), result: rolled, attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName } });
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
      turn.rollIds.push(roll.id);
      const amount = share === "half" ? Math.floor(rolled.total / 2) : rolled.total;
      const now = currentPet(owner.id, name);
      if (now && amount > 0) {
        const hurt = hurtPet(campaign, getSheetById(owner.id) ?? owner, now, { parts: [{ amount, type: rider.damageType }], magical: Boolean(attack.magical) });
        out.riderDamage = hurt.damage;
      }
    }
  }
  if (rider.condition && !saved) {
    const laid: string[] = [];
    const refused: string[] = [];
    for (const condition of [rider.condition, ...(rider.alsoCondition ? [rider.alsoCondition] : [])]) {
      const now = currentPet(owner.id, name);
      if (!now || now.hp <= 0) {
        break;
      }
      const lay = layPetCondition(campaign, owner, now, { condition, meta: riderMeta(campaign.id, enemy, owner, now, rider, condition), magical: Boolean(attack.magical), sourceEnemyId: enemy.id });
      if ("error" in lay) {
        refused.push(lay.error);
      } else {
        laid.push(lay.condition);
      }
    }
    if (laid.length) {
      out.riderCondition = laid;
    }
    if (refused.length) {
      out.riderRefused = refused.join(" ");
    }
  }
  const unrun = [
    ...(rider.drainMaxHp ? ["its hit point maximum drain"] : []),
    ...(rider.scoreDrain ? ["its ability score drain"] : []),
    ...(rider.swallow ? ["the swallow"] : []),
    ...(rider.hold ? [`the ${rider.hold.name}'s hold as an object`] : []),
    ...(rider.unconsciousFailBy || rider.unconsciousAtMost ? ["its poison's sleep"] : []),
    ...(rider.manual ?? []),
  ];
  if (unrun.length && !saved) {
    out.riderForGm = `On ${pet.name}, the GM resolves ${unrun.join(", ")}.`;
  }
  return Object.keys(out).length ? out : null;
}

// The instance a rider's condition is laid with on the pet: the rider's own
// count, its repeat save only where the text gives one, a long rest, or the
// turn it lasts until (the pet's turn is its owner's), and a grapple's
// printed escape DC, as enemy-hit.ts writes them on a character.
function riderMeta(campaignId: string, enemy: EncounterEnemy, owner: CharacterSheet, pet: SheetPet, rider: OnHitRider, condition: string): ConditionMeta | undefined {
  if (rider.untilLongRest) {
    return { source: enemy.id, untilLongRest: true };
  }
  let meta = incomingConditionMeta(
    campaignId,
    condition,
    {
      sourceEnemyId: enemy.id,
      ...(rider.rounds ? durationArgsFor(rider.rounds) : {}),
      ...(rider.repeatSave && rider.save && rider.dc ? { saveAbility: rider.save, saveDc: rider.dc } : {}),
    },
    { currentHp: pet.hp },
  );
  if (meta && rider.until) {
    const turnOf = rider.until.whose === "source" ? enemy.id : owner.id;
    const tied: ConditionMeta = rider.until.edge === "end" ? { ...meta, untilTurnEndOf: turnOf } : { ...meta, untilTurnOf: turnOf };
    delete tied.rounds;
    meta = tied;
  }
  if (meta && rider.escapeDc && condition === "grappled") {
    meta = { ...meta, escapeDc: rider.escapeDc };
  }
  return meta;
}
