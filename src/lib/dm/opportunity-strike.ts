// The attack itself of an opportunity attack, for both sides, once
// opportunity.ts has found that one is provoked and spent the reaction. An
// opportunity attack is an attack like any other (SRD 5.1): the enemy's
// blow runs the whole damage path a character takes damage by
// (src/lib/dm/pc-damage.ts), and a character's swing carries what their
// attack carries on their own turn (Rage, a magic weapon, Sneak Attack,
// Hunter's Mark, Bless) and lands through applyEnemyDamage, so a creature it
// kills leaves the board and its concentration is tested. The fight itself
// stays open when the last foe falls to one: its end and XP wait for the
// DM's next turn (ODM's rule).
//
// The move route that provokes these has no DM turn, and the damage paths
// keep their rolls and audit rows on one, so a short human-DM turn is
// opened for the swing and closed with it.

import { holdsFeature } from "@/lib/srd/feature-names";
import { getFoe } from "@/lib/dm/sheet-foe";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { openLastHit } from "@/lib/dm/last-hit";
import { hasSentinel } from "@/lib/srd/feat-combat";
import { attackerUnseen, tryParry } from "@/lib/dm/enemy-reactions";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { XY } from "@/lib/battlemap/types";
import { closeStandInTurn, openStandInTurn, type DmTurn } from "@/lib/db/dm-turns";
import { orderEntryId, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll, markRollApplied } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { d20Expression, type Advantage } from "@/lib/dice";
import { rollCharacterD20 } from "@/lib/dm/character-roll";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { healthState } from "@/lib/bestiary/health";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { coverFor } from "@/lib/dm/attack-spatial";
import { isPactWeapon } from "@/lib/srd/pact-weapon";
import { textKey } from "@/lib/language/text-logic";
import { attackSenses, attackSight, characterSenses, enemySenses, fearAsRolled, lightOnAttack } from "@/lib/dm/attack-light";
import { adjudicateHit, weaponAttackProfile, type AttackProfile, type ResolvedWeapon } from "@/lib/dm/attack-logic";
import { landNaturalOnHit } from "@/lib/dm/natural-onhit";
import { weaponMaterial } from "@/lib/dm/damage-logic";
import { lineNamed } from "@/lib/srd/item-row";
import { endInvisibilityOnCast, planMarks, writeMarks } from "@/lib/dm/attack-marks";
import {
  attackContext,
  exhaustionRollState,
  mergeAdvantage,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { critDamageExpression, ordinaryOfCritical } from "@/lib/dm/encounter-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { hexWarriorSwing, shillelaghSwing } from "@/lib/dm/attack-features";
import { isUndeadOrFiend, otherHandArmed, smiteDice } from "@/lib/dm/attack-rules";
import { wearsUntrainedArmor } from "@/lib/srd/armor";
import { liftsSmallHeavyPenalty } from "@/lib/srd/feat-combat";
import { gearCritRiders, itemRidersAgainst } from "@/lib/dm/gear-attack";
import { foldDamageRiders, landBlow, strikesAsMagic, withSneakAttack } from "@/lib/dm/pc-attack-damage";
import { clearHitSpent, spendOnHit } from "@/lib/dm/pc-attack-riders";
import { smiteSlotOf } from "@/lib/dm/opportunity-ask-logic";
import { opportunityTwoHanded } from "@/lib/dm/opportunity-weapon";
import { woundOnHit } from "@/lib/dm/sword-wounding";
import { acBreakdownFor, computeSheetDerived, sizeForRace } from "@/lib/srd";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { conditionsSpentAgainst } from "@/lib/srd/condition-effect-queries";
import { combatRiders, hasHalflingLuck } from "@/lib/srd/feature-effects";
import { magicItemRiders } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { markOpportunityHit } from "@/lib/dm/authored-reactions-more";
import { enemyExhaustion, hasTrait } from "@/lib/dm/monster-abilities";
import { inDirectSunlight } from "@/lib/dm/sunlight";

// A turn for the swing's rolls and audit rows, closed as soon as it is used
// so nothing waits on it.
export function withOpportunityTurn<T>(campaignId: string, run: (turn: DmTurn) => T): T {
  const turn = openStandInTurn(campaignId);
  try {
    return run(turn);
  } finally {
    closeStandInTurn(turn);
  }
}

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// The light between a reactor and the creature leaving: null off the board.
// The attack is made "right before the creature leaves your reach" (SRD 5.1,
// Opportunity Attacks), so the mover is seen at `moverAt`, the tile it left
// the reach from (opportunity-reach-logic.ts leavesReachAt), not at the
// square its token has already landed on. Every opportunity door passes it.
export function opportunitySight(input: {
  campaignId: string;
  encounterId: string;
  enemy: EncounterEnemy;
  sheet: CharacterSheet;
  enemyReacts: boolean;
  moverAt: XY | null;
}) {
  const enemySide = { refId: input.enemy.id, senses: enemySenses(input.enemy), at: input.enemyReacts ? null : input.moverAt };
  const sheetSide = { refId: input.sheet.id, senses: characterSenses(input.sheet), at: input.enemyReacts ? input.moverAt : null };
  return attackSight({
    campaignId: input.campaignId,
    encounterId: input.encounterId,
    attacker: input.enemyReacts ? enemySide : sheetSide,
    target: input.enemyReacts ? sheetSide : enemySide,
  });
}

// A character's opportunity attack on an enemy breaking away, or on a
// character of the other side (issue 503). Returns the table line. A swing
// at a character leaves the record its reactions answer, as an enemy's
// attack does (last-hit.ts): Shield, Uncanny Dodge, Riposte on a miss.
// Whose turn a swing lands in, for what holds only for what is left of that
// turn (Sentinel's stop): the walker's own when it is taking it (handed over, or held
// for it), otherwise the one the pointer is on. Written as begun, so that
// turn's end takes it (turn-end.ts). It was written as the walker's NEXT
// turn: a goblin a Sentinel stopped on its way out stood still through its
// whole next turn too, and could not flee on it either.
function turnUnderWay(encounter: Encounter, walkerId: string): string {
  const legendary = encounter.legendary;
  if ((legendary.due ?? []).includes(walkerId) || (legendary.handoff?.enemyIds ?? []).includes(walkerId)) {
    return walkerId;
  }
  const entry = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return entry ? orderEntryId(entry) : walkerId;
}

// The profile of a weapon swung as the reaction, as the turn's swing builds
// it (pc-attack-profile.ts).
function weaponSwing(sheet: CharacterSheet, resolved: ResolvedWeapon, riders: ReturnType<typeof combatRiders>): AttackProfile {
  const derived = computeSheetDerived(sheet);
  const shillelagh = shillelaghSwing(sheet, resolved, derived);
  // Hex Warrior's Charisma, as on the turn's swing (pc-attack-profile.ts).
  const hexed = shillelagh ? null : hexWarriorSwing(sheet, resolved, derived);
  // SRD 5.1, Pact of the Blade: "You are proficient with it while you wield
  // it", on the reaction's swing as on the turn's (pc-attack-profile.ts). A
  // warlock's pact longsword struck without the bonus.
  const pactForm = resolved.srd && isPactWeapon(sheet, resolved.displayName, resolved.srd.kind === "melee") ? [textKey(resolved.srd.name)] : [];
  const profile = weaponAttackProfile(shillelagh?.derived ?? hexed?.derived ?? derived, [...sheet.proficiencies.weapons, ...pactForm], shillelagh?.resolved ?? resolved, {
    riders,
    martialArts: martialArtsApplies(sheet),
    // A worn item's bonus rides the reaction's swing as it does the turn's.
    worn: magicItemRiders(sheet.equipment, sheet).weaponRiders,
    // Dueling wants the other hand empty of weapons, here as on the turn.
    otherWeaponInHand: otherHandArmed({ equipment: sheet.equipment, weapon: resolved.displayName, shieldName: acBreakdownFor(sheet).shieldName }),
    // A versatile weapon in both hands when the other is free (opportunity-weapon.ts).
    twoHanded: opportunityTwoHanded(sheet, resolved, riders),
  });
  // The blade's material (a silvered sword), for the resistances that name
  // it, as the turn's swing carries it (pc-attack-profile.ts): the reaction
  // left it off, and a werewolf resisted a silvered sword's opportunity
  // attack.
  const material = weaponMaterial(sheet.equipment[lineNamed(sheet.equipment, resolved.displayName)]);
  return { ...profile, material, ...(shillelagh ? { magicWeapon: true } : {}) };
}

// The slot Divine Smite would spend on a character's opportunity attack, or
// null: a paladin's swing may carry it, as the turn's melee hit may.
export function opportunitySmiteSlot(sheet: CharacterSheet): number | null {
  return combatRiders(sheet).canSmite ? smiteSlotOf(sheet.spellcasting) : null;
}

export function pcOpportunitySwing(input: {
  campaign: Campaign;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  resolved: ResolvedWeapon | null;
  // A beast form's or a summoned creature's own attack, in place of a
  // weapon (opportunity-natural.ts).
  natural?: AttackProfile | null;
  adjacent: boolean;
  // The target's conditions as the swing meets them (a Dodge lost with its
  // speed already left out, opportunity.ts withLiveDodge).
  targetConditions: string[];
  // The tile the walker left the reach from (opportunitySight).
  moverAt: XY | null;
  // Divine Smite's slot, when the player took it on the card
  // (opportunity-ask.ts): paid only on a hit.
  smiteSlot?: number;
}): { note: string; dropped: boolean } {
  const { campaign, encounter, sheet, enemy, resolved } = input;
  const natural = input.natural ?? null;
  const kind = natural ? "natural" : "weapon";
  const riders = combatRiders(sheet);
  let profile = natural ?? weaponSwing(sheet, resolved!, riders);
  // What rides the swing, as on the character's own turn: Rage, the on-hit
  // dice of their effects (a mark only on its creature), their features.
  const marks = planMarks({ sheet, enemy, encounterEnemies: [enemy], budget: null });
  const folded = foldDamageRiders({
    campaignId: campaign.id,
    sheet,
    profile,
    riders,
    kind,
    enemy,
    marked: marks.applies,
  });
  // A magic weapon's dice against this creature, each kept at its own type
  // (a Flame Tongue's fire), as on the character's own turn
  // (src/lib/dm/gear-attack.ts).
  const gear = itemRidersAgainst(folded.profile, enemy.stats.type, false);
  profile = gear.profile;
  const typedRiders = [...folded.typedRiders, ...gear.typed];

  // Fear only with its source in sight, a Dodge only against an attacker
  // the dodger sees (attack-light.ts), as on pc_attack.
  const sight = opportunitySight({ campaignId: campaign.id, encounterId: encounter.id, enemy, sheet, enemyReacts: false, moverAt: input.moverAt });
  const context = attackContext({
    ...attackSenses(encounter.id, { refId: sheet.id, senses: characterSenses(sheet) }, { refId: enemy.id, senses: enemySenses(enemy), at: input.moverAt }),
    attackerConditions: fearAsRolled(encounter.id, sheet.id, sheet.conditions, sheet.conditionMeta),
    targetConditions: input.targetConditions,
    melee: true,
    adjacent: input.adjacent,
    requested: "none",
    targetSeesAttacker: sight?.targetSees !== false,
  });
  const light = lightOnAttack(sight, { attacker: sheet.name, target: enemy.displayName });
  const attackRiders = conditionRollRiders(sheet.conditions, "attack");
  // What the attacker's own body and gear do to any attack roll of theirs,
  // as pc-attack-situation.ts reads them for the turn's swing: armor worn
  // untrained, and a heavy weapon in Small hands, each disadvantage (SRD 5.1,
  // Armor; Weapons, Heavy). The reaction's swing skipped both.
  const untrained = wearsUntrainedArmor(sheet);
  const smallWithHeavy = profile.heavy && sizeForRace(sheet.race) === "Small" && !liftsSmallHeavyPenalty(sheet);
  const advantage: Advantage = mergeAdvantage([
    ...context.sources,
    ...(untrained || smallWithHeavy ? ["disadvantage" as const] : []),
    exhaustionRollState(sheet.exhaustion ?? 0, "attack").advantage,
    ...light.sources,
    ...attackRiders.advantageSources,
    ...(folded.attackEffect.advantage ? ["advantage" as const] : []),
    ...(folded.attackEffect.disadvantage ? ["disadvantage" as const] : []),
  ]);
  const notes: string[] = [];
  profile = withSneakAttack({
    encounterId: encounter.id,
    sheetId: sheet.id,
    enemyId: enemy.id,
    profile,
    riders,
    advantage,
    notes,
  }).profile;

  // Cover where the walker stood as the swing was made: an ally between a
  // glaive and a goblin 10 feet off gives half cover (SRD 5.1, Cover), as on
  // the turn's swing (pc-attack-situation.ts). The reaction read the bare AC.
  const cover = coverFor(encounter.id, sheet.id, enemy.id, input.moverAt ?? undefined);
  if (cover) {
    notes.push(`${enemy.displayName} has ${cover === 2 ? "half" : "three-quarters"} cover: +${cover} AC`);
  }
  const targetAc = enemyAcWithEffects(campaign.id, enemy) + cover;
  const hitLog = isSheetFoe(enemy) ? openLastHit(campaign.id, enemy.id) : null;
  const closeLog = () => hitLog?.close({ attacker: { kind: "sheet", id: sheet.id, name: sheet.name }, attack: `${profile.weapon} (opportunity attack)`, type: profile.damageType, ranged: false });
  // The character's own attack roll (src/lib/dm/character-roll.ts): on
  // physical dice their player rolls it, and a miss waits on what they hold,
  // as a pc_attack's does.
  const hitOutcome = rollCharacterD20(campaign, sheet, {
    kind: "attack",
    // A halfling's Lucky rerolls a natural 1 on any attack roll (SRD 5.1,
    // Halfling), this one too.
    expression: `${d20Expression(profile.toHit, advantage).replace(/^(\d+d20(?:k[hl]\d+)?)/, hasHalflingLuck(sheet) ? "$1r1" : "$1")}${attackRiders.diceSuffix}`,
    detail: rollAgainst(`${profile.weapon} (opportunity attack)`, enemy.displayName),
    advantage,
    attack: { ac: targetAc, critRange: riders.critRange ?? 20, melee: true },
  });
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: rollAgainst(`${profile.weapon} (opportunity attack)`, enemy.displayName),
    advantage,
    result: hitOutcome,
    attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
  });
  publishRoll(campaign.id, hitRoll);
  const judged = adjudicateHit(hitOutcome.total, hitOutcome.crit, targetAc, {
    natural: hitOutcome.natural,
    critRange: riders.critRange,
  });
  // Parry: the creature's reaction lifts its AC against a melee hit (enemy-reactions.ts).
  const parry = judged.hit && !judged.crit ? tryParry({ encounter, enemy, total: hitOutcome.total, natural20: false, ac: targetAc, melee: true, attackerUnseen: attackerUnseen(sheet.conditions, enemy.conditions, sight) }) : null;
  const adjudicated = parry ? { ...judged, hit: false, crit: false } : judged;
  spendAttackCarriers(campaign, sheet, enemy, attackRiders.spent);
  // Relentless Avenger answers the hit (src/lib/dm/authored-reactions-more.ts).
  if (adjudicated.hit) {
    markOpportunityHit(campaign, sheet);
    // Sentinel: the creature's speed is 0 for the rest of the turn.
    if (hasSentinel(sheet)) {
      const fresh = getFoe(enemy.id);
      if (fresh && !fresh.conditions.includes("stopped")) {
        patchEnemyConditions(fresh.id, [...fresh.conditions, "stopped"], { ...fresh.conditionMeta, stopped: { source: sheet.id, untilTurnEndOf: turnUnderWay(encounter, fresh.id), turnBegun: true } });
        notes.push("Sentinel: its speed is 0 for the rest of the turn");
      }
    }
    // Hold the Line (Cavalier 10): "a creature you hit with an opportunity
    // attack has its speed reduced to 0 until the end of the current turn".
    if (holdsFeature(sheet, "Hold the Line")) {
      const fresh = getFoe(enemy.id);
      if (fresh && !fresh.conditions.includes("held in place")) {
        patchEnemyConditions(fresh.id, [...fresh.conditions, "held in place"], { ...fresh.conditionMeta, "held in place": { source: sheet.id, rounds: 1 } });
        notes.push("Hold the Line: its speed is 0 for the rest of the turn");
      }
    }
  }
  if (!adjudicated.hit) {
    hitLog?.swing(hitOutcome, targetAc, { hit: false, crit: false, raw: 0, advantage, ranged: false });
    closeLog();
    return {
      note: `${sheet.name} swings at ${enemy.displayName} as it breaks away and misses (${hitOutcome.total} vs AC ${targetAc}${parry ? `; ${parry.note}` : ""}).`,
      dropped: false,
    };
  }
  const crit = adjudicated.crit || context.autoCrit;
  // A natural 20's magic weapon dice (a Vicious Weapon's 2d6).
  const critGear = hitOutcome.crit === "nat20" ? gearCritRiders(profile, enemy.stats.type) : null;
  if (critGear?.suffix) {
    profile = { ...profile, damageExpression: `${profile.damageExpression}${critGear.suffix}` };
    typedRiders.push(...critGear.typed);
  }
  // SRD 5.1, Divine Smite: "when you hit a creature with a melee weapon
  // attack, you can expend one spell slot", and an opportunity attack is
  // one. Paid on the hit as the turn's swing pays it (pc-attack-riders.ts
  // spendOnHit), its dice radiant and doubled with the rest on a critical.
  if (input.smiteSlot && !natural) {
    const undeadOrFiend = isUndeadOrFiend(enemy);
    const dice = smiteDice(input.smiteSlot, undeadOrFiend);
    const spends = { characterId: sheet.id, smite: { slot: input.smiteSlot, dice, undeadOrFiend }, baseDamage: profile.damageExpression, critExtraDice: riders.critExtraDice };
    const paid = withOpportunityTurn(campaign.id, (turn) => {
      const sheets = listSheets(campaign.id);
      return spendOnHit(campaign, turn.id, spends, sheets, new Map(sheets.map((entry) => [entry.id, entry])));
    });
    notes.push(...paid.notes);
    if (paid.suffix) {
      profile = { ...profile, damageExpression: `${profile.damageExpression}${paid.suffix}` };
      typedRiders.push({ dice: `${dice}d8`, type: "radiant" });
      notes.push(`Divine Smite (level ${input.smiteSlot} slot): +${dice}d8 radiant${undeadOrFiend ? ", against an undead or fiend" : ""}`);
    }
  }
  clearHitSpent(campaign, sheet.id, folded.hitSpent);
  writeMarks(campaign.id, sheet.id, marks.assign);
  const damageOutcome = rollCharacterD20(campaign, sheet, {
    kind: "damage",
    tag: { roller: "hero", kind: "damage", who: sheet.name },
    expression: crit
      ? critDamageExpression(profile.damageExpression, riders.critExtraDice, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : profile.damageExpression,
    detail: rollAgainst(`${profile.weapon} (opportunity attack)`, enemy.displayName),
  });
  const dealt = Math.max(0, damageOutcome.total);
  return withOpportunityTurn(campaign.id, (turn) => {
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(`${profile.weapon} (opportunity attack)`, enemy.displayName),
      result: damageOutcome,
      attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
    });
    publishRoll(campaign.id, damageRoll);
    const sheets = listSheets(campaign.id);
    const applied = landBlow({
      campaign,
      turn,
      encounter,
      enemy,
      sheets,
      sheetsById: new Map(sheets.map((entry) => [entry.id, entry])),
      profile,
      typedRiders,
      damageOutcome,
      dealt,
      crit,
      critExtraDice: riders.critExtraDice,
      magical: strikesAsMagic({ kind, profile, riders, sheet }),
      holdVictory: true,
    });
    if (!("error" in applied)) {
      markRollApplied(damageRoll.id, enemy.id);
    }
    // A critical's normal figure, for Sentinel at Death's Door (last-hit.ts); a
    // natural 20's gear dice belong to the critical, so none is read past them.
    const normalRoll = hitLog && crit && !critGear?.suffix
      ? ordinaryOfCritical(damageOutcome, profile.damageExpression, { multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods, extraDice: riders.critExtraDice })
      : null;
    hitLog?.swing(hitOutcome, targetAc, {
      hit: true,
      crit,
      raw: dealt,
      advantage,
      type: profile.damageType,
      ranged: false,
      ...(normalRoll ? { normal: { raw: Math.max(0, normalRoll.total), from: dealt } } : {}),
      // As the blow met the damage path, for a reaction's replay (last-hit.ts flags).
      flags: { ...(strikesAsMagic({ kind, profile, riders, sheet }) ? { magical: true } : {}), ...(profile.material ?? {}) },
    });
    closeLog();
    const struck = getFoe(enemy.id);
    const dropped = Boolean(applied.dead) || struck?.status === "dead";
    // What a natural attack's hit carries (a wolf's bite: a Strength save or
    // prone), as the turn's swing lands it (attack-blow.ts).
    // A Sword of Wounding's wound, once per turn (sword-wounding.ts).
    const wound = !dropped && profile.gearWounds && !isSheetFoe(enemy) ? woundOnHit(campaign, enemy.id, sheet.id) : null;
    if (wound) {
      notes.push(wound);
    }
    if (!dropped && profile.creatureOnHit && !isSheetFoe(enemy)) {
      notes.push(...landNaturalOnHit(campaign, { turn, attacker: { kind: "sheet", sheetId: sheet.id, name: sheet.name }, holderId: sheet.id, attack: profile.weapon, enemyId: enemy.id, onHit: profile.creatureOnHit }));
    }
    const after = getFoe(enemy.id);
    const landed = typeof applied.damageApplied === "number" ? applied.damageApplied : dealt;
    return {
      note: `${sheet.name} catches ${enemy.displayName} with an opportunity attack as it breaks away: ${
        crit ? "a critical hit, " : ""
      }${landed} damage${notes.length ? ` (${notes.join("; ")})` : ""}. ${
        dropped
          ? `${enemy.displayName} drops.`
          : `It is now ${healthState(after?.currentHp ?? enemy.currentHp, enemy.maxHp)}.`
      }`,
      dropped,
    };
  });
}

// What the swing uses up: the attacker's hiding and Invisibility (an attack
// gives both away), their one-shot roll riders (True Strike), and the
// target's one-shot conditions (Guiding Bolt's advantage).
function spendAttackCarriers(campaign: Campaign, sheet: CharacterSheet, enemy: EncounterEnemy, riders: string[]) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const mine = [
    ...fresh.conditions.filter((entry) => entry.trim().toLowerCase() === "hidden"),
    ...riders,
  ];
  if (mine.length) {
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, mine);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  endInvisibilityOnCast(campaign.id, sheet.id);
  const theirs = conditionsSpentAgainst(enemy.conditions);
  if (theirs.length) {
    const target = getFoe(enemy.id);
    if (target) {
      const cleared = removeConditions(target.conditions, target.conditionMeta, theirs);
      patchEnemyConditions(target.id, cleared.conditions, cleared.meta);
      publishEncounter(campaign.id);
    }
  }
}

// What an enemy's own state does to its opportunity attack on a character,
// as enemy_attack reads it (enemy-swing-odds.ts, enemy-attack.ts): a spell
// on it (Bane's d4 off the roll, Bless's on), exhaustion 3 or more, and
// Sunlight Sensitivity in direct sunlight. The reaction's swing read only
// the conditions, so a Baned goblin's swing at a fleeing hero rolled whole.
export function enemyOpportunityRiders(campaignId: string, enemy: EncounterEnemy) {
  const riders = conditionRollRiders(enemy.conditions, "attack");
  const worn = enemyExhaustion(enemy.conditions) >= 3;
  const sunlit = hasTrait(enemy.stats, "sunlightSensitivity") && inDirectSunlight(campaignId);
  return {
    riders,
    sources: [...riders.advantageSources, ...(worn || sunlit ? ["disadvantage" as const] : [])],
    notes: [
      ...riders.notes,
      ...(worn ? [`exhaustion ${enemyExhaustion(enemy.conditions)}: disadvantage on attack rolls`] : []),
      ...(sunlit ? ["Sunlight Sensitivity: disadvantage in direct sunlight"] : []),
    ],
  };
}
