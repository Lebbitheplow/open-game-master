// The server's dice for pc_attack: the to-hit expression is built, and the
// server throws the d20 and the damage. What the dice decide is resolved by
// the stages every attack runs, whoever throws its dice (attack-swing.ts for
// the hit, attack-blow.ts for the blow); pc-attack-parked.ts runs the same
// stages on a player's real dice. Split from pc-attack.ts, which has already
// refused or paid for everything this rolls; nothing here refuses the attack.

import { tranceFloored } from "@/lib/dm/ar-ws-trance-floor";
import { noteShift, takeShift } from "@/lib/dm/chronal-shift";
import { settleAttackDie } from "@/lib/dm/forced-save";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression, type RollResult } from "@/lib/dice";
import type { RollVisibility } from "@/lib/battlemap/fx-plan";
import { attacksLeft } from "@/lib/dm/action-budget";
import { attackRecord, recordTargetAc, type AttackRecord, type DamageAsk } from "@/lib/dm/attack-record";
import { hitSwing, judgeSwing, missSwing, type SwingScene } from "@/lib/dm/attack-swing";
import { landSwingBlow, publishRoll, throwDamage } from "@/lib/dm/attack-blow";
import type { HeldMote } from "@/lib/dm/authored-mote";
import type { strikeDamage } from "@/lib/dm/pc-attack-damage";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import { hasElvenAccuracy, hasHalflingLuck } from "@/lib/srd/feature-effects";
import { rollAgainst } from "@/lib/roll-labels";

export { publishRoll };

// The roll the attack makes and the damage it carries, built once the
// attack is paid for and shared by both dice paths.
export type Strike = ReturnType<typeof strikeToHit> & ReturnType<typeof strikeDamage>;

export function strikeToHit(plan: AttackPlan) {
  const { sheet, enemy, profile, advantage, maneuver, context } = plan;
  const toHitRiderSuffix = `${plan.attackRiders.diceSuffix}${
    maneuver?.precision ? `+1${maneuver.die}` : ""
  }`;

  // Elven Accuracy: advantage on a DEX/INT/WIS/CHA attack rolls a third d20
  // and keeps the highest. Spell attacks report their ability as "dex", so
  // excluding only Strength matches the feat's DEX/INT/WIS/CHA scope.
  const elvenAccuracy =
    advantage === "advantage" && profile.ability !== "str" && hasElvenAccuracy(sheet);
  if (elvenAccuracy) {
    context.notes.push("Elven Accuracy: rolls a third d20 and keeps the highest");
  }
  // Halfling Lucky rerolls a natural 1 on the attack roll once, so it rides
  // the leading d20 term as the grammar's "r1" suffix, before any rider dice.
  const lucky = hasHalflingLuck(sheet);
  if (lucky) {
    context.notes.push("Lucky: a natural 1 on the attack roll is rerolled once");
  }
  // Lucky's point: one more d20 in the pool, the best kept (the feat lets
  // them choose among all the dice, disadvantage or not).
  if (plan.extras.luck) {
    context.notes.push("Lucky: a luck point buys an extra d20, the best kept");
  }
  const toHitD20 = d20Expression(profile.toHit, advantage)
    .replace(/^2d20kh1/, elvenAccuracy ? "3d20kh1" : "2d20kh1")
    .replace(/^(\d+)d20(?:k[hl]\d+)?/, (whole, count) => (plan.extras.luck ? `${Number(count) + 1}d20kh1` : whole))
    .replace(/^(\d+d20(?:k[hl]\d+)?)/, lucky ? "$1r1" : "$1");
  // Trance of Order: a d20 of 9 or lower counts as 10 (ar-ws-trance-floor.ts).
  const toHitExpression = tranceFloored(sheet, `${toHitD20}${toHitRiderSuffix}`);
  const detail = rollAgainst(profile.weapon, enemy.displayName);
  return { toHitExpression, detail };
}

// The server's throw of the to-hit roll, tagged as the hero's attack.
export function throwToHit(plan: AttackPlan, strike: Strike): RollResult {
  return rollExpression(strike.toHitExpression, undefined, { purpose: { roller: "hero", kind: "attack", who: plan.sheet.name } });
}

// The to-hit throw, answered by a Chronal Shift a watching wizard set on it
// at the stop before the call (src/lib/dm/chronal-shift.ts): a miss is
// thrown again when the wizard asked for that, and the new roll stands.
export function shiftedThrow(plan: AttackPlan, strike: Strike, ac: number, critRange: number): RollResult {
  const thrown = throwToHit(plan, strike);
  const natural = thrown.natural ?? 0;
  const hits = natural !== 1 && (natural >= critRange || thrown.total >= ac);
  const by = takeShift(plan.campaign.id, { roller: "hero", kind: "attack", who: plan.sheet.name }, hits);
  if (!by) {
    return thrown;
  }
  const again = throwToHit(plan, strike);
  noteShift(plan.campaign.id, `${by} used Chronal Shift: ${plan.sheet.name} rolled the attack again (${thrown.total} became ${again.total}), and the new roll stands.`);
  return again;
}

// Digital path: the server throws the d20 and the damage, and the attack runs
// the same stages a player's real dice do (attack-swing.ts, attack-blow.ts).
// `thrown`: a to-hit roll already thrown for a player whose rolls can wait
// (pc-attack-parked.ts throwForChoice) and that offered nothing to choose. A
// held Bardic die is theirs to spend then, never the server's: it stays held.
export function rollPcAttack(plan: AttackPlan, strike: Strike, mote: HeldMote | null = null, thrownForPlayer: RollResult | null = null): Record<string, unknown> {
  const { campaign, turn, sheet, enemy, budget, context } = plan;
  const record = attackRecord(plan, strike, mote);
  const scene: SwingScene = { campaign, turn, sheet, enemy, sheets: plan.sheets, sheetsById: plan.sheetsById };
  // Notes written from here on; the plan's own ride the answer before them.
  const notes = context.notes;
  const thrown = thrownForPlayer ?? shiftedThrow(plan, strike, recordTargetAc(campaign.id, record), record.critRange ?? 20);
  const hitOutcome = thrownForPlayer ? thrownForPlayer : settleAttackDie(campaign.id, sheet, thrown, recordTargetAc(campaign.id, record), record.critRange ?? 20);
  if (hitOutcome !== thrown) {
    notes.push(`spends their Bardic Inspiration die on the miss: ${thrown.total} becomes ${hitOutcome.total}`);
  }
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: strike.detail,
    advantage: plan.advantage,
    result: hitOutcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
  });
  publishRoll(campaign.id, hitRoll);
  turn.rollIds.push(hitRoll.id);
  const judged = judgeSwing(scene, record, hitOutcome, notes);
  const base = () => ({
    attacker: sheet.name,
    weapon: plan.profile.weapon,
    rolled: hitOutcome.total,
    vsAc: judged.targetAc,
    target: enemy.displayName,
    ...(plan.profile.improvised ? { improvised: true } : {}),
    ...(budget ? {} : { reaction: true }),
    ...(notes.length ? { conditionEffects: notes } : {}),
    // Extra Attack: the model has no way to know a level-5 fighter swings
    // twice unless the engine says so on every swing.
    ...(budget && attacksLeft(budget) > 0 && budget.attacksMade > 0
      ? {
          attacksRemaining: attacksLeft(budget),
          extraAttack: `${sheet.name} has ${attacksLeft(budget)} more attack${attacksLeft(budget) === 1 ? "" : "s"} this turn: one more entry each in pc_attack's attacks, before ending their turn.`,
        }
      : {}),
  });
  if (!judged.hit) {
    const { graze } = missSwing(scene, record, judged, hitOutcome, hitRoll.visibility, notes);
    // Acid Arrow: a miss still deals half the damage.
    const grazed = graze ? serverBlow(scene, record, graze, hitOutcome, hitRoll.visibility, rollAgainst(`${plan.profile.weapon} (half on a miss)`, enemy.displayName), notes) : null;
    return {
      ...base(),
      hit: false,
      ...(judged.natural1 ? { fumble: true } : {}),
      ...(grazed ?? {}),
      note: grazed
        ? "The attack misses, and the spell still deals half its damage; the server already applied it."
        : "The attack misses; narrate the miss.",
    };
  }
  const prepared = hitSwing(scene, record, judged, hitOutcome, hitRoll.visibility, notes);
  if ("done" in prepared) {
    return { ...base(), hit: true, ...prepared.done };
  }
  const landed = serverBlow(scene, record, prepared.ask, hitOutcome, hitRoll.visibility, strike.detail, notes);
  const crit = prepared.ask.crit;
  const dealt = Number(landed.damage ?? 0);
  return {
    ...landed,
    ...base(),
    hit: true,
    ...(crit ? { crit: true } : {}),
    damage: dealt,
    ...(plan.profile.damageType ? { damageType: plan.profile.damageType } : {}),
    note: typeof landed.warning === "string"
      ? landed.warning
      : landed.dead
        ? `${enemy.displayName} is slain; the server already applied this damage. Narrate the killing blow.`
        : landed.down
          ? `${String(landed.note ?? `${enemy.displayName} falls.`)} The server already applied this damage.`
          : landed.knockedOut
            ? `${enemy.displayName} is knocked out, unconscious at 0 hit points and out of the fight; the server already applied this. Narrate it falling senseless, not dying.`
            : dealt === 0
              ? `The blow lands and does no harm: its damage came to 0. Narrate a hit that fails to hurt ${enemy.displayName}.`
              : `The server already applied this damage to ${enemy.displayName}. Do NOT call apply_damage for this hit; narrate from this state.`,
  };
}

// The server's damage dice for a hit or a graze: thrown, shown, and landed.
export function serverBlow(scene: SwingScene, record: AttackRecord, ask: DamageAsk, hitOutcome: RollResult, visibility: RollVisibility, detail: string, notes: string[]): Record<string, unknown> {
  const { campaign, turn, sheet } = scene;
  const outcome = throwDamage(ask, sheet.name, notes);
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail,
    result: outcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
  });
  publishRoll(campaign.id, damageRoll);
  turn.rollIds.push(damageRoll.id);
  return landSwingBlow(scene, record, ask, damageRoll, hitOutcome, visibility, notes);
}
