// The to-hit stage of a player's attack, the one both dice paths run: the d20
// meets the target's AC as it stands, a reaction may answer it, a near miss
// may be rescued, and the hit pays for what it carries and decides the damage
// roll it asks for. pc-attack-resolve.ts calls it with the server's d20,
// pc-attack-parked.ts with the player's; attack-blow.ts lands the damage.

import { getSheetById } from "@/lib/db/sheets";
import { spendWrath, WRATH_NOTE } from "@/lib/dm/destructive-wrath";
import { attackWrathDice, holdsDestructiveWrath } from "@/lib/dm/destructive-wrath-logic";
import { NET_HOLD } from "@/lib/dm/net-hold";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, recordEncounterTarget, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { RollResult } from "@/lib/dice";
import { budgetApplies, WEAPON_HIT, type TurnBudget } from "@/lib/dm/action-budget";
import { adjudicateHit } from "@/lib/dm/attack-logic";
import { FOE_SLAYER, rescueMiss, STROKE_OF_LUCK, totalAReactionMeets } from "@/lib/dm/attack-features";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { CHANNEL_DIVINITY } from "@/lib/dm/after-roll-logic";
import { recordTargetAc, type AttackRecord, type DamageAsk } from "@/lib/dm/attack-record";
import { moteBurst } from "@/lib/dm/authored-mote";
import { breakConcentration } from "@/lib/dm/concentration";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { tryParry } from "@/lib/dm/enemy-reactions";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { gearHitWithoutDamage } from "@/lib/dm/gear-weapon-hit";
import { claimHitRiders } from "@/lib/dm/pc-attack-damage";
import { applyRiderCondition, clearHitSpent, openCurvingShot, spendOnHit } from "@/lib/dm/pc-attack-riders";
import { getFoe } from "@/lib/dm/sheet-foe";
import { applySpellHitCondition, spellAttackRider } from "@/lib/dm/spell-attack-riders";
import { noteSwing, storeBudget } from "@/lib/dm/turn-budget";
import { openLastHit } from "@/lib/dm/last-hit";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { planAttackFx, type RollVisibility } from "@/lib/battlemap/fx-plan";
import { holdsFeature } from "@/lib/srd/feature-names";
import { GREAT_WEAPON_MASTER_READY } from "@/lib/srd/feat-combat";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { BRUTAL_ATTACK_USED, brutalAttackApplies, PIERCER_USED, SAVAGE_ATTACKER_USED, savageAttackerApplies } from "@/lib/srd/feat-combat";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Who the attack is between, read live when the stage runs.
export type SwingScene = {
  campaign: Campaign;
  turn: DmTurn;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
};

export type Judged = {
  hit: boolean;
  crit: boolean;
  // Hit on the roll itself, not rescued: Foe Slayer then rides the damage.
  rolledHit: boolean;
  total: number;
  targetAc: number;
  natural1: boolean;
  natural20: boolean;
};

// The attacker's own turn, as it now stands, when the attack is part of it: a
// reaction's attack, or a roll that lands once the turn has gone, has none.
// The encounter is read again each time, because saving a copy from before a
// blow undid what the blow wrote (the end of the fight, a legendary save).
export function attackTurn(campaignId: string, record: AttackRecord): { encounter: Encounter; budget: TurnBudget } | null {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (!encounter || record.round === undefined || !budgetApplies(budget, record.attackerId ?? "", record.round)) {
    return null;
  }
  return { encounter, budget };
}

// A once-a-turn mark on the attacker's turn. False when there is no such turn,
// or the mark is already there.
export function markAttackTurn(campaignId: string, record: AttackRecord, key: string): boolean {
  const turn = attackTurn(campaignId, record);
  if (!turn || turn.budget.oncePerTurn.includes(key)) {
    return false;
  }
  storeBudget(turn.encounter, { ...turn.budget, oncePerTurn: [...turn.budget.oncePerTurn, key] });
  return true;
}

// The d20 against the target: its AC now, Parry or Shield, then Foe Slayer and
// Stroke of Luck on a miss. On a hit, the once-a-turn riders it carried are spent.
export function judgeSwing(scene: SwingScene, record: AttackRecord, toHit: RollResult, notes: string[]): Judged {
  const { campaign } = scene;
  const targetAc = recordTargetAc(campaign.id, record);
  const natural1 = toHit.crit === "nat1";
  const judged = adjudicateHit(toHit.total, toHit.crit, targetAc, { natural: toHit.natural, critRange: record.critRange });
  // Foe Slayer is once on each of the ranger's turns: an earlier part of the
  // attack may have spent it since.
  const turn = attackTurn(campaign.id, record);
  const foeSlayer = turn && !turn.budget.oncePerTurn.includes(FOE_SLAYER) ? (record.extras?.foeSlayer ?? 0) : 0;
  const metTotal = totalAReactionMeets({ total: toHit.total, ac: targetAc, hit: judged.hit, crit: judged.crit, natural1, foeSlayer });
  const encounter = getActiveEncounter(campaign.id);
  const foe = getFoe(record.targetEnemyId);
  const parry =
    metTotal !== null && encounter && foe
      ? tryParry({ encounter, enemy: foe, total: metTotal, natural20: false, ac: targetAc, melee: record.melee === true, attackerUnseen: record.attackerUnseen === true })
      : null;
  if (parry) {
    notes.push(parry.note);
    // Foe Slayer's bonus lifted the near miss the reaction answered: it went on
    // this roll, so it is spent, and cannot draw a second reaction or lift again.
    if (metTotal !== toHit.total && markAttackTurn(campaign.id, record, FOE_SLAYER)) {
      notes.push(`Foe Slayer: +${foeSlayer} lifted ${toHit.total} to ${metTotal} before the reaction, and is spent`);
    }
  }
  const adjudicated = parry ? { ...judged, hit: false, crit: false } : judged;
  // A reaction's raised AC is the figure a roll has to reach: one it turned
  // has already met the plain AC.
  const rescued = adjudicated.hit
    ? null
    : rescueMiss({ total: toHit.total, ac: targetAc + (parry?.bonus ?? 0), natural1, foeSlayer, strokeOfLuck: record.extras?.strokeOfLuck === true });
  let rescuedHit = false;
  if (rescued === "foe slayer" && markAttackTurn(campaign.id, record, FOE_SLAYER)) {
    notes.push(`Foe Slayer: +${foeSlayer} to the attack roll turns the miss into a hit`);
    rescuedHit = true;
  } else if (rescued === "stroke of luck" && spendFeatureUse(campaign, scene.sheet.id, STROKE_OF_LUCK, "Stroke of Luck")) {
    notes.push("Stroke of Luck: the miss becomes a hit (the use is spent)");
    rescuedHit = true;
  }
  const hit = adjudicated.hit || rescuedHit;
  // A face in the critical range is a critical hit once the attack hits,
  // whatever lifted it to a hit: "A natural 19 for a Champion that hits
  // because of Foe Slayer is a critical hit" (the maintainer's decision R2 of
  // the 2026-11-09 gap sweep; SRD 5.1 Improved Critical, "score a critical hit
  // on a roll of 19 or 20").
  const widened = rescuedHit && !natural1 && toHit.natural !== undefined && toHit.natural >= (record.critRange ?? 20);
  const crit = adjudicated.crit || widened || (hit && record.autoCrit === true);
  if (hit) {
    // Sneak Attack and the other once-a-turn riders are spent by the hit.
    const live = attackTurn(campaign.id, record);
    if (live) {
      claimHitRiders(live.encounter, live.budget, record.hitClaims);
    }
    // A weapon's hit is kept on the turn, at the creature it hit, for every
    // weapon hit: it opens what rides one this turn (Arcane Jolt, Blade
    // Flourish, Psionic Strike, Gathered Swarm's push: authored-spends.ts
    // afterWeaponHit), and it is the trigger the features that answer a hit
    // this turn read (src/lib/dm/reaction-triggers.ts), so it is not limited
    // to the holders of a rider.
    if (record.weaponAttack ?? !record.spell) {
      markAttackTurn(campaign.id, record, `${WEAPON_HIT}${record.targetEnemyId}`);
    }
  }
  return { hit, crit, rolledHit: adjudicated.hit, total: toHit.total, targetAc, natural1, natural20: toHit.crit === "nat20" };
}

// A miss: Witch Bolt's beam fails, an Arcane Archer's arrow may curve, and a
// spell that deals half on a miss asks for its damage dice (Acid Arrow).
export function missSwing(scene: SwingScene, record: AttackRecord, judged: Judged, toHit: RollResult, visibility: RollVisibility, notes: string[]): { graze: DamageAsk | null } {
  const { campaign, sheet, enemy } = scene;
  const spellRider = spellAttackRider(record.spell);
  // A character struck by another keeps the record a reaction answers (last-hit.ts).
  if (isSheetFoe(enemy)) {
    const hitLog = openLastHit(campaign.id, enemy.id);
    hitLog.swing(toHit, judged.targetAc, { hit: false, crit: false, raw: 0, advantage: record.advantage ?? "none", ranged: record.ranged === true });
    hitLog.close({ attacker: { kind: "sheet", id: sheet.id, name: sheet.name }, attack: record.weapon, type: record.damageType ?? "", ranged: record.ranged === true });
  }
  if (spellRider?.beam) {
    breakConcentration(campaign, scene.turn.id, sheet.id, `${spellRider.beam} missed`);
  }
  const curving = record.weaponAttack && record.ranged ? openCurvingShot(campaign.id, sheet, enemy.id, record.base) : null;
  if (curving) {
    notes.push(curving);
  }
  emitAttackFx(campaign.id, attackStage(campaign.id, sheet, enemy), {
    hit: false,
    crit: false,
    fumble: judged.natural1,
    ranged: record.ranged === true,
    damageType: record.damageType ?? "",
    visibility,
  });
  const fresh = getFoe(enemy.id);
  // The half a miss deals is rolled too: a held Destructive Wrath takes it
  // when it is lightning or thunder.
  const wrath = spellRider?.halfOnMiss && holdsDestructiveWrath(getSheetById(sheet.id) ?? sheet)
    ? attackWrathDice(record.damageExpression, record.damageType ?? "", [], { crit: false })
    : null;
  // A natural 1 is a miss, and the spell's miss deals half ("On a miss, the
  // arrow splashes the target with acid for half as much of the initial
  // damage"): the maintainer's decision R1 of the 2026-11-09 gap sweep,
  // overturning #825's rule call that a natural 1 dealt nothing.
  const graze =
    spellRider?.halfOnMiss && fresh?.status === "alive"
      ? { expression: wrath?.expression ?? record.damageExpression, riders: [], crit: false, stunShot: false, half: true, feats: {}, rerollBelow: 0, ...(wrath?.noDice ? { noDice: true } : {}) }
      : null;
  if (graze && wrath) {
    spendWrath(campaign.id, sheet.id);
    notes.push(WRATH_NOTE);
  }
  if (!graze) {
    pushLine(notes, finishSwing(scene, record, { hit: false }));
  }
  return { graze };
}

// A hit pays for what it carries (the smite, the maneuver's die, the ki) and
// decides the damage roll. A net or a flask that burns later deals nothing
// now: those end here with their outcome.
export function hitSwing(scene: SwingScene, record: AttackRecord, judged: Judged, toHit: RollResult, visibility: RollVisibility, notes: string[]): { ask: DamageAsk } | { done: Record<string, unknown> } {
  const { campaign, turn, sheet, enemy } = scene;
  const crit = judged.crit;
  // Great Weapon Master's critical opens the bonus attack the moment it is
  // scored, at the stage both dice share: opened when the damage landed, a
  // critical entered on real dice whose target something else dropped before
  // the damage dice came opened nothing (finding L820-crit-then-target-dies).
  // The kill's half stays with the blow (attack-blow.ts bonusActionsOpened).
  // The blow says so, once it knows the fight goes on.
  if (crit && record.weaponAttack === true && record.ranged !== true && record.melee === true && holdsFeat(sheet, "Great Weapon Master") && markAttackTurn(campaign.id, record, GREAT_WEAPON_MASTER_READY)) {
    (record as AttackRecord & { gwmOpened?: boolean }).gwmOpened = true;
  }
  if (record.hitSpent?.length) {
    clearHitSpent(campaign, sheet.id, record.hitSpent);
  }
  const stage = attackStage(campaign.id, sheet, enemy);
  // The net deals no damage: a hit restrains a creature that is Large or
  // smaller and can be restrained at all.
  if (record.special === "net") {
    emitAttackFx(campaign.id, stage, { hit: true, crit: false, ranged: true, damageType: "", visibility });
    // Its own source, so breaking or cutting the net ends this restraint
    // and no other (net-hold.ts).
    const held = applyRiderCondition(campaign, getFoe(enemy.id) ?? enemy, "restrained", { maxSize: "Large", meta: { source: NET_HOLD } });
    pushLine(notes, finishSwing(scene, record, { hit: true, damage: 0 }));
    return {
      done: {
        damage: 0,
        note: held.applied
          ? `The net lands: ${enemy.displayName} is restrained until it is freed: a DC 10 Strength check (take_action escape), or 5 slashing damage to the net (damage_object name "Net", AC 10). The server applied the condition; a net deals no damage.`
          : `The net lands and slides off: ${held.reason} A net deals no damage.`,
      },
    };
  }
  let expression = record.damageExpression;
  const riders = [...(record.riders ?? [])];
  let stunDc: number | undefined;
  let maneuverPaid = record.maneuver !== undefined && !record.onHit?.maneuver;
  if (record.onHit) {
    const paid = spendOnHit(campaign, turn.id, record.onHit, scene.sheets, scene.sheetsById);
    notes.push(...paid.notes);
    if (paid.stunPaid && record.onHit.stun) {
      stunDc = record.onHit.stun.dc;
    }
    maneuverPaid = maneuverPaid || paid.maneuverPaid;
    if (record.onHit.smite && paid.suffix.includes(`+${record.onHit.smite.dice}d8`)) {
      // A smite the hit paid for rides as radiant.
      riders.push({ dice: `${record.onHit.smite.dice}d8`, type: "radiant" });
    }
    expression = `${expression}${paid.suffix}`;
  }
  // A flask whose hit deals nothing at once (alchemist's fire, oil), or holy
  // water on a creature neither fiend nor undead (gear-weapon-hit.ts).
  const markOnly = record.gearWeapon ? gearHitWithoutDamage(campaign, getFoe(enemy.id) ?? enemy, record.gearWeapon) : null;
  if (markOnly) {
    emitAttackFx(campaign.id, stage, { hit: true, crit: false, ranged: record.ranged === true, damageType: record.damageType ?? "", visibility });
    pushLine(notes, finishSwing(scene, record, { hit: true, damage: 0 }));
    return { done: { damage: 0, ...(record.damageType ? { damageType: record.damageType } : {}), note: markOnly } };
  }
  // What an attack spell leaves on the creature it hits (Witch Bolt's beam,
  // Ray of Frost's chill: spell-attack-riders.ts) lands with the hit.
  const spellRider = spellAttackRider(record.spell);
  const spellLine = spellRider ? applySpellHitCondition(campaign, spellRider, enemy.id, sheet.id) : null;
  if (spellLine) {
    notes.push(spellLine);
  }
  // A magic weapon's dice on a natural 20 (gear-attack.ts).
  const critGear = judged.natural20 && record.critGear?.suffix ? record.critGear : null;
  if (critGear) {
    expression = `${expression}${critGear.suffix}`;
    riders.push(...critGear.typed);
    notes.push(...critGear.notes);
  }
  // Touch of Death, chosen on the card the hit waited on and paid for only
  // now the hit stands. Flat, so a critical does not double it.
  if (record.touchOfDeath && spendFeatureUse(campaign, sheet.id, CHANNEL_DIVINITY, "Channel Divinity: Touch of Death", "player")) {
    expression = `${expression}+${record.touchOfDeath}`;
    riders.push({ dice: "", type: "necrotic", flat: record.touchOfDeath });
    notes.push(`Touch of Death: +${record.touchOfDeath} necrotic damage`);
  }
  // Foe Slayer not needed on the roll rides the hit's damage.
  if (judged.rolledHit && (record.extras?.foeSlayer ?? 0) > 0 && markAttackTurn(campaign.id, record, FOE_SLAYER)) {
    expression = `${expression}+${record.extras?.foeSlayer}`;
    notes.push(`Foe Slayer: +${record.extras?.foeSlayer} damage against a favored enemy`);
  }
  // Stunning Sniper: the critical hit stuns instead of doubling.
  const stunShot = crit && record.stunShot === true;
  if (stunShot) {
    notes.push("Stunning Sniper: the critical hit's damage is not doubled; the target is stunned instead");
  }
  const variant = campaign.gameSettings.variantRules;
  const rolled = crit && !stunShot
    ? critDamageExpression(expression, record.critExtraDice ?? 0, { powerfulCritical: variant.powerfulCritical, multiplyNumeric: variant.criticalDamageMods })
    : expression;
  // Destructive Wrath: chosen on the card the hit waited on, or held from
  // before the roll (destructive-wrath.ts). Only the lightning and thunder
  // dice are dealt at their maximum, the attack's own or a rider's.
  // Chosen on the card: the use is paid here, once the hit stands, so a Parry
  // or a Shield that turned the roll as it landed costs nothing.
  const chosen = record.destructiveWrath === true && spendFeatureUse(campaign, sheet.id, CHANNEL_DIVINITY, "Channel Divinity: Destructive Wrath", "player");
  const held = !record.destructiveWrath && holdsDestructiveWrath(getSheetById(sheet.id) ?? sheet);
  const wrath = chosen || held
    ? attackWrathDice(rolled, record.damageType ?? "", riders, { crit, trailingTerms: crit ? (record.critExtraDice ?? 0) : 0 })
    : null;
  if (wrath) {
    if (held) {
      spendWrath(campaign.id, sheet.id);
    }
    notes.push(WRATH_NOTE);
  }
  const asked = wrath?.expression ?? rolled;
  return {
    ask: {
      expression: asked,
      riders: wrath?.riders ?? riders,
      ...(wrath?.noDice ? { noDice: true } : {}),
      crit,
      stunShot,
      feats: spendDamageFeats(scene, record, asked),
      rerollBelow: record.rerollBelow ?? 0,
      ...(stunDc !== undefined ? { stunDc } : {}),
      ...(record.maneuver && maneuverPaid ? { maneuver: true } : {}),
      ...(critGear ? { critGear: true } : {}),
    },
  };
}

// The once-a-turn feats that change a hit's damage dice, spent as the roll is
// asked for: Brutal Attack rolls it twice, Savage Attacker the weapon's dice
// twice, Piercer rerolls one die. Each needs dice to work on and a turn of the
// attacker's own.
function spendDamageFeats(scene: SwingScene, record: AttackRecord, expression: string): DamageAsk["feats"] {
  const { campaign, sheet } = scene;
  const turn = attackTurn(campaign.id, record);
  const used = turn?.budget.oncePerTurn ?? null;
  const meleeWeapon = { weaponAttack: record.weaponAttack === true, melee: record.ranged !== true && record.melee === true };
  const hasDice = /\d*d\d+/.test(expression);
  const feats: DamageAsk["feats"] = {};
  if (used && brutalAttackApplies(sheet, meleeWeapon, used) && markAttackTurn(campaign.id, record, BRUTAL_ATTACK_USED)) {
    feats.brutal = true;
  }
  if (used && hasDice && savageAttackerApplies(sheet, meleeWeapon, used) && markAttackTurn(campaign.id, record, SAVAGE_ATTACKER_USED)) {
    feats.savage = true;
  }
  if (used && hasDice && record.typeFeat === "Piercer" && !used.includes(PIERCER_USED) && markAttackTurn(campaign.id, record, PIERCER_USED)) {
    feats.piercer = true;
  }
  return feats;
}

// The swing is over: a mote the roll spent bursts on the target, and the turn
// remembers the swing (action-budget.ts TurnBudget.struck).
export function finishSwing(scene: SwingScene, record: AttackRecord, result: { hit: boolean; damage?: number }): string | null {
  const { campaign, turn, sheet, enemy } = scene;
  if (record.round !== undefined) {
    noteSwing(campaign.id, sheet.id, { target: enemy.displayName, hit: result.hit, ...(result.damage !== undefined ? { damage: result.damage } : {}) });
  }
  return record.mote ? moteBurst(campaign, turn, record.mote, enemy) : null;
}

function pushLine(notes: string[], line: string | null) {
  if (line) {
    notes.push(line);
  }
}

// Where attacker and target stand on the live board, and the target line every
// client draws for the round. Null off the board.
type AttackStage = { from: { x: number; y: number }; to: { x: number; y: number }; fromTokenId: string; toTokenId: string } | null;

export function attackStage(campaignId: string, sheet: CharacterSheet, enemy: EncounterEnemy): AttackStage {
  const from = tokenPosition(campaignId, sheet.id);
  const to = tokenPosition(campaignId, enemy.id);
  const encounter = getActiveEncounter(campaignId);
  if (!from || !to || !encounter) {
    return null;
  }
  recordEncounterTarget(encounter.id, encounter.round, sheet.id, enemy.id);
  return { from: from.at, to: to.at, fromTokenId: from.tokenId, toTokenId: to.tokenId };
}

export function emitAttackFx(
  campaignId: string,
  stage: AttackStage,
  outcome: { hit: boolean; crit: boolean; fumble?: boolean; ranged: boolean; damage?: number; damageType?: string; visibility: RollVisibility },
) {
  if (!stage) {
    return;
  }
  // Damage to an enemy is a DM secret; the client strips the number for seats
  // without real enemy numbers.
  publishFx(campaignId, planAttackFx({ ...stage, ...outcome, secretNumbers: true }));
}
