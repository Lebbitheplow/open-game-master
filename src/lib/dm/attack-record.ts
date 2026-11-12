// One player attack, written down once it is paid for: everything the rules
// read after the dice are thrown. Both dice paths resolve the attack from this
// record through the same stages (attack-swing.ts, attack-blow.ts). The
// server's dice resolve it at once; real dice store it on the parked roll and
// resolve it as each roll lands (pc-attack-parked.ts). A rule reads the record,
// never the plan, so it reaches both paths or neither.

import { conditionMeleeCritRange } from "@/lib/srd/condition-effects";
import type { PendingAttack } from "@/lib/db/dm-turns";
import type { Advantage } from "@/lib/dice";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { attackerUnseen } from "@/lib/dm/enemy-reactions";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { gearCritRiders } from "@/lib/dm/gear-attack";
import { markCritRange } from "@/lib/dm/attack-marks";
import { blowSource, liveTypedRiders, strikesAsMagic } from "@/lib/dm/pc-attack-damage";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { OnHitSpends } from "@/lib/dm/pc-attack-riders";
import type { HeldMote } from "@/lib/dm/authored-mote";
import type { BlowSource, WeaponMaterial } from "@/lib/dm/damage-logic";
import { getFoe } from "@/lib/dm/sheet-foe";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { TypedRider } from "@/lib/dm/damage-parts";
import type { CreatureOnHit } from "@/lib/srd/creature-attacks";
import type { GearWeapon } from "@/lib/srd/gear-weapons";
import { damageTypeFeat, poisonerIgnoresResistance, type DamageTypeFeat } from "@/lib/srd/feat-combat";
import { hasElvenAccuracy } from "@/lib/srd/feature-effects";

// The damage roll a hit or a graze asks for, decided once the d20 is known
// (attack-swing.ts askDamage). The server throws it at once; real dice park it
// on the damage roll's record, and attack-blow.ts lands it either way.
export type DamageAsk = {
  // Destructive Wrath wrote every die at its maximum: nothing to enter, so
  // real dice are not asked for.
  noDice?: boolean;
  expression: string;
  // The dice riding the blow under a type of their own (damage-parts.ts).
  riders: TypedRider[];
  crit: boolean;
  // Stunning Sniper: the critical stuns instead of doubling.
  stunShot: boolean;
  // A spell's half damage on a miss (Acid Arrow): half the total lands.
  half?: boolean;
  // The once-a-turn feats that change the dice, already spent: the server
  // rolls them, a player is told how to (attack-blow.ts damageDiceNote).
  feats: { brutal?: boolean; savage?: boolean; piercer?: boolean };
  rerollBelow: number;
  // Empowered Spell on a spell attack's damage: how many low dice are thrown
  // again (src/lib/dm/mt-srd-metamagic.ts, src/lib/dice.ts).
  empower?: number;
  // Paid on the hit, resolved once the blow has landed.
  stunDc?: number;
  maneuver?: boolean;
  // A natural 20's magic weapon dice rode the damage (Sentinel at Death's Door
  // reads no normal figure past them).
  critGear?: boolean;
};

// A Battle Master maneuver's rider save, with the DC the hit is made at.
export type ManeuverRider = { name: string; condition: string; save: "str" | "wis"; dc: number };

// A record written before these fields existed (a roll parked by an older
// build) lacks them; every reader defaults it to what the old real-dice
// path did.
export type AttackRecord = PendingAttack & {
  attackerId?: string;
  kind?: AttackKind;
  weaponAttack?: boolean;
  // The weapon is a ranged one (bow, thrown dart).
  ranged?: boolean;
  // Made within reach: what a monster's Parry answers (enemy-reactions.ts).
  melee?: boolean;
  // Touch of Death's necrotic, chosen on the hit (after-roll.ts).
  touchOfDeath?: number;
  // Destructive Wrath, chosen on the hit (after-roll.ts): its lightning and
  // thunder dice are dealt at their maximum.
  destructiveWrath?: boolean;
  unarmed?: boolean;
  improvised?: boolean;
  // The weapon's catalog name, for Curving Shot's arrows.
  base?: string;
  special?: "net" | "lance";
  gearWeapon?: GearWeapon;
  material?: WeaponMaterial;
  blow?: BlowSource;
  // Elemental Adept or Poisoner: the target's resistance to the type is ignored.
  ignoreResistanceBy?: string;
  // A two-type spell's other type Elemental Adept covers (pc-attack-plan.ts).
  adeptOthers?: string[];
  mageSlayer?: boolean;
  nonlethal?: boolean;
  onHit?: OnHitSpends;
  // A creature cannot Parry an attacker it could not see. Read when the attack
  // is made: the attack itself can end hiding.
  attackerUnseen?: boolean;
  // The creature's AC, without cover, when the attack was made (recordTargetAc).
  plainAc?: number;
  hitSpent?: string[];
  hitClaims?: string[];
  spell?: string;
  // The slot that spell attack spent: the level the spell is of for a kill
  // (Grim Harvest, ar-ws-harvest.ts).
  spellSlot?: number;
  stunShot?: boolean;
  maneuver?: ManeuverRider;
  typeFeat?: DamageTypeFeat;
  // The round of the attacker's own turn the attack was made on; absent for a
  // reaction, which opens nothing a turn's attack does.
  round?: number;
  advantage?: Advantage;
  // What the engine said of the attack before the roll (advantage, Sneak Attack).
  notes?: string[];
  mote?: HeldMote;
  // Advantage on this attack throws a third d20 (Elven Accuracy: not a
  // Strength attack). Master Duelist's reroll with advantage reads it.
  elvenAccuracy?: boolean;
  // A luck point was bought with the attack (pc_attack luck: true): the roll
  // has had its one, so the pause offers no other (after-roll.ts).
  luck?: boolean;
  // The server threw the d20 and the roll waits on the player's choice: when
  // it lands, the server throws the damage too (pc-attack-parked.ts).
  serverDice?: boolean;
  // The lead skipped the turn it was made on (pending-roll-land.ts
  // keepRollsLeftBehind). A lone hero's skip can leave the pointer and round
  // where they were, with the foe owed its turn, so only this says it is over.
  skipped?: boolean;
  // The attacks declared after this one in the same pc_attack call. They are
  // made, in order, once this attack has landed (pc-attack-parts.ts
  // runQueuedParts), and what they did rides back with it (queuedResults). A
  // hit whose damage the player rolls hands the queue on to that damage roll
  // (queueMovedTo, its id), whose record then holds the queue and its results;
  // `toolCallId` is the call's, which the damage roll does not carry.
  queue?: { characterId: string; parts: Record<string, unknown>[]; toolCallId?: string | null };
  queuedResults?: Record<string, unknown>[];
  queueMovedTo?: string;
  critGear?: { suffix: string; typed: Array<{ dice: string; type: string }>; notes: string[] };
  extras?: {
    foeSlayer?: number;
    strokeOfLuck?: boolean;
    openHand?: { choice: "prone" | "push" | "no reactions"; dc: number };
    hurl?: boolean;
    poison?: boolean;
    tempHp?: { amount: number; feature: string };
    creature?: CreatureOnHit;
  };
  // The damage roll's record only: the roll it asks for, and the to-hit roll
  // it follows (Sentinel at Death's Door and the reactions read its d20).
  damage?: DamageAsk;
  toHitRollId?: string;
  // The graze's damage roll: half of it lands (turn.ts pendingRollAnswer).
  halfOnMiss?: boolean;
  // Written by older builds: Savage Attacker spent when the roll parked.
  savageAttacker?: boolean;
  // Written by an older build of #820, never shipped.
  blowRound?: number;
};

export function attackRecord(plan: AttackPlan, strike: { critExtraDice: number; critOptions: { powerfulCritical: boolean; multiplyNumeric: boolean }; rerollBelow: number; hasOnHit: boolean; onHitSpends: OnHitSpends }, mote: HeldMote | null): AttackRecord {
  const { campaign, sheet, enemy, profile, riders, context, extras } = plan;
  const typeFeat = plan.weaponAttack ? damageTypeFeat(sheet, profile.damageType) : null;
  // Piercer: a piercing critical hit rolls one more of the weapon's dice.
  const critExtraDice = strike.critExtraDice + (typeFeat === "Piercer" ? 1 : 0);
  // A condition's melee critical range (Invincible Conqueror's 19) rides
  // melee weapon attacks only.
  const critRange = Math.min(plan.weaponAttack ? riders.critRange : 20, markCritRange(plan.marks.applies), plan.weaponAttack && !plan.atRange ? conditionMeleeCritRange(sheet.conditions) : 20);
  const critGear = gearCritRiders(profile, enemy.stats.type);
  const typedRiders = liveTypedRiders(plan.typedRiders, plan.droppedRiders);
  const ignoreBy = plan.elementalAdept ? "Elemental Adept" : poisonerIgnoresResistance(sheet, profile.damageType) ? "Poisoner" : null;
  const blow = blowSource(plan);
  const rider = plan.maneuver && !plan.maneuver.precision ? plan.maneuver.rider : null;
  const kept = {
    ...(extras.foeSlayer > 0 ? { foeSlayer: extras.foeSlayer } : {}),
    ...(extras.strokeOfLuck ? { strokeOfLuck: true } : {}),
    ...(extras.openHand ? { openHand: extras.openHand } : {}),
    ...(extras.hurl ? { hurl: true } : {}),
    ...(extras.poison ? { poison: true } : {}),
    ...(extras.tempHp ? { tempHp: extras.tempHp } : {}),
    ...(profile.creatureOnHit ? { creature: profile.creatureOnHit } : {}),
  };
  return {
    attacker: sheet.name,
    attackerId: sheet.id,
    weapon: profile.weapon,
    targetEnemyId: enemy.id,
    targetAc: plan.effectiveAc,
    plainAc: enemyAcWithEffects(campaign.id, enemy),
    damageExpression: profile.damageExpression,
    critDamageExpression: critDamageExpression(profile.damageExpression, critExtraDice, strike.critOptions),
    damageType: profile.damageType,
    kind: plan.kind,
    weaponAttack: plan.weaponAttack,
    ranged: profile.ranged,
    melee: !plan.atRange,
    magical: strikesAsMagic(plan),
    advantage: plan.advantage,
    ...(profile.unarmed ? { unarmed: true } : {}),
    ...(profile.improvised ? { improvised: true } : {}),
    ...(profile.base ? { base: profile.base } : {}),
    ...(plan.special ? { special: plan.special } : {}),
    ...(profile.gearWeapon ? { gearWeapon: profile.gearWeapon } : {}),
    ...(profile.material ? { material: profile.material } : {}),
    ...(blow.spell || blow.goodWielder ? { blow } : {}),
    ...(ignoreBy ? { ignoreResistanceBy: ignoreBy } : {}),
    ...(plan.adeptOthers.length ? { adeptOthers: plan.adeptOthers } : {}),
    ...(plan.mageSlayer ? { mageSlayer: true } : {}),
    ...(plan.options.nonlethal ? { nonlethal: true } : {}),
    ...(attackerUnseen(sheet.conditions, enemy.conditions, plan.sight) ? { attackerUnseen: true } : {}),
    ...(typedRiders.length ? { riders: typedRiders } : {}),
    ...(critExtraDice ? { critExtraDice } : {}),
    ...(context.autoCrit ? { autoCrit: true } : {}),
    ...(critRange < 20 ? { critRange } : {}),
    ...(strike.rerollBelow ? { rerollBelow: strike.rerollBelow } : {}),
    ...(strike.hasOnHit ? { onHit: strike.onHitSpends } : {}),
    ...(plan.hitSpent.length ? { hitSpent: plan.hitSpent } : {}),
    ...(plan.hitClaims.length ? { hitClaims: plan.hitClaims } : {}),
    ...(plan.kind === "spell" && plan.args.spell ? { spell: plan.args.spell } : {}),
    ...(plan.kind === "spell" && plan.spellSlotLevel ? { spellSlot: plan.spellSlotLevel } : {}),
    ...(critGear.suffix ? { critGear } : {}),
    ...(extras.stunShot ? { stunShot: true } : {}),
    ...(rider && plan.maneuver
      ? { maneuver: { name: plan.maneuver.name, ...rider, dc: 8 + plan.derived.proficiencyBonus + Math.max(plan.derived.abilityMods.str, plan.derived.abilityMods.dex) } }
      : {}),
    ...(typeFeat ? { typeFeat } : {}),
    ...(plan.budget ? { round: plan.budget.round } : {}),
    ...(context.notes.length ? { notes: [...context.notes] } : {}),
    ...(mote ? { mote } : {}),
    ...(extras.luck ? { luck: true } : {}),
    ...(profile.ability !== "str" && hasElvenAccuracy(sheet) ? { elvenAccuracy: true } : {}),
    ...(Object.keys(kept).length ? { extras: kept } : {}),
  };
}

// Whether the turn a parked to-hit roll was declared on is over: the pointer
// has moved off its attacker (the lead skipped them, the order was edited).
// A roll made on the attacker's own turn names its round, so a hero whose
// turn came round again does not land last round's swing on this one. That
// held only for dice the server threw: real dice the player had yet to
// enter stay theirs after the lead's skip (pending-roll-land.ts
// keepRollsLeftBehind), and entered on their next turn they hit for last
// round. A roll that lands then does nothing.
export function attackTurnOver(campaignId: string, record: Pick<AttackRecord, "round" | "skipped">, characterId: string | null): boolean {
  if (record.skipped) {
    return true;
  }
  const fight = getActiveEncounter(campaignId);
  if (!fight?.orderReady) {
    return false;
  }
  const current = fight.order[fight.turnIndex];
  if (!current || current.kind !== "pc" || current.characterId !== characterId) {
    return true;
  }
  return record.round !== undefined && fight.round !== record.round;
}

// The AC a roll meets when it lands. An attack's parts are made together, so
// the creature may have changed its AC since: a Shield an earlier part drew
// stands against this one. What the AC held beyond the creature's own (cover)
// is kept.
export function recordTargetAc(campaignId: string, record: Pick<AttackRecord, "targetAc" | "targetEnemyId" | "plainAc">): number {
  const { plainAc } = record;
  const foe = record.targetEnemyId ? getFoe(record.targetEnemyId) : null;
  return plainAc === undefined || !foe ? record.targetAc : record.targetAc - plainAc + enemyAcWithEffects(campaignId, foe);
}
