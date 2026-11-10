// What a player's attack deals: the dice its riders fold into the damage
// expression (Rage, effect conditions, feature riders, lasting effects,
// Sneak Attack), the once-per-turn riders the turn budget takes back, the
// critical and reroll rules the damage roll carries, and a landed blow
// resolved per damage type (src/lib/dm/damage-parts.ts). Split from
// pc-attack.ts, which decides and rolls the attack these dice belong to.
// Nothing here refuses the attack.

import { pactWeaponAttack } from "@/lib/srd/pact-weapon";
import { getFoe } from "@/lib/dm/sheet-foe";
import { poisonerIgnoresResistance } from "@/lib/srd/feat-combat";
import type { Advantage, RollResult } from "@/lib/dice";
import { claimOncePerTurn, type TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { damageParts, type TypedRider } from "@/lib/dm/damage-parts";
import type { BlowSource } from "@/lib/dm/damage-logic";
import { effectOutcome } from "@/lib/dm/effect-tools";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { authoredSneakEdge } from "@/lib/dm/authored-hooks";
import { authoredSneakBonus } from "@/lib/srd/authored-effects-more";
import { getSheetById } from "@/lib/db/sheets";
import { applyEnemyDamage, applySheetFoeBlow } from "@/lib/dm/enemy-damage";
import { landTypedParts } from "@/lib/dm/enemy-blow";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { allyAdjacentToEnemy } from "@/lib/dm/map-tools";
import { storeBudget } from "@/lib/dm/turn-budget";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { OnHitSpends } from "@/lib/dm/pc-attack-riders";
import { attackDamageRiders, type FeatureRider } from "@/lib/dm/attack-damage-riders";
import { cursedAgainst } from "@/lib/srd/magic-items";
import { conditionStrikesMagical } from "@/lib/srd/condition-effect-queries";
import { effectsFor, type CombatRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isNamed } from "@/lib/srd/feature-names";
import { alignmentIs } from "@/lib/srd/alignment";

export type { FeatureRider } from "@/lib/dm/attack-damage-riders";

// The riders that fold into the damage expression before anything is
// rolled, and the lasting effects on the attack and damage rolls.
export function foldDamageRiders(input: {
  campaignId: string;
  sheet: CharacterSheet;
  profile: AttackProfile;
  riders: CombatRiders;
  kind: AttackKind;
  // The target, for the riders that read it (Colossus Slayer, Demon
  // Armor's curse).
  enemy?: Pick<EncounterEnemy, "currentHp" | "maxHp"> & { stats?: { type?: string } };
  // The marking conditions (Hunter's Mark, Hex) whose die rides a hit on
  // this target (src/lib/dm/attack-marks.ts). Absent: every one does.
  marked?: Set<string>;
}) {
  const { campaignId, sheet } = input;
  let profile = input.profile;

  // Rage, an ability a feature adds (Aura of Hate), the dice a held
  // condition rides on a hit (Hex, Divine Favor) and the features' damage
  // riders (Divine Strike, Improved Divine Smite, Divine Fury), read by
  // attack-damage-riders.ts, which the Hand's attack cards print from too.
  // The server folds them into the damage dice so both the digital and
  // physical-dice paths carry them.
  const { rageBonus, abilityRiders, onHit, featureRiders } = attackDamageRiders(input);
  if (rageBonus) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${rageBonus}`,
    };
  }
  for (const rider of abilityRiders) {
    profile = { ...profile, damageExpression: `${profile.damageExpression}+${rider.amount}`, riderNotes: [...profile.riderNotes, `${rider.feature}: +${rider.amount} damage`] };
  }
  if (onHit.suffix) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}${onHit.suffix}`,
    };
  }
  for (const rider of featureRiders) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${rider.dice}`,
    };
  }
  // The dice that ride this attack under a damage type of their own, so the
  // hit can be resolved per type (src/lib/dm/damage-parts.ts).
  const typedRiders: TypedRider[] = [
    ...onHit.typed,
    ...featureRiders.filter((rider) => rider.type).map(({ dice, type }) => ({ dice, type })),
  ];

  // Lasting effects on the attacker's attack and damage rolls (set_effect).
  let attackEffect = effectOutcome(campaignId, { kind: "character", id: sheet.id }, "attack");
  // A cursed item worn against the creature its curse names (Demon Armor):
  // folded here so the turn's swing and the reaction's both roll it.
  const curse = cursedAgainst(sheet.equipment, input.enemy?.stats?.type);
  if (curse) {
    attackEffect = { ...attackEffect, disadvantage: true, sources: [...attackEffect.sources, curse] };
  }
  const damageEffect = effectOutcome(campaignId, { kind: "character", id: sheet.id }, "damage");
  if (attackEffect.bonus) {
    profile = { ...profile, toHit: profile.toHit + attackEffect.bonus };
  }
  if (damageEffect.bonus) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}${damageEffect.bonus > 0 ? "+" : "-"}${Math.abs(damageEffect.bonus)}`,
    };
  }
  return {
    profile,
    rageBonus,
    onHitNotes: onHit.notes,
    // Conditions the first hit uses up (the smites).
    hitSpent: onHit.hitSpent,
    featureRiders,
    typedRiders,
    attackEffect,
    damageEffect,
  };
}

// Sneak Attack, decided once the final advantage state is known: a finesse
// or ranged attack made with advantage, or with an ally adjacent to the
// target and no disadvantage. Once per turn is enforced by the turn budget
// (claimOncePerTurnRiders); the dice ride the damage roll.
export function withSneakAttack(input: {
  encounterId: string;
  sheetId: string;
  enemyId: string;
  profile: AttackProfile;
  riders: CombatRiders;
  advantage: Advantage;
  notes: string[];
}): { sneak: boolean; profile: AttackProfile; dice: number } {
  const { riders, advantage } = input;
  let profile = input.profile;
  const sneak =
    riders.sneakAttackDice > 0 &&
    profile.sneakEligible &&
    advantage !== "disadvantage" &&
    (advantage === "advantage" ||
      allyAdjacentToEnemy(input.encounterId, input.sheetId, input.enemyId) ||
      // Insightful Fighting, Rakish Audacity (authored-hooks.ts).
      authoredSneakEdge(input.encounterId, input.sheetId, input.enemyId) !== null);
  // Eye for Weakness: 3d6 more against the creature the rogue read. The
  // extra dice are one term with Sneak Attack's, so the once-a-turn claim
  // (claimOncePerTurnRiders) takes them back together.
  const bonus = sneak ? sneakBonusAgainst(input.sheetId, input.enemyId) : null;
  const dice = riders.sneakAttackDice + (bonus?.dice ?? 0);
  if (sneak) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${dice}d6`,
    };
    input.notes.push(`Sneak Attack: +${dice}d6${bonus ? ` (${bonus.feature}: +${bonus.dice}d6)` : ""}`);
  }
  return { sneak, profile, dice };
}

function sneakBonusAgainst(sheetId: string, enemyId: string): { dice: number; feature: string } | null {
  const sheet = getSheetById(sheetId);
  const enemy = getFoe(enemyId);
  if (!sheet || !enemy) {
    return null;
  }
  const meta = enemy.conditionMeta as Record<string, { source?: string } | undefined>;
  return authoredSneakBonus(sheet, sheet.id, enemy.conditions.map((condition) => ({ condition, source: meta[condition]?.source })));
}

// The once-per-turn damage riders: a rider already used this turn leaves the
// expression, its note says so, and its dice are listed so the typed riders
// drop them too. One still free rides this attack and is spent only by a
// hit (`hitClaims`, claimed by claimHitRiders): a miss keeps Sneak Attack
// for the next swing of the turn (SRD 5.1).
export function claimOncePerTurnRiders(input: {
  budget: TurnBudget;
  profile: AttackProfile;
  notes: string[];
  sneak: boolean;
  sneakAttackDice: number;
  featureRiders: FeatureRider[];
}): { profile: AttackProfile; notes: string[]; droppedRiders: string[]; hitClaims: string[] } {
  const { budget } = input;
  let { profile, notes } = input;
  const droppedRiders: string[] = [];
  const hitClaims: string[] = [];
  if (input.sneak) {
    // Sneak Attack is once per turn however many swings land.
    const claimed = claimOncePerTurn(budget, "sneak_attack");
    if (!claimed) {
      profile = {
        ...profile,
        damageExpression: profile.damageExpression.replace(
          `+${input.sneakAttackDice}d6`,
          "",
        ),
      };
      notes = notes.filter(
        (note) => !note.startsWith("Sneak Attack"),
      );
      notes.push("Sneak Attack already used this turn: no extra dice");
    } else {
      hitClaims.push("sneak_attack");
    }
  }
  // Once-per-turn feature riders (Divine Strike) spend their turn slot the
  // same way.
  for (const rider of input.featureRiders) {
    if (!rider.oncePerTurn) {
      continue;
    }
    const key = `rider:${rider.feature.toLowerCase()}`;
    const claimed = claimOncePerTurn(budget, key);
    if (!claimed) {
      profile = {
        ...profile,
        damageExpression: profile.damageExpression.replace(`+${rider.dice}`, ""),
      };
      droppedRiders.push(rider.dice);
      notes = notes.filter(
        (note) => !note.startsWith(`${rider.feature}:`),
      );
      notes.push(`${rider.feature} already used this turn: no extra dice`);
    } else {
      hitClaims.push(key);
    }
  }
  return { profile, notes, droppedRiders, hitClaims };
}

// A hit spends the once-per-turn riders it carried, on the stored turn.
export function claimHitRiders(encounter: Encounter, budget: TurnBudget | null, keys: string[] | undefined) {
  if (!budget || !keys?.length) {
    return;
  }
  for (const key of keys) {
    if (!budget.oncePerTurn.includes(key)) {
      budget.oncePerTurn.push(key);
    }
  }
  storeBudget(encounter, budget);
}

// What the damage roll carries once the attack is paid for: the reroll and
// critical rules, and the spends that wait for the hit.
export function strikeDamage(plan: AttackPlan) {
  const { campaign, sheet, profile, riders, context } = plan;
  // Great Weapon Fighting rerolls 1s and 2s, but only on the two-handed
  // melee swing it is written for.
  const rerollBelow =
    riders.greatWeaponRerollBelow && profile.twoHanded && !profile.ranged
      ? riders.greatWeaponRerollBelow
      : 0;
  if (rerollBelow) {
    context.notes.push(`Great Weapon Fighting: rerolling damage dice of ${rerollBelow} or less`);
  }
  // Savage Attacks and Brutal Critical are written for a melee weapon
  // attack: a bow and a spell roll the plain critical.
  const critExtraDice = plan.weaponAttack && !plan.atRange ? riders.critExtraDice : 0;
  const critOptions = {
    powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
    multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
  };
  const onHitSpends: OnHitSpends = {
    characterId: sheet.id,
    ...(plan.smite ? { smite: plan.smite } : {}),
    ...(plan.maneuver && !plan.maneuver.precision
      ? { maneuver: { name: plan.maneuver.name, die: plan.maneuver.die, use: plan.maneuver.use, targetId: plan.enemy.id } }
      : {}),
    ...(plan.options.stunningStrike ? { stun: plan.options.stunningStrike } : {}),
    baseDamage: profile.damageExpression,
    critExtraDice,
  };
  const hasOnHit = Boolean(onHitSpends.smite || onHitSpends.maneuver || onHitSpends.stun);
  return { rerollBelow, critExtraDice, critOptions, onHitSpends, hasOnHit };
}

// A spell, a magic weapon and strikes that count as magical pass
// resistance to nonmagical attacks.
export function strikesAsMagic(plan: Pick<AttackPlan, "kind" | "profile" | "riders" | "sheet">): boolean {
  return (
    plan.kind === "spell" ||
    plan.kind === "granted" ||
    plan.profile.magicBonus > 0 ||
    plan.profile.magicWeapon === true ||
    // Magic Weapon and Shillelagh make the weapon itself magical.
    (plan.kind === "weapon" && conditionStrikesMagical(plan.sheet.conditions)) ||
    // A pact weapon "counts as magical" (SRD 5.1, Pact of the Blade).
    pactWeaponAttack(plan.sheet, plan.kind, plan.profile) ||
    magicalStrikeApplies(plan)
  );
}

// Strikes that count as magical, each within its own scope: Ki-Empowered
// Strikes covers a monk's unarmed strikes and Primal Strike a beast form's
// natural attacks (SRD 5.1); an authored "your attacks count as magical"
// covers every weapon attack.
function magicalStrikeApplies(plan: Pick<AttackPlan, "kind" | "profile" | "riders" | "sheet">): boolean {
  if (!plan.riders.magicalAttacks) {
    return false;
  }
  return effectsFor(plan.sheet)
    .filter(({ effect }) => effect.kind === "magical_attacks")
    .some(({ feature }) => {
      if (isNamed(feature, "Ki-Empowered Strikes")) {
        return plan.profile.unarmed === true;
      }
      if (isNamed(feature, "Primal Strike")) {
        return plan.kind === "natural";
      }
      return true;
    });
}

// The typed riders still on the expression: each once-per-turn rider the
// turn budget dropped takes one matching entry out.
export function liveTypedRiders(typedRiders: TypedRider[], droppedRiders: string[]): TypedRider[] {
  const unspent = [...droppedRiders];
  return typedRiders.filter((rider) => {
    const at = unspent.indexOf(rider.dice);
    if (at < 0) {
      return true;
    }
    unspent.splice(at, 1);
    return false;
  });
}

// A landed blow meets the target's resistances and lands. One damage type
// goes straight through applyEnemyDamage; two or more are resolved per type.
export function applyHitDamage(input: {
  plan: AttackPlan;
  typedRiders: TypedRider[];
  damageOutcome: RollResult;
  dealt: number;
  crit: boolean;
  critExtraDice: number;
}): Record<string, unknown> {
  const { plan } = input;
  return landBlow({
    ...input,
    campaign: plan.campaign,
    turn: plan.turn,
    encounter: plan.encounter,
    enemy: plan.enemy,
    sheets: plan.sheets,
    sheetsById: plan.sheetsById,
    profile: plan.profile,
    typedRiders: liveTypedRiders(input.typedRiders, plan.droppedRiders),
    magical: strikesAsMagic(plan),
    nonlethal: plan.options.nonlethal,
    ignoreResistance: plan.elementalAdept || poisonerIgnoresResistance(plan.sheet, plan.profile.damageType),
    ignoreResistanceBy: plan.elementalAdept ? "Elemental Adept" : "Poisoner",
    adeptOthers: plan.adeptOthers,
    concentrationDisadvantage: plan.mageSlayer,
    blow: blowSource(plan),
  });
}

// A spell attack is a spell's damage; a weapon in a good character's hands
// meets the defences that name the wielder (a rakshasa's vulnerability).
export function blowSource(plan: Pick<AttackPlan, "kind" | "sheet">): BlowSource {
  if (plan.kind === "spell") {
    return { spell: true };
  }
  // The builder stores the code (LG, NG, CG), a DM the words.
  return alignmentIs(plan.sheet.alignment, "good") ? { goodWielder: true } : {};
}

// One blow landing on an enemy, per damage type: the shared end of
// pc_attack's digital path and a character's opportunity attack.
export function landBlow(input: {
  campaign: AttackPlan["campaign"];
  turn: AttackPlan["turn"];
  encounter: AttackPlan["encounter"];
  enemy: AttackPlan["enemy"];
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  profile: Pick<AttackProfile, "damageType" | "material">;
  typedRiders: TypedRider[];
  damageOutcome: RollResult;
  dealt: number;
  crit: boolean;
  critExtraDice: number;
  magical: boolean;
  // Elemental Adept covers this attack spell's type (feat-combat.ts).
  ignoreResistance?: boolean;
  // The feat that ignores it, for the note (Elemental Adept, Poisoner).
  ignoreResistanceBy?: string;
  // A two-type spell's other type Elemental Adept covers (pc-attack-plan.ts).
  adeptOthers?: string[];
  // Mage Slayer's melee hit from within 5 feet (feat-combat.ts).
  concentrationDisadvantage?: boolean;
  nonlethal?: boolean;
  // An opportunity attack leaves the fight open (enemy-damage.ts).
  holdVictory?: boolean;
  // A spell's damage, or a good wielder's weapon (damage-logic.ts).
  blow?: BlowSource;
}): Record<string, unknown> {
  const { campaign, turn, encounter, enemy, sheets, sheetsById, profile, damageOutcome, dealt, crit, critExtraDice, magical } = input;
  // A silvered or adamantine weapon passes the resistances that name it.
  const material = profile.material ?? {};
  const nonlethal = input.nonlethal === true;
  const holdVictory = input.holdVictory === true;
  const unharmed = {
    ok: true,
    name: enemy.displayName,
    hp: `${enemy.currentHp}/${enemy.maxHp}`,
    damageApplied: 0,
  };
  const parts = damageParts(damageOutcome, profile.damageType, input.typedRiders, {
    crit,
    trailingTerms: crit ? critExtraDice : 0,
  });
  let applied: Record<string, unknown>;
  if (dealt <= 0) {
    applied = unharmed;
  } else if (isSheetFoe(enemy)) {
    // A character on the other side (sheet-foe.ts): the blow lands whole,
    // each type meeting the character's own defenses (pc-damage.ts).
    const typed = parts.length >= 2 ? parts.map((part) => ({ amount: part.amount, type: part.type || profile.damageType })) : undefined;
    applied = applySheetFoeBlow(campaign, turn, encounter, enemy, {
      amount: typed ? typed.reduce((sum, part) => sum + part.amount, 0) : dealt,
      ...(typed ? { parts: typed } : { type: profile.damageType }),
      ...(magical ? { magical: true } : {}),
      // The weapon's material and the blow's source meet the character's
      // form as they meet a block (a silvered sword and a lycanthrope).
      ...material,
      ...(input.blow?.spell ? { spell: true } : {}),
      ...(input.blow?.goodWielder ? { goodWielder: true } : {}),
      ...(input.ignoreResistance || input.adeptOthers?.length ? { ignoreResistanceTo: [...(input.ignoreResistance && profile.damageType ? [profile.damageType] : []), ...(typed ? (input.adeptOthers ?? []) : [])].join(", ") } : {}),
      ...(crit ? { crit: true } : {}),
      ...(nonlethal ? { nonlethal: true } : {}),
    }, sheets, sheetsById, holdVictory);
  } else if (parts.length < 2) {
    applied = applyEnemyDamage(
      campaign,
      turn,
      encounter,
      enemy,
      dealt,
      sheets,
      sheetsById,
      profile.damageType,
      { magical, nonlethal, holdVictory, ...material, ...input.blow, ...(input.ignoreResistance ? { ignoreResistance: true, ignoreResistanceBy: input.ignoreResistanceBy } : {}), ...(input.concentrationDisadvantage ? { concentrationDisadvantage: true } : {}) },
    );
  } else {
    // Two damage types in one blow: each meets the creature's resistances
    // on its own, and what is left lands as one wound (enemy-blow.ts).
    applied = landTypedParts({
      campaign,
      turn,
      encounter,
      enemy,
      parts,
      sheets,
      sheetsById,
      weapon: { magical, ...material, ...input.blow, ...(input.ignoreResistance ? { ignoreResistanceBy: input.ignoreResistanceBy ?? "Elemental Adept" } : {}) },
      nonlethal,
      holdVictory,
      crit,
      concentrationDisadvantage: input.concentrationDisadvantage === true,
      ...(input.adeptOthers?.length ? { ignoreTypes: { types: input.adeptOthers, by: "Elemental Adept" } } : {}),
    });
  }
  return applied;
}
