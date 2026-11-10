// The damage stage of a player's attack, the one both dice paths run: the
// rolled damage lands per type, then everything the blow leaves behind (the
// feats' marks and bonus actions, a maneuver's save, Stunning Strike, poison,
// a kill's rewards). The server's dice reach it straight from the to-hit stage
// (pc-attack-resolve.ts); real dice reach it when the player's damage roll
// lands (pc-attack-parked.ts).

import { allocateSeq } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions } from "@/lib/db/encounters";
import { publishWithSeq } from "@/lib/events";
import { insertRoll, landRoll, type StoredRoll } from "@/lib/db/rolls";
import { rollExpression, type DiceTerm, type RollResult } from "@/lib/dice";
import type { RollVisibility } from "@/lib/battlemap/fx-plan";
import { hurlThroughHell, HURL_THROUGH_HELL, openHandOnHit, poisonOnHit, spendFeatureUse } from "@/lib/dm/attack-onhit";
import type { AttackRecord, DamageAsk } from "@/lib/dm/attack-record";
import { attackStage, attackTurn, emitAttackFx, finishSwing, markAttackTurn, type SwingScene } from "@/lib/dm/attack-swing";
import { authoredOnHit } from "@/lib/dm/authored-hooks";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { critOnlyWhileUnconscious } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { ordinaryOfCritical } from "@/lib/dm/encounter-logic";
import { darkOnesBlessing } from "@/lib/dm/feature-hooks";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { openLastHit } from "@/lib/dm/last-hit";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { landNaturalOnHit } from "@/lib/dm/natural-onhit";
import { landBlow } from "@/lib/dm/pc-attack-damage";
import { applyRiderCondition, gainTempHp, riderBarred, stunningStrikeSave } from "@/lib/dm/pc-attack-riders";
import { getFoe } from "@/lib/dm/sheet-foe";
import { healCasterHalf, spellAttackRider } from "@/lib/dm/spell-attack-riders";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { textKey } from "@/lib/language/text-logic";
import { brawlerUnarmed, CRUSHER_USED, GREAT_WEAPON_MASTER_READY, SLASHER_USED, TAVERN_GRAPPLE_READY } from "@/lib/srd/feat-combat";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { holdsFeature } from "@/lib/srd/feature-names";

// The server's dice for a damage roll, with the feats the hit spent on them:
// Brutal Attack rolls it twice and keeps the better, Savage Attacker the
// weapon's own dice, Piercer rerolls the lowest die.
export function throwDamage(ask: DamageAsk, who: string, notes: string[]): RollResult {
  let outcome = rollExpression(ask.expression, undefined, { rerollBelow: ask.rerollBelow, purpose: { roller: "hero", kind: "damage", who } });
  if (ask.feats.brutal) {
    const again = rollExpression(ask.expression, undefined, { rerollBelow: ask.rerollBelow });
    notes.push(`Brutal Attack: the damage rolled twice (${outcome.total} and ${again.total}), the better kept`);
    outcome = again.total > outcome.total ? again : outcome;
  }
  if (ask.feats.savage) {
    const weapon = outcome.terms.find((term): term is DiceTerm => term.kind === "dice");
    const kept = weapon ? weapon.dice.filter((die) => die.kept) : [];
    if (weapon && kept.length) {
      const first = kept.reduce((sum, die) => sum + die.value, 0);
      const again = rollExpression(`${kept.length}d${kept[0].sides}`, undefined, { rerollBelow: ask.rerollBelow });
      const fresh = again.terms.find((term): term is DiceTerm => term.kind === "dice");
      notes.push(`Savage Attacker: the weapon's dice rolled twice (${first} and ${again.total}), the better kept`);
      if (fresh && again.total > first) {
        kept.forEach((die, index) => {
          die.value = fresh.dice[index]?.value ?? die.value;
        });
        weapon.subtotal += again.total - first;
        outcome = { ...outcome, total: outcome.total - first + again.total };
      }
    }
  }
  if (ask.feats.piercer) {
    const dice = outcome.terms.find((term): term is DiceTerm => term.kind === "dice");
    const lowest = dice ? dice.dice.filter((die) => die.kept).sort((a, b) => a.value - b.value)[0] : undefined;
    if (dice && lowest) {
      const fresh = rollExpression(`1d${lowest.sides}`).total;
      notes.push(`Piercer: a ${lowest.value} on a d${lowest.sides} is rerolled to ${fresh}`);
      dice.subtotal += fresh - lowest.value;
      outcome = { ...outcome, total: outcome.total - lowest.value + fresh };
      lowest.value = fresh;
    }
  }
  return outcome;
}

// The same feats for a player rolling at the table: what they do with the dice
// before entering the total.
export function damageDiceNote(ask: DamageAsk): string {
  return [
    ask.rerollBelow ? `, rerolling any die of ${ask.rerollBelow} or less once for Great Weapon Fighting` : "",
    ask.feats.brutal ? ", rolling the damage a second time and keeping the better total (Brutal Attack)" : "",
    ask.feats.savage ? ", rolling the weapon's dice a second time and keeping the better total (Savage Attacker)" : "",
    ask.feats.piercer ? ", rerolling the lowest damage die once and keeping the new roll (Piercer)" : "",
  ].join("");
}

// The same steps said to the player on their damage roll card. The model's
// note above is not enough: the feat is spent the moment the hit parks the
// roll, and a GM who does not pass the note on leaves the player entering
// dice the feat never touched. Empty when no feat changes the dice.
export function damageDiceSteps(ask: DamageAsk): string {
  const steps = [
    ask.rerollBelow ? `reroll any die of ${ask.rerollBelow} or less once (Great Weapon Fighting)` : "",
    ask.feats.brutal ? "roll the damage a second time and keep the better total (Brutal Attack)" : "",
    ask.feats.savage ? "roll the weapon's dice a second time and keep the better total (Savage Attacker)" : "",
    ask.feats.piercer ? "reroll the lowest damage die once and keep the new roll (Piercer)" : "",
  ].filter(Boolean);
  return steps.length ? `Before you enter your dice: ${steps.join(", then ")}.` : "";
}

// A rolled damage roll landing on the target, and what the blow leaves.
// `toHit` is the d20 the blow followed (null for a roll parked by an older
// build). Returns what the answer carries.
export function landSwingBlow(
  scene: SwingScene,
  record: AttackRecord,
  ask: DamageAsk,
  roll: StoredRoll,
  toHit: RollResult | null,
  visibility: RollVisibility,
  notes: string[],
): Record<string, unknown> {
  const { campaign, sheet } = scene;
  // The target as it now stands: the fight or the creature may be gone while
  // a player's damage roll waited.
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter ? getFoe(scene.enemy.id) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    finishSwing(scene, record, { hit: !ask.half, damage: 0 });
    return { warning: `${scene.enemy.displayName} is no longer in the fight; the damage was NOT applied. Narrate around it.` };
  }
  const damageOutcome = roll.breakdown;
  const profile = { damageType: record.damageType ?? "", ...(record.material ? { material: record.material } : {}) };
  const blowFlags = {
    magical: record.magical === true,
    nonlethal: record.nonlethal,
    ...(record.ignoreResistanceBy ? { ignoreResistance: true, ignoreResistanceBy: record.ignoreResistanceBy } : {}),
    ...(record.adeptOthers?.length ? { adeptOthers: record.adeptOthers } : {}),
    ...(record.mageSlayer ? { concentrationDisadvantage: true } : {}),
    blow: record.blow ?? {},
  };
  const land = (dealt: number, typed: DamageAsk["riders"], crit: boolean, critExtraDice: number) =>
    landRoll(roll.id, enemy.id, () =>
      landBlow({ ...blowFlags, campaign, turn: scene.turn, encounter, enemy, sheets: scene.sheets, sheetsById: scene.sheetsById, profile, typedRiders: typed, damageOutcome, dealt, crit, critExtraDice }),
    );
  // Acid Arrow's miss: half of the spell's dice, under its own type alone.
  if (ask.half) {
    const half = Math.floor(Math.max(0, damageOutcome.total) / 2);
    const applied = half > 0 ? land(half, [], false, 0) : {};
    const mote = finishSwing(scene, record, { hit: false, damage: half });
    return { ...applied, damage: half, ...(mote ? { mote } : {}) };
  }
  const crit = ask.crit;
  const critExtraDice = record.critExtraDice ?? 0;
  // A penalty can bring a hit's damage to 0, never below it.
  const dealt = Math.max(0, damageOutcome.total);
  const hitLog = isSheetFoe(enemy) ? openLastHit(campaign.id, enemy.id) : null;
  emitAttackFx(campaign.id, attackStage(campaign.id, sheet, enemy), { hit: true, crit, ranged: record.ranged === true, damage: dealt, damageType: record.damageType ?? "", visibility });
  const applied = land(dealt, ask.riders, crit, critExtraDice);
  if (hitLog && toHit) {
    // A critical that came only from the character it struck lying unconscious
    // at 0 within 5 ft keeps its ordinary damage from the same dice, for a
    // reaction that later leaves them standing (reaction-refund.ts); a
    // critical's normal figure is for Sentinel at Death's Door (last-hit.ts).
    const critOptions = { multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods, extraDice: critExtraDice };
    const ordinary = crit && !ask.stunShot && toHit.crit !== "nat20" && enemy.currentHp <= 0 && critOnlyWhileUnconscious(enemy.conditions)
      ? ordinaryOfCritical(damageOutcome, record.damageExpression, critOptions)
      : null;
    const normal = crit && !ask.stunShot && !ask.critGear ? ordinaryOfCritical(damageOutcome, record.damageExpression, critOptions) : null;
    hitLog.swing(toHit, record.targetAc, {
      hit: true,
      crit,
      raw: dealt,
      advantage: record.advantage ?? "none",
      type: record.damageType,
      ranged: record.ranged === true,
      ...(ordinary ? { ordinary: { raw: Math.max(0, ordinary.total) } } : {}),
      ...(normal ? { normal: { raw: Math.max(0, normal.total), from: dealt } } : {}),
      flags: { ...(record.magical ? { magical: true } : {}), ...(record.material ?? {}), ...(record.blow ?? {}) },
    });
    hitLog.close({ attacker: { kind: "sheet", id: sheet.id, name: sheet.name }, attack: record.weapon, type: record.damageType ?? "", ranged: record.ranged === true });
  }
  if ("error" in applied) {
    return applied;
  }
  const dead = Boolean(applied.dead);
  const over = Boolean(applied.encounterOver);
  const out: Record<string, unknown> = { ...applied, damage: dealt };
  if (!over) {
    notes.push(...bonusActionsOpened(scene, record, crit, dead));
  }
  // What the hit leaves on the target: Stunning Sniper's stun, Slasher's
  // hamstring and Crusher's shove once a turn, and their critical hits'
  // marks, each until the start of the attacker's next turn.
  if (!dead && !over) {
    notes.push(...featHitMarks(scene, record, crit, ask.stunShot));
    const repelled = repellingBlast(scene, record);
    if (repelled) {
      notes.push(repelled);
    }
    if (ask.maneuver && record.maneuver) {
      out.maneuver = maneuverRiderSave(scene, record.maneuver);
    }
  }
  if (ask.stunDc !== undefined && !over) {
    out.stunningStrike = stunningStrikeSave(campaign, enemy.encounterId, enemy.id, sheet.id, ask.stunDc);
  }
  Object.assign(out, hitExtras(scene, record, dead, over));
  // Dark One's Blessing: a kill gives a Fiend warlock temporary hit points.
  const blessing = dead ? darkOnesBlessing(campaign, sheet.id) : null;
  if (blessing) {
    out.darkOnesBlessing = blessing;
  }
  // Authored subclass features on a hit and on a kill (authored-hooks.ts). A
  // kill that ended the fight still pays out (Touch of Death): the fight as
  // the blow found it.
  const live = getActiveEncounter(campaign.id) ?? encounter;
  const authored = live
    ? authoredOnHit(campaign, { encounter: live, sheet, enemy, ...(record.ranged !== undefined ? { melee: !record.ranged } : {}), weapon: record.weaponAttack ?? !record.spell, weaponName: record.weapon, dead })
    : [];
  if (authored.length) {
    out.subclassFeatures = authored;
  }
  // Vampiric Touch: the caster regains half the necrotic damage dealt
  // (spell-attack-riders.ts). The spell's condition landed with the hit.
  const spellRider = spellAttackRider(record.spell);
  if (spellRider?.healHalf && !over) {
    out.spellEffect = healCasterHalf(campaign, sheet.id, Number(applied.damageApplied ?? dealt) || 0, record.weapon);
  }
  const mote = finishSwing(scene, record, { hit: true, damage: dealt });
  if (mote) {
    out.mote = mote;
  }
  return out;
}

// Great Weapon Master: a melee weapon crit or kill opens a bonus-action melee
// attack this turn (pc-attack-options.ts reads the key). Tavern Brawler: a hit
// with an unarmed strike or an improvised weapon opens a bonus-action grapple.
function bonusActionsOpened(scene: SwingScene, record: AttackRecord, crit: boolean, dead: boolean): string[] {
  const { campaign, sheet } = scene;
  const notes: string[] = [];
  const meleeWeapon = record.weaponAttack === true && record.ranged !== true && record.melee === true;
  // A critical opened it already at the to-hit stage (attack-swing.ts hitSwing).
  // Said only while that turn still runs: a damage roll entered later opens
  // nothing on the turn it lands in.
  const openedAtHit = (record as AttackRecord & { gwmOpened?: boolean }).gwmOpened === true && attackTurn(campaign.id, record) !== null;
  if (meleeWeapon && (crit || dead) && holdsFeat(sheet, "Great Weapon Master") && (openedAtHit || markAttackTurn(campaign.id, record, GREAT_WEAPON_MASTER_READY))) {
    notes.push(`Great Weapon Master: ${crit ? "the critical hit" : "the kill"} opens a bonus-action melee attack this turn (an entry with feature "Great Weapon Master")`);
  }
  if ((record.unarmed || record.improvised) && record.ranged !== true && brawlerUnarmed(sheet) && markAttackTurn(campaign.id, record, TAVERN_GRAPPLE_READY)) {
    notes.push("Tavern Brawler: the hit opens a bonus-action grapple this turn (take_action grapple)");
  }
  return notes;
}

// What the hit carries past its damage: temporary hit points, a coat of
// poison, a creature's natural attack rider, Open Hand Technique, Hurl Through
// Hell (attack-onhit.ts, natural-onhit.ts). A kill or the fight's end leaves
// nothing to land the riders on.
function hitExtras(scene: SwingScene, record: AttackRecord, dead: boolean, over: boolean): Record<string, unknown> {
  const { campaign, sheet, enemy } = scene;
  const extras = record.extras ?? {};
  const out: Record<string, unknown> = {};
  if (extras.tempHp) {
    out.tempHp = gainTempHp(campaign, sheet.id, extras.tempHp.amount, extras.tempHp.feature);
  }
  if (extras.poison && !over) {
    const line = poisonOnHit(campaign, sheet.id, enemy.id);
    if (line) {
      out.poison = line;
    }
  }
  if (over || dead) {
    return out;
  }
  if (extras.creature) {
    const lines = landNaturalOnHit(campaign, {
      turn: scene.turn,
      attacker: { kind: "sheet", sheetId: sheet.id, name: sheet.name },
      holderId: sheet.id,
      attack: record.weapon,
      enemyId: enemy.id,
      onHit: extras.creature,
    });
    if (lines.length) {
      out.onHit = lines;
    }
  }
  if (extras.openHand) {
    out.openHand = openHandOnHit(campaign, sheet.id, enemy.id, extras.openHand.choice, extras.openHand.dc);
  }
  if (extras.hurl && spendFeatureUse(campaign, sheet.id, HURL_THROUGH_HELL, "Hurl Through Hell")) {
    out.hurlThroughHell = hurlThroughHell(campaign, sheet.id, enemy.id);
  }
  return out;
}

// A maneuver's rider save (Trip -> prone, Menacing -> frightened) against the
// creature's real stat block, rolled as every other save is (forced-save.ts).
function maneuverRiderSave(scene: SwingScene, rider: NonNullable<AttackRecord["maneuver"]>): string {
  const { campaign, turn, sheet } = scene;
  const fresh = getFoe(scene.enemy.id);
  if (!fresh || fresh.status !== "alive") {
    return `${rider.name}: the target is already down.`;
  }
  const barred = riderBarred(fresh, rider.condition, rider.condition === "prone" ? "Large" : null);
  if (barred) {
    return `${rider.name}: ${barred} The extra damage still lands.`;
  }
  const save = rollEnemySave(campaign.id, fresh, rider.save, rider.dc, { against: rider.condition, origin: { ref: sheet.id } });
  if (save.result) {
    const saveRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "saving_throw",
      detail: `${fresh.displayName}: ${rider.save.toUpperCase()} save vs ${rider.name}`,
      dc: rider.dc,
      result: save.result,
    });
    turn.rollIds.push(saveRoll.id);
    publishRoll(campaign.id, saveRoll);
  }
  const shown = save.total ?? "an automatic failure";
  if (save.success) {
    return `${rider.name}: ${fresh.displayName} holds (${shown} vs DC ${rider.dc}); no ${rider.condition}.`;
  }
  applyRiderCondition(campaign, fresh, rider.condition, {
    // Prone lasts until the creature stands. Menacing Attack's fright and
    // Goading Attack's goad last until the end of the attacker's next turn
    // (SRD 5.1, turn-end.ts); a disarm is a moment.
    ...(rider.condition === "prone"
      ? {}
      : rider.condition === "frightened" || rider.condition === "goaded"
        ? { meta: untilTurnEnd(sheet.id, { source: sheet.id }) }
        : { rounds: 1 }),
  });
  return `${rider.name}: ${fresh.displayName} fails the ${rider.save.toUpperCase()} save (${shown} vs DC ${rider.dc}) and is ${rider.condition}.`;
}

// SRD 5.1, Repelling Blast (a warlock invocation): "When you hit a creature
// with eldritch blast, you can push the creature up to 10 feet away from you
// in a straight line." On a battle map each hit pushes it two squares, as far
// as the ground behind it lets it go.
function repellingBlast(scene: SwingScene, record: AttackRecord): string | null {
  const { campaign, sheet, enemy } = scene;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || record.kind !== "spell" || textKey(record.weapon) !== textKey("Eldritch Blast") || !holdsFeature(sheet, "Invocation: Repelling Blast")) {
    return null;
  }
  let feet = 0;
  let stopped = "";
  for (let step = 0; step < 2; step += 1) {
    const pushed = pushTokenAway(campaign, encounter.id, sheet.id, enemy.id);
    if (!pushed.moved) {
      stopped = pushed.reason;
      break;
    }
    feet += 5;
  }
  return feet
    ? `Repelling Blast: ${enemy.displayName} is pushed ${feet} feet away${stopped ? ` (${stopped})` : ""}`
    : `Repelling Blast: ${enemy.displayName} could not be pushed (${stopped})`;
}

// The conditions a feat's hit leaves on an enemy (feat-combat.ts): Stunning
// Sniper's stun; Slasher's hamstring (speed -10) once a turn and its critical
// hit's shaken (disadvantage on attacks); Crusher's 5-foot shove once a turn
// and its critical hit's exposed (attacks against it at advantage). Each lasts
// until the start of the attacker's next turn.
function featHitMarks(scene: SwingScene, record: AttackRecord, crit: boolean, stunShot: boolean): string[] {
  const { campaign, sheet, enemy } = scene;
  const notes: string[] = [];
  const leave = (name: string): boolean => {
    const fresh = getFoe(enemy.id);
    if (!fresh || fresh.status !== "alive" || fresh.conditions.includes(name)) {
      return false;
    }
    patchEnemyConditions(fresh.id, [...fresh.conditions, name], { ...fresh.conditionMeta, [name]: { source: sheet.id, untilTurnOf: sheet.id } });
    return true;
  };
  if (stunShot && leave("stunned")) {
    notes.push(`Stunning Sniper: ${enemy.displayName} is stunned until the start of ${sheet.name}'s next turn`);
  }
  const typeFeat = record.typeFeat;
  if (typeFeat === "Slasher") {
    if (attackTurn(campaign.id, record) && !hasTurnMark(campaign.id, record, SLASHER_USED) && leave("hamstrung")) {
      markAttackTurn(campaign.id, record, SLASHER_USED);
      notes.push(`Slasher: ${enemy.displayName}'s speed is reduced by 10 feet until the start of ${sheet.name}'s next turn`);
    }
    if (crit && leave("shaken")) {
      notes.push(`Slasher: the critical hit puts ${enemy.displayName}'s attack rolls at disadvantage until the start of ${sheet.name}'s next turn`);
    }
  } else if (typeFeat === "Crusher") {
    const encounter = getActiveEncounter(campaign.id);
    if (encounter && markAttackTurn(campaign.id, record, CRUSHER_USED)) {
      const pushed = pushTokenAway(campaign, encounter.id, sheet.id, enemy.id);
      notes.push(
        pushed.moved
          ? `Crusher: ${enemy.displayName} is moved 5 feet to (${pushed.at.x},${pushed.at.y})`
          : `Crusher: ${enemy.displayName} could not be moved 5 feet (${pushed.reason})`,
      );
    }
    if (crit && leave("exposed")) {
      notes.push(`Crusher: the critical hit leaves ${enemy.displayName} exposed; attacks against it have advantage until the start of ${sheet.name}'s next turn`);
    }
  }
  if (notes.length) {
    // The conditions above were seen by the enemy's copy; the encounter's own
    // list is published by the patch.
    publishEncounter(campaign.id);
  }
  return notes;
}

function hasTurnMark(campaignId: string, record: AttackRecord, key: string): boolean {
  return attackTurn(campaignId, record)?.budget.oncePerTurn.includes(key) ?? true;
}

// A roll the server throws for an attack goes to every seat as a card.
export function publishRoll(campaignId: string, roll: StoredRoll) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}
