// A rolled damage total landing on an enemy: a parked attack's damage roll
// (physical dice) and a damage roll that names its target, each split by
// type and met by the creature's resistances before applyEnemyDamage lands
// it. Split from enemy-damage.ts, which re-exports it.

import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyHp, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { getDmTurn, type DmTurn, type PendingRoll } from "@/lib/db/dm-turns";
import { landRoll, type StoredRoll } from "@/lib/db/rolls";
import { healthState } from "@/lib/bestiary/health";
import { resistsAllDamage } from "@/lib/dm/condition-logic";
import type { WeaponMaterial } from "@/lib/dm/damage-logic";
import { damageParts, type TypedRider } from "@/lib/dm/damage-parts";
import { applyEnemyDamage, applySheetFoeBlow } from "@/lib/dm/enemy-damage";
import { meetEnemyPart, type EnemyPartFlags } from "@/lib/dm/enemy-defenses";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { enemyHpCap } from "@/lib/dm/monster-abilities";
import { budgetApplies } from "@/lib/dm/action-budget";
import type { ParkedAttack } from "@/lib/dm/pc-attack-riders";
import { storeBudget } from "@/lib/dm/turn-budget";
import { GREAT_WEAPON_MASTER_READY, TAVERN_GRAPPLE_READY } from "@/lib/srd/feat-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// How a parked attack's damage roll is resolved (carried on the pending
// roll's attack context): the magical flag, the dice that ride it under a
// type of their own, and the critical those dice were doubled for.
export type DamageBlow = {
  magical?: boolean;
  // A knockout blow (src/lib/dm/knockout.ts).
  nonlethal?: boolean;
  riders?: TypedRider[];
  crit?: boolean;
  critExtraDice?: number;
  // A silvered or adamantine weapon's material (damage-logic.ts).
  material?: WeaponMaterial;
  // A spell's half damage on a miss (Acid Arrow): half the total, rounded down.
  halfOnMiss?: boolean;
};

// One rolled damage total landing on an enemy. With typed riders the blow is
// split per type (damage-parts.ts) and each part meets the creature's
// resistances on its own, the same way pc_attack's digital path resolves it;
// what is left lands as one wound.
function applyBlow(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  roll: StoredRoll,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType: string | undefined,
  blow: DamageBlow | undefined,
): Record<string, unknown> {
  const amount = Math.max(1, blow?.halfOnMiss ? Math.floor(roll.total / 2) : roll.total);
  const magical = blow?.magical === true;
  const material = blow?.material ?? {};
  const parts =
    blow?.riders?.length && damageType && roll.breakdown?.terms
      ? damageParts(roll.breakdown, damageType, blow.riders, {
          crit: blow.crit === true,
          trailingTerms: blow.crit ? (blow.critExtraDice ?? 0) : 0,
        })
      : [];
  if (parts.length < 2) {
    return applyEnemyDamage(campaign, turn, encounter, enemy, amount, sheets, sheetsById, damageType, {
      magical,
      nonlethal: blow?.nonlethal === true,
      crit: blow?.crit === true,
      ...material,
    });
  }
  return landTypedParts({
    campaign,
    turn,
    encounter,
    enemy,
    parts,
    sheets,
    sheetsById,
    weapon: { magical, ...material },
    nonlethal: blow?.nonlethal === true,
    crit: blow?.crit === true,
  });
}

// A blow of several damage types landing on one creature, the one way every
// path lands it (pc_attack's digital blow, a rolled damage card). A
// character fighting on the foes' side takes each part against its own
// defences (pc-damage.ts). An enemy meets each part on its own, with the
// board's defences as a blow of one type meets them (enemy-defenses.ts:
// Silence, the water, a golem's Absorption, a feature that ignores the
// type's resistance); what is left lands as one wound, and a part a golem
// absorbs heals it once the wound has landed. Only the weapon's own part
// (the first) can be nonmagical, silvered or a good wielder's: a rider is a
// spell's or a feature's dice.
export function landTypedParts(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  enemy: EncounterEnemy;
  parts: Array<{ amount: number; type: string }>;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  weapon: EnemyPartFlags;
  // From a spell, whatever part (Spell Resistance, "damage from spells").
  spell?: boolean;
  nonlethal?: boolean;
  holdVictory?: boolean;
  crit?: boolean;
  concentrationDisadvantage?: boolean;
}): Record<string, unknown> {
  const { campaign, turn, encounter, enemy, parts, sheets, sheetsById, weapon } = input;
  if (isSheetFoe(enemy)) {
    return applySheetFoeBlow(campaign, turn, encounter, enemy, {
      amount: parts.reduce((sum, part) => sum + part.amount, 0),
      parts,
      ...(weapon.magical ? { magical: true } : {}),
      ...(weapon.silvered ? { silvered: true } : {}),
      ...(weapon.adamantine ? { adamantine: true } : {}),
      ...(weapon.goodWielder ? { goodWielder: true } : {}),
      ...(input.spell || weapon.spell ? { spell: true } : {}),
      ...(weapon.ignoreResistanceBy && parts[0]?.type ? { ignoreResistanceTo: parts[0].type } : {}),
      ...(input.crit ? { crit: true } : {}),
      ...(input.nonlethal ? { nonlethal: true } : {}),
    }, sheets, sheetsById, input.holdVictory === true);
  }
  // A creature that resists everything (petrified) is halved once, by
  // applyEnemyDamage, not once per part.
  const resistAll = resistsAllDamage(enemy.conditions);
  const spell = input.spell === true || weapon.spell === true;
  const byType = parts.map((part, index) => ({
    ...part,
    ...meetEnemyPart(
      campaign.id,
      enemy,
      part.amount,
      part.type,
      index === 0 ? { ...weapon, spell, partOfBlow: true } : { magical: true, spell, partOfBlow: true },
    ),
  }));
  const landed = byType.reduce((sum, part) => sum + part.amount, 0);
  const absorbed = byType.reduce((sum, part) => sum + part.absorbed, 0);
  let applied: Record<string, unknown> =
    landed > 0
      ? applyEnemyDamage(campaign, turn, encounter, enemy, landed, sheets, sheetsById, undefined, {
          magical: true,
          ...(input.nonlethal ? { nonlethal: true } : {}),
          ...(input.holdVictory ? { holdVictory: true } : {}),
          ...(input.crit ? { crit: true } : {}),
          // The total lands untyped, so a radiant part says so itself
          // (Undead Fortitude: "unless the damage is radiant").
          ...(byType.some((part) => part.amount > 0 && /radiant/i.test(part.type)) ? { radiant: true } : {}),
          ...(input.concentrationDisadvantage ? { concentrationDisadvantage: true } : {}),
        })
      : {
          ok: true,
          name: enemy.displayName,
          hp: `${enemy.currentHp}/${enemy.maxHp}`,
          health: healthState(enemy.currentHp, enemy.maxHp),
          damageApplied: 0,
        };
  if ("error" in applied) {
    return applied;
  }
  const after = getEnemy(enemy.id);
  if (absorbed > 0 && after && after.status === "alive") {
    const healed = patchEnemyHp(after.id, Math.min(enemyHpCap(after), after.currentHp + absorbed), "alive") ?? after;
    applied = {
      ...applied,
      hp: `${healed.currentHp}/${healed.maxHp}`,
      health: healthState(healed.currentHp, healed.maxHp),
      absorbed: healed.currentHp - after.currentHp,
    };
  }
  return {
    ...applied,
    damageApplied: resistAll ? Math.floor(landed / 2) : landed,
    damageByType: byType.map(
      (part) => `${part.amount} ${part.type || "untyped"}${part.note ? ` (${part.note})` : ""}`,
    ),
  };
}

// A resolved damage roll that names its target: apply it before the model
// even sees the number. Returned payload merges into the roll's tool result.
export function autoApplyDamageRoll(
  campaign: Campaign,
  turn: DmTurn,
  targetEnemyRef: string,
  roll: StoredRoll,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
  blow?: DamageBlow,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { warning: "No active encounter; this damage was not applied to anyone." };
  }
  const enemy = resolveTargetFoe(encounter.campaignId, encounter, targetEnemyRef);
  if (!enemy || enemy.status !== "alive") {
    return {
      warning: `targetEnemyId "${targetEnemyRef}" matched no living enemy; the damage was NOT applied. Call apply_damage with an exact enemyId from GAME STATE.`,
    };
  }
  const result = landRoll(roll.id, enemy.id, () =>
    applyBlow(campaign, turn, encounter, enemy, roll, sheets, sheetsById, damageType, blow),
  );
  if (!("error" in result)) {
    result.note = result.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Do NOT call apply_damage for this hit.`
      : `The server already applied this damage to ${enemy.displayName}. Do NOT call apply_damage for this hit.`;
  }
  return result;
}

// Physical-dice variant, called from the pending-rolls route when a player
// submits a targeted damage roll. Returns the summary the resumed turn
// surfaces to the model (stored in pending_rolls.combat_note).
export function applyPendingDamageRoll(pending: PendingRoll, roll: StoredRoll): string | null {
  if (!pending.targetEnemyId) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const applied = autoApplyDamageRoll(
    campaign,
    turn,
    pending.targetEnemyId,
    roll,
    sheets,
    sheetsById,
    pending.attack?.damageType,
    pending.attack
      ? {
          magical: pending.attack.magical,
          riders: pending.attack.riders,
          crit: pending.attack.crit,
          critExtraDice: pending.attack.critExtraDice,
          nonlethal: (pending.attack as { nonlethal?: boolean }).nonlethal === true,
          material: (pending.attack as { material?: WeaponMaterial }).material,
          halfOnMiss: (pending.attack as { halfOnMiss?: boolean }).halfOnMiss === true,
        }
      : undefined,
  );
  if (typeof applied.warning === "string") {
    return applied.warning;
  }
  if ("error" in applied) {
    return null;
  }
  const byType = Array.isArray(applied.damageByType)
    ? ` (${(applied.damageByType as string[]).join(", ")})`
    : "";
  const halved = (pending.attack as { halfOnMiss?: boolean } | undefined)?.halfOnMiss === true;
  const parts = [
    `The server already applied ${halved ? "half of " : ""}this ${roll.total} damage${byType} to ${String(applied.name)} (now ${
      applied.dead ? "SLAIN" : String(applied.health)
    }).`,
  ];
  if (applied.encounterOver) {
    parts.push(`The encounter ended: ${String(applied.outcome)}. XP was awarded automatically.`);
  }
  // A miss opens nothing a hit's blow does.
  if (halved) {
    parts.push("Do NOT call apply_damage for this miss; narrate from this state.");
    return parts.join(" ");
  }
  parts.push("Do NOT call apply_damage for this hit; narrate from this state.");
  parts.push(...openParkedBonus(campaign.id, pending, applied.dead === true));
  return parts.join(" ");
}

// What a blow on real dice opens once its damage has landed, as rollPcAttack
// does for the server's dice: Great Weapon Master's bonus attack on a critical
// hit or a kill, Tavern Brawler's bonus grapple on a hit. Written on the
// encounter as the blow left it, so a fight the blow ended (no active encounter)
// opens nothing. The turn must be the one the attack was made on, as near as a
// budget tells: a damage roll can land once the turn has passed, even once it
// has come round again.
function openParkedBonus(campaignId: string, pending: PendingRoll, dead: boolean): string[] {
  const attack = pending.attack as ParkedAttack | null;
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (attack?.blowRound === undefined || !encounter || !budgetApplies(budget, pending.characterId ?? "", attack.blowRound)) {
    return [];
  }
  const keys: string[] = [];
  const notes: string[] = [];
  if (attack.opensGreatWeapon && (attack.crit || dead) && !budget.oncePerTurn.includes(GREAT_WEAPON_MASTER_READY)) {
    keys.push(GREAT_WEAPON_MASTER_READY);
    notes.push(`Great Weapon Master: ${attack.crit ? "the critical hit" : "the kill"} opens a bonus-action melee attack this turn (an entry with feature "Great Weapon Master").`);
  }
  if (attack.opensGrapple && !budget.oncePerTurn.includes(TAVERN_GRAPPLE_READY)) {
    keys.push(TAVERN_GRAPPLE_READY);
    notes.push("Tavern Brawler: the hit opens a bonus-action grapple this turn (take_action grapple).");
  }
  if (keys.length) {
    storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, ...keys] });
  }
  return notes;
}
