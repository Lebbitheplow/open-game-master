// enemy_attack: an enemy's action against a character, resolved from the
// enemy's real stat block against the target's real Armor Class. Split from
// encounter-tools.ts, which dispatches to it and whose auto-act fallback
// calls it for the enemies a turn skipped. Must not import encounter-tools.
//
// The target is any combatant (src/lib/dm/combatant.ts): a character goes
// the character path below, with all a sheet's defences; an enemy fighting
// on the other side (a creature the party dominates) is struck stat block
// against stat block (src/lib/dm/enemy-strike.ts).

import { parleyHolds } from "@/lib/dm/genre-cc-a-fixer";
import { endRageBound } from "@/lib/dm/rage-bound";
import { paBlowResists } from "@/lib/dm/genre-b-post-apocalyptic-blows";
import { hostileTo, resolveCombatant } from "@/lib/dm/combatant";
import { enemyStrikesEnemy } from "@/lib/dm/enemy-strike";
import { lashOutTarget } from "@/lib/dm/confusion";

import { weaponNamed } from "@/lib/srd/weapons";
import { readiedHolder } from "@/lib/dm/readied-release";
import { hitTraitDice } from "@/lib/dm/side-allies";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { mirrorImageDecoy, sanctuaryRefusal } from "@/lib/dm/spell-defenses";
import { enfeebledBlow, measureRetort, spellRetort, spendEnemyRiders } from "@/lib/dm/spell-retort";
import { joinRetorts, riderMarkOf, type WaitingAnswer } from "@/lib/dm/retort-logic";
import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  getEnemy,
  recordEncounterTarget,
  saveEncounter,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { planAttackFx } from "@/lib/battlemap/fx-plan";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { coverFor } from "@/lib/dm/attack-spatial";
import { bulwarkCoverRaise } from "@/lib/dm/genre-b-steampunk-cover";
import { canEnemyAct, markEnemyActed, markEnemyBonus } from "@/lib/dm/can-act";
import { enemyStrikesEcho } from "@/lib/dm/mt-fb-echo";
import { enemyStrikesBody } from "@/lib/dm/spirit-projection";
import { hasteActionOpen, slowedOut } from "@/lib/dm/enemy-actions";
import { heldTurnRefusal } from "@/lib/dm/flee-logic";
import { enemyTurnEntry, rangedBackstop, recordEnemyTurn, routineAttacksLeft } from "@/lib/dm/enemy-turn-logic";
import { attackHold, spellAttackHold } from "@/lib/dm/spell-planes";
import { reachThroughProblem } from "@/lib/dm/zone-rules";
import { critDamageExpression, ordinaryOfCritical } from "@/lib/dm/encounter-logic";
import { wornArmorTurnsCrits } from "@/lib/srd/armor";
import { resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { approachTarget, reachesThisTurn, spendEnemyAction, standUpIfProne } from "@/lib/dm/enemy-approach";
import { blowByType, resolveOnHit, scaledParts, sizedAttack } from "@/lib/dm/enemy-hit";
import { applyPcDamage, blowDefenses, meetDefenses, type BlowFlags } from "@/lib/dm/pc-damage";
import { thoughtShieldBack } from "@/lib/dm/thought-shield";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { hateAuraDamage } from "@/lib/dm/divine-auras";
import { alternativeBlow, attackNamed, charmedBy, enemyAttackProfile, pastRangedLimit, plannedSwings, swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { hasTrait, multiattackAbilities } from "@/lib/dm/monster-abilities";
import { enemySwingOdds, hasFeatureNamed } from "@/lib/dm/enemy-swing-odds";
import { openLastHit } from "@/lib/dm/last-hit";
import { authoredAfterHit } from "@/lib/dm/authored-hooks";
import { authoredWardSave } from "@/lib/dm/ar-wbf-warlock-ward";
import { critOnlyWhileUnconscious } from "@/lib/dm/condition-logic";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { sanctuaryWard } from "@/lib/dm/enemy-conditions";
import { naturesSanctuaryRefusal } from "@/lib/dm/srd-defenses";
import { conditionRollRiders, conditionTurnShape } from "@/lib/srd/condition-effects";
import { darkFantasyWeaponWard } from "@/lib/dm/genre-a-dark-fantasy-wards";
import { isImmersed, underwaterSwing } from "@/lib/dm/underwater";
import { swimsFrom } from "@/lib/battlemap/types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { badArguments, invalidArguments, noneNamed, toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { ADVANTAGE_SOURCES, claimedAdvantage } from "@/lib/dm/pc-attack-options";
import { unknownSheetRef } from "@/lib/dm/rolls";
import { mountTargetProblem, strikeMount } from "@/lib/dm/mount-combat";
import { petTargetProblem, strikePet } from "@/lib/dm/pet-strike";
import { riderTakesIt } from "@/lib/dm/ar-wbf-feat-doors";
import { enemySpellAttack } from "@/lib/dm/enemy-casting";
import { gripsHeldBy, swallowCover, swallowMark, swallowRefusal } from "@/lib/dm/swallow";
import { landSwing, landWaits, reactionCouldTurn } from "@/lib/dm/retort-wait";
import { swallowActionOf } from "@/lib/dm/swallow-logic";
import { sizeRank } from "@/lib/bestiary/enemy-numbers";
import { sheetSize } from "@/lib/srd";
import { fittedText } from "@/lib/dm/fitted-text";
import { cloudRuneAtHit, landTurnedBlow } from "@/lib/dm/cloud-rune";
import { chargeAttackOf, chargeBonusOf } from "@/lib/dm/charge-logic";
import { chargeAfterHit, chargeForHit, enemyRunFeet, withChargeDice } from "@/lib/dm/enemy-charge";
import { conditionsOf, PRONE } from "@/lib/dm/vitals-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

const attackArgsSchema = z.object({
  enemyId: z.string(),
  targetCharacterId: z.string(),
  attack: z.string().optional(),
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
  advantageSource: z.enum(ADVANTAGE_SOURCES).optional(),
  advantageReason: fittedText(200).optional(),
  // A melee blow meant to knock the character out (SRD 5.1, Knocking a
  // Creature Out): dropped to 0, they fall unconscious and stable.
  nonlethal: z.coerce.boolean().optional(),
  // At the target's mount instead (SRD 5.1, Controlling a Mount: "the
  // attacker can target you or the mount"): mount-combat.ts.
  targetMount: z.coerce.boolean().optional(),
  // At the target's pet instead, by its name: it stands in their square
  // (ruling D2) and is struck at its own AC (pet-strike.ts).
  targetPet: z.string().trim().min(1).max(60).optional(),
  // An attack-roll spell from its list (enemy-casting.ts enemySpellAttack):
  // paid as the casting is, its action, a slot or the legendary action that
  // bought it.
  spell: z.string().trim().max(80).optional(),
  // With no board to measure it: it ran straight at the target first, for a
  // Charge or a Pounce (enemy-charge.ts). On a board the squares decide.
  charged: z.coerce.boolean().optional(),
});

const liesProne = (conditions: string[]) => conditions.some((entry) => isConditionNamed(entry, PRONE));

// The profile the enemy walks in for: the shortest reach among the melee
// swings it is about to make, or the shortest range when every swing is
// ranged, so the whole routine lands from where it stops.
function leadProfile(profiles: EnemyAttackProfile[]): EnemyAttackProfile {
  const melee = profiles.filter((profile) => profile.melee);
  if (melee.length) {
    return melee.reduce((best, profile) => (profile.reachTiles < best.reachTiles ? profile : best));
  }
  return profiles.reduce((best, profile) => (profile.rangeTiles < best.rangeTiles ? profile : best));
}

// The attack the server's own play of an enemy's turn names (encounter-
// tools.ts playSkippedEnemy: the turns the AI GM left and "Play the rest for
// me" at a person's table). Its usual routine leads with a melee
// attack; when that cannot reach the target this turn, even after walking,
// and an attack of its action reaches from where it stands or steps to (a
// goblin's shortbow, a thug's heavy crossbow), it shoots instead of walking
// up and doing nothing; so too when an Antilife Shell bars the melee one.
// Undefined keeps the usual routine.
export function backstopAttack(campaign: Campaign, encounterId: string, enemy: EncounterEnemy, targetRef: string): string | undefined {
  const attacks = (enemy.stats.attacks.length ? enemy.stats.attacks : synthesizeStats(enemy.cr).attacks).filter((attack) => !attack.bonusAction);
  const traits = enemy.stats.traits ?? [];
  const planned = plannedSwings(enemy.stats, attacks, null);
  if (!planned.length) {
    return undefined;
  }
  const lead = leadProfile(planned.map((attack) => enemyAttackProfile(attack, traits)));
  const profileOf = (attack: EnemyAttack | null) => (attack ? enemyAttackProfile(attack, traits) : lead);
  // An Antilife Shell between them turns any melee attack away, a thrown
  // one in hand included; a ranged attack goes through it (SRD 5.1). Without
  // this the foe was sent on to the next target and, all of them inside,
  // made no attack though it held a bow.
  const shelled = reachThroughProblem(encounterId, enemy.id, targetRef, enemy.stats.type, enemy.displayName) !== null;
  const lands = (attack: EnemyAttack | null) => !(shelled && profileOf(attack).melee) && reachesThisTurn(campaign, encounterId, enemy, targetRef, profileOf(attack));
  return rangedBackstop(lead.melee, attacks, (attack) => profileOf(attack).ranged, lands)?.name ?? undefined;
}

// A legendary action that buys one attack (legendary-tools.ts) is exactly
// one swing, whatever the Multiattack says. Consumed when the swing is paid
// for, on the encounter about to be saved: taken before the refusals after
// it (name the attack, Antilife Shell, out of reach), a retry lost the
// legendary-only attacks and, no longer a single swing, made the whole
// Multiattack (issue #666).
function spendLegendaryStrike(encounter: { legendary: { strikes?: string[] } }, enemyId: string) {
  const strikes = encounter.legendary.strikes ?? [];
  const at = strikes.indexOf(enemyId);
  if (at >= 0) {
    encounter.legendary.strikes = [...strikes.slice(0, at), ...strikes.slice(at + 1)];
  }
}

export function handleEnemyAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The engine's own attacks (Confusion's random creature): `anySide` lets
  // the target be on the attacker's own side. `pickAttack`: the server plays
  // the turn and names no attack, so a creature held to one swing (Slow,
  // Confusion's lash-out, a legendary strike) makes its first one instead of
  // being refused for want of a name (issue #666: a confused goblin with a
  // scimitar and a shortbow never lashed out).
  engine: { anySide?: boolean; pickAttack?: boolean } = {},
): ToolResult {
  // An answer still waiting on the reaction to an earlier hit lands before
  // this attack: the attack is done after the hit, so a reaction's moment has
  // passed (retort-wait.ts), and an attacker it slays makes none. A call
  // through the dispatch door has landed it already; the server's own plays
  // (the backstop, a legendary option's swings) come here first.
  landWaits(campaign, turn, { tell: true });
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: enemy_attack works only in a fight. Call start_encounter first.", retry: true };
  }
  // A mark that rode a rage now over goes before the odds are read
  // (rage-bound.ts: Ancestral Protectors).
  endRageBound(campaign.id);
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch (error) {
    return badArguments("Invalid arguments: enemy_attack needs enemyId and targetCharacterId.", error, rawArguments);
  }
  const parsed = attackArgsSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidArguments("Invalid arguments: enemy_attack needs enemyId and targetCharacterId.", parsed.error, raw);
  }
  const args = parsed.data;
  const found = resolveEnemyRef(encounter.id, args.enemyId);
  if (!found) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  // A Swallow action (the behir's, the remorhaz's, a toad's, the
  // tarrasque's): one bite at a creature it grapples, which a hit swallows
  // (src/lib/dm/swallow.ts). The bite is the swing, the swallow its rider.
  const swallowing = !args.spell && args.attack ? swallowActionOf(found.stats, args.attack) : null;
  const swallowBite = swallowing ? attackNamed(found.stats.attacks, swallowing.attack ?? "") : null;
  if (swallowing && !swallowBite) {
    return { error: `${found.displayName}'s ${swallowing.entry} makes a ${swallowing.attack} attack its block does not list. Nothing was spent.`, retry: true };
  }
  if (swallowBite) {
    args.attack = swallowBite.name;
  }
  // An attack-roll spell: its use was checked and is paid as a casting
  // (its action, a slot, a legendary action), not as a swing.
  const cast = args.spell ? enemySpellAttack(campaign, found, args.spell, args.targetCharacterId) : null;
  if (cast && "error" in cast) {
    return cast;
  }
  // An attack the block prints among its Bonus Actions is the creature's
  // bonus action: one swing, beside its action, once a round.
  const printedBonus = !cast && Boolean(args.attack && attackNamed(found.stats.attacks, args.attack)?.bonusAction);
  // So is a Pounce's bite (a Trampling Charge's stomp) at the creature its
  // charge left prone this turn: "If the target is prone, the lion can make
  // one bite attack against it as a bonus action" (enemy-charge.ts).
  const pouncedOn = enemyTurnEntry(encounter, found.id).pouncedOn;
  const pounce = !cast && !printedBonus && args.attack && pouncedOn ? chargeBonusOf(found.stats, args.attack) : null;
  const bonus = printedBonus || pounce !== null;
  // One guard for the enemy side (src/lib/dm/can-act.ts): the dead, the
  // incapacitated and the surprised do nothing, and an action is one a round.
  // Haste's extra action, once its own is spent, is one weapon attack
  // (enemy-actions.ts, issue #621).
  const allowed = cast ? ({ ok: true } as const) : canEnemyAct({ enemy: found, encounter, kind: bonus ? "bonus" : "action" });
  // Its Multiattack folds in an ability it used this turn ("The dragon can
  // use its Frightful Presence. It then makes three attacks"): the routine's
  // attacks are that same action (monster-abilities.ts multiattackAbilities).
  const routineSwing = !allowed.ok && !bonus && !cast && allowed.reason === "already_acted" && routineAttacksLeft(enemyTurnEntry(encounter, found.id));
  const hasteSwing = !routineSwing && !allowed.ok && !bonus && allowed.reason === "already_acted" && hasteActionOpen(encounter, found);
  if (!allowed.ok && !hasteSwing && !routineSwing) {
    return toolError(allowed);
  }
  // Slow: an action or a bonus action on its turn, not both (SRD 5.1).
  const slow = slowedOut(encounter, found, bonus ? "bonus" : "action");
  if (slow) {
    return slow;
  }
  // A turn Command (approach, flee, halt, grovel) or Fear spends on running,
  // walking in or holding still has no attack in it, by action, bonus action
  // or a legendary strike (flee-logic.ts, issue #621).
  const commanded = heldTurnRefusal(found, "attack");
  if (commanded) {
    return { error: commanded, refused: "rules", stop: "commanded" };
  }
  // An Echo Knight's echo, named as the board names it, is no combatant: the
  // swing is rolled against its own armor class (mt-fb-echo.ts).
  const atEcho = cast ? null : enemyStrikesEcho(campaign, turn, encounter, found, args.targetCharacterId, args.attack);
  if (atEcho) {
    return atEcho;
  }
  // A Spirit Projection's body left on the board: a blow at the warlock's
  // own hit points, at advantage (spirit-projection.ts).
  const atBody = cast ? null : enemyStrikesBody(campaign, turn, encounter, found, args.targetCharacterId, args.attack);
  if (atBody) {
    return atBody;
  }
  // The target is any combatant (src/lib/dm/combatant.ts): a character on
  // either side, or an enemy fighting on the other one (a creature the party
  // dominates, a summon gone wild).
  const aimed =
    resolveCombatant(campaign.id, encounter, args.targetCharacterId) ??
    (() => {
      const named = sheets.find((sheet) => textKey(sheet.name) === textKey(args.targetCharacterId));
      return named ? resolveCombatant(campaign.id, encounter, named.id) : null;
    })();
  if (!aimed) {
    return unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets);
  }
  if (aimed.id === found.id) {
    return { error: `${found.displayName} cannot attack itself. Name the creature it attacks.`, retry: true };
  }
  // With no token there is no reach to fail, so the blow would land on someone
  // the fight goes on without.
  if (encounter.awayIds.includes(aimed.id)) {
    return { error: `${aimed.name} is not at this fight. Name someone who is, or call request_roll kind=initiative for them first if the story has brought them here.`, retry: true, stop: "target" };
  }
  // Confusion's lash-out (confusion.ts): one melee attack on the creature
  // its d10 picked, and no other, whichever side it is on.
  const lash = lashOutTarget(found, encounter.round);
  if (lash && aimed.id !== lash) {
    const picked = resolveCombatant(campaign.id, encounter, lash);
    return { error: `${found.displayName} is confused: this turn's attack is on ${picked?.name ?? "the creature Confusion picked"}, picked at random, and no other.`, refused: "rules" };
  }
  if (pounce) {
    const lying = aimed.kind === "enemy" ? aimed.enemy.conditions : conditionsOf(getSheetById(aimed.id) ?? { conditions: [], currentHp: 1 });
    if (aimed.id !== pouncedOn || !liesProne(lying)) {
      return {
        error: `${found.displayName}'s ${pounce.name} gives its bonus ${args.attack} only at the creature its charge struck this turn, while it lies prone. Nothing was spent.`,
        refused: "rules",
      };
    }
  }
  if (!engine.anySide && !lash && !hostileTo(encounter, { kind: "enemy", id: found.id }, { kind: aimed.kind, id: aimed.id })) {
    return {
      error: `${aimed.name} fights on ${found.displayName}'s side: enemy_attack does not strike an ally. Pick a creature on the other side.`,
      refused: "rules",
    };
  }
  // A creature on the other side (one the party dominates, a turncoat's
  // row) has the same cover inside a swallower, and is swallowed the same.
  const rowInside = aimed.kind === "enemy" ? swallowCover({ kind: "enemy", id: found.id }, { kind: "enemy", id: aimed.id }) : null;
  if (rowInside) {
    return { error: `${rowInside} Nothing was spent.`, retry: true, stop: "target" };
  }
  if (aimed.kind === "enemy" && swallowing) {
    const refused =
      swallowRefusal(campaign.id, found, { kind: "enemy", id: aimed.id }, swallowing) ??
      (swallowing.maxSize && sizeRank(aimed.enemy.stats.size ?? "medium") > sizeRank(swallowing.maxSize)
        ? `${aimed.name} is too big: ${found.displayName}'s ${swallowing.entry} takes a ${swallowing.maxSize} or smaller creature.`
        : null);
    if (refused) {
      return { error: `${refused} Nothing was spent.`, retry: true };
    }
  }
  if (aimed.kind === "enemy" && cast) {
    return { error: `${cast.use.name} is cast at a character here; strike a creature's row with its own attacks. Nothing was spent.`, retry: true };
  }
  if (aimed.kind === "enemy") {
    // Turned, calmed or fleeing, it strikes no creature on any side.
    const held = attackHold({ name: found.displayName, conditions: found.conditions });
    if (held) {
      return held;
    }
    if (charmedBy(found.conditions, found.conditionMeta, aimed.id)) {
      return { error: `${found.displayName} is charmed by ${aimed.name} and cannot attack it.`, retry: true, stop: "target" };
    }
    return enemyStrikesEnemy(campaign, turn, found, aimed.enemy, {
      ...(args.attack ? { attack: args.attack } : {}),
      // The claim is held to the rule the character path holds (enemy-swing-odds.ts).
      advantage: claimedAdvantage({ requested: args.advantage, source: args.advantageSource, reason: args.advantageReason, byAi: turn.actor === "ai" }).requested,
      single: bonus || hasteSwing || Boolean(lash) || Boolean(swallowing) || conditionTurnShape(found.conditions).slowed,
      bonus,
      haste: hasteSwing,
      ...(swallowing ? { swallowing: { maxSize: swallowing.maxSize } } : {}),
      ...(args.charged ? { charged: true } : {}),
      sheets,
      sheetsById,
    });
  }
  const target = getSheetById(aimed.id);
  if (!target) {
    return unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets);
  }
  // Refused before anything is spent: no mount, or one with no numbers.
  const unmounted = args.targetMount ? mountTargetProblem(campaign.id, target) : null;
  if (unmounted) {
    return { error: unmounted, retry: true };
  }
  // A pet the call names that the character does not have, or one down.
  const noPetThere = args.targetPet ? (args.targetMount ? { error: "Name the mount or the pet, not both.", retry: true as const } : petTargetProblem(target, args.targetPet)) : null;
  if (noPetThere) {
    return noPetThere;
  }
  // Mounted Combatant: the rider takes the attack aimed at the mount
  // (src/lib/dm/ar-wbf-feat-doors.ts).
  const riderTakes = args.targetMount ? riderTakesIt(target) : null;
  if (riderTakes) {
    args.targetMount = false;
  }
  // Swallowed: total cover against everything outside the creature that
  // swallowed them (swallow.ts).
  const inside = swallowCover({ kind: "enemy", id: found.id }, { kind: "sheet", id: target.id });
  if (inside) {
    return { error: `${inside} Nothing was spent.`, retry: true, stop: "target" };
  }
  if (swallowing) {
    const refused =
      swallowRefusal(campaign.id, found, { kind: "sheet", id: target.id }, swallowing) ??
      (swallowing.maxSize && sizeRank(sheetSize(target)) > sizeRank(swallowing.maxSize)
        ? `${target.name} is too big: ${found.displayName}'s ${swallowing.entry} takes a ${swallowing.maxSize} or smaller creature.`
        : null);
    if (refused) {
      return { error: `${refused} Nothing was spent.`, retry: true };
    }
  }
  // SRD 5.1, Charmed: a charmed creature cannot attack its charmer.
  if (charmedBy(found.conditions, found.conditionMeta, target.id)) {
    return {
      error: `${found.displayName} is charmed by ${target.name} and cannot attack them. It may attack someone else or take another action.`,
      retry: true,
      stop: "target",
    };
  }
  // Neutral Ground: a creature that accepted the fixer's parley (genre-cc-a-fixer.ts).
  if (parleyHolds(found, target.id)) {
    return {
      error: `${found.displayName} accepted ${target.name}'s parley and cannot attack them until their next turn. It may attack someone else or take another action.`,
      retry: true,
      stop: "target",
    };
  }
  // Calm Emotions, Fear's flight; a target Blink or Etherealness took away (spell-planes.ts).
  const spellHeld = spellAttackHold({ name: found.displayName, conditions: found.conditions }, target);
  if (spellHeld) {
    return spellHeld;
  }
  // Sanctuary turns the attacker away on a failed WIS save (spell-defenses.ts),
  // and a failure holds for the rest of its turn (enemy-conditions.ts).
  // SRD 5.1: it "must choose a new target or lose the attack", so the turn
  // the server plays tries the next one (stop "target").
  const sanctuary = sanctuaryWard(campaign.id, found, target, sanctuaryRefusal);
  if (sanctuary) {
    return { ...sanctuary, stop: "target" };
  }
  // Nature's Sanctuary turns a beast or plant away the same way (srd-defenses.ts).
  const natures = sanctuaryWard(campaign.id, found, target, naturesSanctuaryRefusal);
  if (natures) {
    return { ...natures, stop: "target" };
  }
  // A legendary action that bought an attack printed only among the legendary
  // actions (an ankheg queen's Acid Glob) may swing it, and only then.
  const owed = !cast && (encounter.legendary.strikes ?? []).includes(found.id);
  const attacks = cast
    ? [cast.attack]
    : [
        ...(found.stats.attacks.length ? found.stats.attacks : synthesizeStats(found.cr).attacks),
        ...(owed ? (found.stats.legendaryAttacks ?? []) : []),
      ];
  if (!attacks.length) {
    return { error: `${found.displayName} has no usable attacks; narrate a different action.`, retry: true };
  }
  const named = cast ? cast.attack : args.attack ? attackNamed(attacks, args.attack) : null;
  if (args.attack && !named) {
    return noneNamed(`${found.displayName} has no attack called`, args.attack, attacks.map((attack) => attack.name));
  }
  // The action's attacks: a bonus action's is never one of its swings.
  const actionAttacks = attacks.filter((attack) => !attack.bonusAction);
  if (!named && !actionAttacks.length) {
    return { error: `${found.displayName}'s attacks are bonus actions: name one in attack (${attacks.map((attack) => attack.name).join(", ")}).`, retry: true };
  }
  // Slow: no more than one attack on its turn, Multiattack or not (SRD 5.1).
  // A bonus action's attack is one swing, and spends no legendary strike.
  // Confusion's lash-out is one melee attack, not the routine.
  const strike = !bonus && !hasteSwing && !lash && owed;
  const single = Boolean(cast) || Boolean(swallowing) || bonus || hasteSwing || Boolean(lash) || strike || conditionTurnShape(found.conditions).slowed;
  // The one swing the server picks when it plays the turn: a lash-out's is
  // a melee attack (SRD 5.1, Confusion), any other its first.
  const picked =
    !named && single && engine.pickAttack && actionAttacks.length > 1
      ? (lash ? actionAttacks.find((attack) => enemyAttackProfile(attack, found.stats.traits ?? []).melee) : null) ?? actionAttacks[0]
      : null;
  // The Swallow action's bite carries the swallow (and the size it takes).
  const swung =
    named && swallowing ? { ...named, onHit: { ...(named.onHit ?? {}), swallow: true, ...(swallowing.maxSize ? { maxSize: swallowing.maxSize } : {}) } } : named;
  const asked = swung ?? picked;
  if (single && !asked && actionAttacks.length > 1) {
    return { error: `${found.displayName} makes one attack this turn: name it in attack (${actionAttacks.map((attack) => attack.name).join(", ")}).`, retry: true };
  }
  // Of several routines, the one whose swings land from here this turn
  // (enemy-profile.ts plannedSwings), each attack's reach asked once.
  const reachOf = new Map<EnemyAttack, boolean>();
  const reaches = (attack: EnemyAttack) => {
    if (!reachOf.has(attack)) {
      reachOf.set(attack, reachesThisTurn(campaign, encounter.id, found, target.id, enemyAttackProfile(attack, found.stats.traits ?? [])));
    }
    return reachOf.get(attack) === true;
  };
  const planned = plannedSwings(found.stats, bonus ? attacks : actionAttacks, asked, { single, rollCount: (dice) => rollExpression(dice).total, reaches });
  if (hasteSwing && planned.some((attack) => attack.spellAttack)) {
    return { error: `Haste's extra action is one weapon attack, and ${found.displayName}'s ${planned[0].name} is a spell attack. Nothing was spent.`, refused: "rules" };
  }
  const profiles = planned.map((attack) => enemyAttackProfile(attack, found.stats.traits ?? []));
  // Antilife Shell: no melee reaches through it (zone-rules.ts).
  const shell = leadProfile(profiles).melee ? reachThroughProblem(encounter.id, found.id, target.id, found.stats.type, found.displayName) : null;
  if (shell) {
    return { ...shell, stop: "target" };
  }

  // A prone creature stands before it acts, for half its speed (SRD 5.1,
  // Being Prone); with too little movement left it stays down.
  const { enemy, stood } = standUpIfProne(encounter.id, found);

  // Battle-map positions are authoritative: an attacker out of reach walks
  // in along a legal path (not closer to what it fears), and the attack is
  // refused when the target is still out of reach or range.
  // A decision point inside the enemy's turn (issue 264): while a
  // character holds a readied action, an enemy out of reach stays put.
  const spatial = approachTarget(campaign, encounter.id, enemy, target.id, leadProfile(profiles), readiedHolder(campaign.id));
  if (spatial.blocked) {
    // Where the walk left it and what its walk drew: dropped here, the model
    // heard of neither though the token had moved (issue #666).
    return {
      ...spatial.blocked,
      ...(spatial.movedTo ? { movedTo: spatial.movedTo } : {}),
      ...(spatial.opportunityAttacks?.length ? { opportunityAttacks: spatial.opportunityAttacks } : {}),
    };
  }
  // A walk that took it out of a grappled creature's reach let go.
  releaseGrapplesOutOfReach(campaign);
  // How far it ran straight at the target this turn, the walk in included,
  // for a Charge or a Pounce (enemy-charge.ts). A creature of one attack a
  // turn that names none makes the one its charge rides once the run is
  // long enough: a lion bounding at its prey claws, it does not bite.
  const ranFeet = enemyRunFeet(encounter.id, enemy.id, target.id, args.charged === true);
  const charging = !args.attack && !single && !found.stats.routines?.length && planned.length === 1 ? chargeAttackOf(found.stats, actionAttacks, ranFeet) : null;
  if (charging && !planned.includes(charging)) {
    // The routine's one swing, swapped where it stands.
    planned.splice(0, 1, charging);
    profiles.splice(0, 1, enemyAttackProfile(charging, found.stats.traits ?? []));
  }
  // The walk may have drawn an opportunity attack that killed it.
  const standing = resolveEnemyRef(encounter.id, enemy.id);
  if (!standing || standing.status !== "alive") {
    return {
      ok: true,
      attack: planned[0].name,
      target: target.name,
      swings: [],
      hit: false,
      opportunityAttacks: spatial.opportunityAttacks ?? [],
      note: `${enemy.displayName} was struck down on its way to ${target.name} and never made the attack.`,
    };
  }
  // Where the two stand after the approach, for the effect and the target
  // line every client draws (src/lib/battlemap/fx-plan.ts).
  const attackerPos = tokenPosition(campaign.id, enemy.id);
  const targetPos = tokenPosition(campaign.id, target.id);
  if (attackerPos && targetPos) {
    recordEncounterTarget(encounter.id, encounter.round, enemy.id, target.id);
  }
  const boardForWeather = getBattleMapForEncounter(encounter.id);
  // Cover protects whoever stands behind it.
  const cover = coverFor(encounter.id, enemy.id, target.id);
  // Bulwark Advance: a ranged swing at an ally behind the knight meets
  // three-quarters cover (genre-b-steampunk-cover.ts), set for each swing.
  let bulwark = 0;
  // Multiattack Defense (a Hunter's Defensive Tactics): once this creature
  // hits, +4 AC against its later attacks this turn.
  const multiattackDefense = hasFeatureNamed(target, /multiattack defense/i);
  let defended = 0;
  const targetAc = () => {
    const fresh = getSheetById(target.id) ?? target;
    return acWithEffects(campaign.id, fresh, enemy) + cover + bulwark + defended;
  };
  // A spell a character left on the creature (Bane's d4 off, Bless's d4 on)
  // counts on every swing, as it would on a character's attack.
  let riders = conditionRollRiders(standing.conditions, "attack");
  const notes: string[] = riderTakes ? [riderTakes] : [];
  if (stood) {
    notes.push(`${enemy.displayName} stands up (half its speed)`);
  }
  if (cover) {
    notes.push(`${target.name} has ${cover === 2 ? "half" : "three-quarters"} cover: +${cover} AC`);
  }
  notes.push(...riders.notes);

  // The action is spent by taking it, hit or miss. Read fresh: the walk up
  // to the target may have spent a character's reaction on this same row.
  // A spell's casting pays as a casting does (its slot, its action or the
  // legendary action that bought it), before the row is read.
  if (cast) {
    cast.use.commit();
  }
  const live = getActiveEncounter(campaign.id) ?? encounter;
  // An attack a legendary action bought is not a turn of the creature's,
  // and a bonus action's is its bonus action.
  if (cast) {
    // Paid above.
  } else if (bonus) {
    markEnemyBonus(live, enemy.id);
  } else if (hasteSwing) {
    recordEnemyTurn(live, enemy.id, { hasteUsed: true });
  } else if (routineSwing) {
    recordEnemyTurn(live, enemy.id, { routineSwung: true });
  } else if (single) {
    if (strike) {
      spendLegendaryStrike(live, enemy.id);
    }
    markEnemyActed(live, enemy.id);
  } else {
    spendEnemyAction(live, enemy.id);
    // The ability the routine folds in is still to come in this action.
    if (multiattackAbilities(found.stats).length) {
      recordEnemyTurn(live, enemy.id, { routineSwung: true });
    }
  }
  saveEncounter(live);
  // At the mount or the pet beside them, the routine's swings each from
  // where the creature stands: its reach, its range, its bloodied blow.
  const swingsBeside = (what: string) => {
    const bloodied = standing.currentHp <= standing.maxHp / 2;
    let shots = 0;
    return planned.map((attack, index) => {
      const mode = swingMode(profiles[index], spatial.distance);
      if (!mode) {
        return { attack, skipped: `${what} is out of this attack's reach` };
      }
      const past = mode.ranged ? pastRangedLimit(found.stats.traits, attack, shots) : null;
      if (past) {
        return { attack, skipped: past };
      }
      shots += mode.ranged ? 1 : 0;
      return { attack: alternativeBlow(attack, { ranged: mode.ranged, bloodied }), ranged: mode.ranged };
    });
  };
  const requested = () => claimedAdvantage({ requested: args.advantage, source: args.advantageSource, reason: args.advantageReason, byAi: turn.actor === "ai" }).requested;
  // At the pet: its own AC, conditions, save and hit points (pet-strike.ts).
  if (args.targetPet) {
    return strikePet({ campaign, turn, encounterId: encounter.id, enemy: standing, owner: target, petName: args.targetPet, swings: swingsBeside(`${target.name}'s ${args.targetPet}`), distance: spatial.distance, cover, requested: requested() });
  }
  // At the mount: its own AC, hit points and Dodge (mount-combat.ts). The
  // rider's own wards and reactions answer attacks on the rider only.
  if (args.targetMount) {
    return strikeMount({
      campaign,
      turn,
      encounterId: encounter.id,
      enemy: standing,
      rider: target,
      swings: swingsBeside(`${target.name}'s mount`),
      distance: spatial.distance,
      cover,
      requested: requested(),
      sheets,
      sheetsById,
    });
  }
  // Among the Dead: an undead saves before it may attack this warlock, and on
  // a failure the attack is lost (src/lib/dm/authored-hooks.ts).
  const warded = authoredWardSave(campaign, turn, standing, target);
  if (warded.lost) {
    return { ok: true, attack: planned[0].name, target: target.name, swings: [], hit: false, note: warded.lost };
  }
  if (warded.note) {
    notes.push(warded.note);
  }
  const hitLog = openLastHit(campaign.id, target.id);

  // The routine executes in this ONE call, each swing its own to-hit and
  // damage dice cards, stopping early if the target drops.
  const swings: Array<Record<string, unknown>> = [];
  // Martial Advantage is once a turn: this call is the creature's turn.
  let martialSpent = false;
  let dropped = false;
  let totalDamage = 0;
  // What the target took of it, past its defenses: Emissary of Redemption
  // answers "half the damage you take from it", not half the blow.
  let takenTotal = 0;
  let targetHp: string | undefined;
  const damageTypes = new Set<string>();
  let lastSwing: { attack: EnemyAttack; ranged: boolean } | null = null;
  // A routine step that follows only a hit (the grick's beak) is skipped
  // after a miss.
  let previousHit = false;
  const attackerSubmerged = isImmersed(campaign.id, enemy.id);
  // The swings made at range, held to what a Multiattack of melee attacks
  // leaves room for (enemy-profile.ts rangedSwingsAllowed).
  let shots = 0;
  // What a waiting answer said as it landed between swings (retort-wait.ts),
  // and why the creature swings no more once one, or an answer at once,
  // slew it.
  const answersLanded: string[] = [];
  let fallen: string | null = null;
  // Whether a reaction could still turn every hit of the attack: a
  // retaliation for the whole of it that would slay waits then too.
  let hitAny = false;
  let everyHitTurnable = true;
  planned.forEach((plannedAttack: EnemyAttack, index) => {
    let attack = plannedAttack;
    if (dropped) {
      return;
    }
    // The swing before is past its reaction now (SRD 5.1, Reactions: taken
    // right after the trigger): what waited on it lands before the creature
    // swings again, and one an answer slew makes no more attacks. Before, the
    // routine went on swinging: a goblin Fire Shield had burnt to death, or
    // whose death waited on Shield, still made its second attack.
    if (index > 0 && !fallen) {
      hitLog.rewrite((swing) => landSwing(campaign, turn, swing, answersLanded, sheets, sheetsById));
      const now = getEnemy(enemy.id);
      if (!now || now.status !== "alive" || now.currentHp <= 0) {
        fallen = `${enemy.displayName} fell to what answered its earlier swing and makes no more attacks`;
      }
    }
    if (fallen) {
      swings.push({ attack: attack.name, skipped: fallen });
      return;
    }
    // Swallowed by an earlier swing of this routine (or by anything since
    // the call began): total cover from outside, the creature's own swings
    // included (swallow.ts).
    const inside = index > 0 ? swallowCover({ kind: "enemy", id: found.id }, { kind: "sheet", id: target.id }) : null;
    if (inside) {
      swings.push({ attack: attack.name, skipped: inside });
      dropped = true;
      return;
    }
    if (attack.onlyIfHit && !previousHit) {
      swings.push({ attack: attack.name, skipped: "it follows only a hit, and the attack before it missed" });
      return;
    }
    previousHit = false;
    const mode = swingMode(profiles[index], spatial.distance);
    if (!mode) {
      swings.push({ attack: attack.name, skipped: `${target.name} is out of this attack's reach` });
      return;
    }
    const past = mode.ranged ? pastRangedLimit(standing.stats.traits, plannedAttack, shots) : null;
    if (past) {
      swings.push({ attack: attack.name, skipped: past });
      return;
    }
    shots += mode.ranged ? 1 : 0;
    const ranged = mode.ranged;
    bulwark = ranged ? bulwarkCoverRaise(encounter.id, enemy.id, target.id, cover) : 0;
    // What the block deals instead at half its hit points or at range (a
    // swarm's weaker bite, a spear thrown), from here on the swing's blow.
    attack = alternativeBlow(plannedAttack, { ranged, bloodied: standing.currentHp <= standing.maxHp / 2 });
    // Under the water (underwater.ts): a shot past normal range misses, and
    // weapons not made for the water swing at disadvantage.
    const underwater = attackerSubmerged
      ? underwaterSwing({ weapon: attack.name, base: weaponNamed(attack.name)?.name, melee: !ranged, swims: swimsFrom(standing.stats.speed), beyondNormal: mode.longRange, spell: attack.spellAttack })
      : null;
    if (underwater?.misses) {
      swings.push({ attack: attack.name, skipped: underwater.note });
      return;
    }
    // Arrows and bolts into a Wind Wall are deflected and miss (SRD 5.1); a
    // spell attack is no projectile.
    if (ranged && !attack.spellAttack && spatial.deflected) {
      swings.push({ attack: attack.name, hit: false, missed: spatial.deflected });
      return;
    }
    lastSwing = { attack, ranged };
    // Every source of advantage on this swing (src/lib/dm/enemy-swing-odds.ts).
    const odds = enemySwingOdds({
      campaign,
      turn,
      encounterId: encounter.id,
      standing,
      target,
      requested: args,
      ranged,
      longRange: mode.longRange,
      distance: spatial.distance,
      outdoorsOnMap: Boolean(attackerPos && targetPos && boardForWeather?.outdoors),
      underwater,
      riders,
      defended,
    });
    const { advantage, authored } = odds;
    // At a target lying at 0, the roll it would have made at them standing:
    // a reaction that leaves them up when this swing lands reads the hit
    // again with it (last-hit.ts standingAdvantage).
    const downed = (getSheetById(target.id) ?? target).currentHp <= 0;
    const standingAdvantage = downed
      ? enemySwingOdds({
          campaign,
          turn,
          encounterId: encounter.id,
          standing,
          target,
          requested: args,
          ranged,
          longRange: mode.longRange,
          distance: spatial.distance,
          outdoorsOnMap: Boolean(attackerPos && targetPos && boardForWeather?.outdoors),
          underwater,
          riders,
          defended,
          standingTarget: true,
        }).advantage
      : undefined;
    for (const note of odds.notes) {
      if (!notes.includes(note)) {
        notes.push(note);
      }
    }
    const hitOutcome = rollExpression(`${d20Expression(attack.toHit + odds.attackBonus, advantage)}${riders.diceSuffix}`, undefined, {
      purpose: { roller: "enemy", kind: "attack", who: enemy.displayName },
    });
    // A one-shot rider (Vicious Mockery) is spent by the roll it rode (spell-retort.ts).
    riders = spendEnemyRiders(standing, riders);
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "attack",
      detail: rollAgainst(attack.name, target.name),
      advantage,
      result: hitOutcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    turn.rollIds.push(hitRoll.id);

    // Mirror Image: a duplicate may take the attack instead.
    const decoy = mirrorImageDecoy(campaign.id, target.id, hitOutcome.total, enemy);
    if (decoy) {
      swings.push({ attack: attack.name, rolled: hitOutcome.total, hit: false, duplicate: decoy });
      return;
    }
    const natCrit = hitOutcome.crit === "nat20";
    const hit = hitOutcome.crit !== "nat1" && (natCrit || hitOutcome.total >= targetAc());
    // Adamantine Armor turns a critical hit into a normal one (srd/armor.ts).
    const crit = (natCrit || (hit && odds.autoCrit)) && !wornArmorTurnsCrits(target.equipment ?? []) && !authored.noCrit;
    if (!hit) {
      hitLog.swing(hitOutcome, targetAc(), { hit: false, crit: false, raw: 0, advantage, ranged, attack: attack.name });
      swings.push({
        attack: attack.name,
        rolled: hitOutcome.total,
        hit: false,
        ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      });
      if (attackerPos && targetPos && !attackerPos.hidden) {
        publishFx(
          campaign.id,
          planAttackFx({
            from: attackerPos.at,
            to: targetPos.at,
            fromTokenId: attackerPos.tokenId,
            toTokenId: targetPos.tokenId,
            hit: false,
            crit: false,
            fumble: hitOutcome.crit === "nat1",
            ranged,
            damageType: attack.type,
            visibility: hitRoll.visibility,
          }),
        );
      }
      return;
    }

    // Aura of Hate: a fiend or undead within an oathbreaker's aura adds the
    // paladin's Charisma to its melee weapon blows (divine-auras.ts).
    const hate = ranged || attack.spellAttack ? null : hateAuraDamage(campaign.id, standing);
    // An active effect's amount on its damage rolls (set_effect), once.
    const effectDamage = effectOutcome(campaign.id, { kind: "enemy", id: standing.id }, "damage").bonus + (hate?.bonus ?? 0);
    // Ray of Enfeeblement halves a Strength weapon's blow (spell-retort.ts).
    const shrunk = (amount: number) => Math.floor(enfeebledBlow(standing, attack, ranged, Math.max(0, amount)) / (authored.halve ? 2 : 1));
    // What the blow is made of for the target's defenses, kept with the hit
    // so a reaction's replay meets the same clauses (last-hit.ts flags).
    const flags: BlowFlags = {
      // An attack, so Heavy Armor Master's reduction answers it (pc-damage.ts).
      ...(attack.spellAttack ? {} : { attack: true }),
      // Magic Weapons: its weapon attacks are magical; so is a spell attack,
      // and a blow the block prints as magical ("magical bludgeoning").
      ...(hasTrait(standing.stats, "magicWeapons") || attack.spellAttack || attack.magical ? { magical: true } : {}),
      // A spell's attack is a spell to what answers one (ICE Pick, The Mark
      // Burns Back) and to a defence against spells: it was kept as magic only.
      ...(attack.spellAttack ? { spell: true } : {}),
      // Emissary of Redemption holds nothing against a creature the paladin attacked.
      ...(authored.spurned.length ? { exceptFeatures: authored.spurned } : {}),
      // What the post-apocalyptic classes resist of this creature's blow (One Blood).
      ...paBlowResists({ campaignId: campaign.id, encounterId: encounter.id, attacker: standing, target: getSheetById(target.id) ?? target, ranged, spellAttack: Boolean(attack.spellAttack) }),
    };
    // The Cloud Rune (cloud-rune.ts): a knight's player turns the hit onto
    // another creature before its damage is rolled, on the same roll, so the
    // target was never hit. The blow keeps its own dice; what the target's
    // place gave it (Martial Advantage, a critical for lying unconscious) is
    // not the new creature's.
    const turned = cloudRuneAtHit({ campaign, turn, encounter, attacker: standing, attackName: attack.name, struck: target, swing: index, rolled: hitOutcome.total });
    if (turned) {
      hitLog.swing(hitOutcome, targetAc(), { hit: false, crit: false, raw: 0, advantage, ranged, attack: attack.name });
      const turnedCrit = natCrit && !authored.noCrit && !(turned.taker.kind === "sheet" && wornArmorTurnsCrits(turned.taker.sheet.equipment ?? []));
      const turnedBase = effectDamage > 0 ? `${attack.damage}+${effectDamage}` : effectDamage < 0 ? `${attack.damage}-${-effectDamage}` : attack.damage;
      const expression = turnedCrit
        ? critDamageExpression(turnedBase, 0, { powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical, multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods })
        : turnedBase;
      swings.push(landTurnedBlow({ campaign, turn, encounter, attacker: standing, attack, taker: turned.taker, knight: turned.knight, expression, crit: turnedCrit, shrink: shrunk, flags, rolled: hitOutcome.total, sheets, sheetsById }));
      return;
    }

    // The charge this hit rides, once a turn, and its extra dice on the
    // blow (enemy-charge.ts).
    const charge = chargeForHit(getActiveEncounter(campaign.id), standing, attack, ranFeet);
    if (charge) {
      attack = withChargeDice(attack, charge);
    }
    // Enlarge/Reduce on the creature: its weapons grew or shrank with it
    // (enemy-hit.ts sizedAttack).
    const sized = sizedAttack(attack, standing.conditions);
    attack = sized.attack;
    // Martial Advantage and Surprise Attack add their dice to the blow
    // (src/lib/dm/monster-traits.ts), doubled on a critical hit like the rest.
    const bonus = hitTraitDice(encounter, standing, target.id, attack, martialSpent);
    if (bonus.martial) {
      martialSpent = true;
    }
    const withTraits = bonus.dice.length ? `${attack.damage}+${bonus.dice.join("+")}` : attack.damage;
    const baseDamage = effectDamage > 0 ? `${withTraits}+${effectDamage}` : effectDamage < 0 ? `${withTraits}-${-effectDamage}` : withTraits;
    const damageExpression = crit
      ? critDamageExpression(baseDamage, 0, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : baseDamage;
    const damageOutcome = rollExpression(damageExpression, undefined, { purpose: { roller: "enemy", kind: "damage", who: enemy.displayName } });
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(attack.name, target.name),
      result: damageOutcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });
    turn.rollIds.push(damageRoll.id);

    // Each damage type in the blow meets the target's defenses on its own
    // (a red dragon's fire halves for a tiefling, its teeth do not; a monk
    // immune to poison takes none of a bite's venom). A penalty can bring a
    // hit's damage to 0, never below it.
    const blow = blowByType(attack, damageOutcome, crit);
    // Sepulchral Aura and Numb to the Lash (genre-a-dark-fantasy-wards.ts).
    const warded = darkFantasyWeaponWard(encounter.id, standing.id, getSheetById(target.id) ?? target, attack, shrunk(Math.max(sized.floor, blow.amount)));
    const dealt = warded.amount;
    notes.push(...warded.notes);
    // A critical that came only from the target lying unconscious at 0 within
    // 5 ft (SRD 5.1) keeps the blow's ordinary damage too, read off the same
    // dice: a reaction that later leaves the target standing when it landed
    // replays it as the ordinary hit it then was (reaction-refund.ts). A
    // natural 20 is critical whatever the target.
    const struck = getSheetById(target.id) ?? target;
    const normalRoll = crit ? ordinaryOfCritical(damageOutcome, baseDamage, { multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods }) : null;
    const normalBlow = normalRoll ? blowByType(attack, normalRoll, false) : null;
    const asNormal = normalBlow
      ? { raw: shrunk(normalBlow.amount), ...(normalBlow.parts ? { parts: scaledParts(normalBlow.parts, shrunk(normalBlow.amount)) } : {}) }
      : undefined;
    const ordinary = asNormal && !natCrit && struck.currentHp <= 0 && critOnlyWhileUnconscious(struck.conditions) ? asNormal : undefined;
    // A critical the natural 20 alone made keeps the blow without its doubled
    // dice too: a reaction that rolls the attack again at disadvantage
    // (Warding Flare, Shadowy Dodge, Protection) and keeps a lower roll that
    // still hits leaves an ordinary hit (last-hit.ts plainOfReroll).
    const plain = asNormal && natCrit && !odds.autoCrit ? asNormal : undefined;
    // Any critical's normal figure, for Sentinel at Death's Door (last-hit.ts).
    const normal = asNormal ? { ...asNormal, type: normalBlow?.type ?? "", from: dealt } : undefined;
    // What the blow is made of for the target's defenses, kept with the hit
    // so a reaction's replay meets the same clauses (last-hit.ts flags).
    // Damage lands through the damage path: the ward, each type's defenses,
    // temp HP, clamps, audit, concentration and the sheet_updated publish.
    const applied: Record<string, unknown> = dealt <= 0 ? {} : applyPcDamage(campaign, turn.id, getSheetById(target.id) ?? target, {
      amount: Math.min(dealt, 200),
      ...(blow.type ? { type: blow.type } : {}),
      ...(blow.parts ? { parts: scaledParts(blow.parts, dealt) } : {}),
      ...flags,
      // Crits against a dying target count double death-save failures.
      ...(crit ? { crit: true } : {}),
      // Only a melee attack knocks out; a ranged one drops them dying.
      ...(args.nonlethal && !ranged ? { nonlethal: true } : {}),
      reason: `${enemy.displayName}'s ${attack.name}`,
    });
    // Thought Shield: the psychic damage a warlock took goes back to the
    // creature, kept with the swing so a reaction that turns it into a miss
    // takes it back (spell-retort.ts measureRetort).
    // A reaction that could still turn this swing into a miss holds an answer
    // that would slay the creature until the hit is settled (retort-wait.ts).
    const waits = reactionCouldTurn(campaign.id, struck, { total: hitOutcome.total, natural20: natCrit, vsAc: targetAc(), melee: !ranged, attackerId: enemy.id });
    hitAny = true;
    everyHitTurnable &&= waits;
    const psychicBack = measureRetort(enemy.id, () => thoughtShieldBack(campaign, turn, struck, enemy.id, { amount: Math.min(dealt, 200), type: blow.type, parts: blow.parts ? scaledParts(blow.parts, dealt) : undefined, flags }, sheets, sheetsById, waits), (back) => (back.thoughtShield && !back.waiting ? ["Thought Shield"] : []));
    Object.assign(applied, psychicBack.result);
    totalDamage += dealt;
    takenTotal += dealt > 0 ? meetDefenses(blowDefenses(campaign.id, struck, flags), Math.min(dealt, 200), blow.type, blow.parts ? scaledParts(blow.parts, dealt) : undefined, 0).amount : 0;
    previousHit = true;
    if (multiattackDefense) {
      defended = 4;
    }
    hitLog.swing(hitOutcome, targetAc(), {
      hit: true,
      crit,
      raw: dealt,
      advantage,
      type: blow.type ?? "",
      ...(blow.parts ? { parts: scaledParts(blow.parts, dealt) } : {}),
      ranged,
      attack: attack.name,
      ...(ordinary ? { ordinary } : {}),
      ...(plain ? { plain } : {}),
      ...(normal ? { normal } : {}),
      ...(standingAdvantage ? { standingAdvantage } : {}),
      // A hit that was no critical keeps its roll, so a reroll that comes up
      // 20 can make it one (authored-reactions.ts raiseToCritical).
      ...(!crit
        ? {
            critical: {
              expression: baseDamage,
              terms: damageOutcome.terms,
              ...(campaign.gameSettings.variantRules.powerfulCritical ? { powerful: true } : {}),
              ...(campaign.gameSettings.variantRules.criticalDamageMods ? { doubleFlat: true } : {}),
              attack: attack.name,
              scale: blow.amount > 0 ? Math.min(1, dealt / blow.amount) : 1,
              from: dealt,
            },
          }
        : {}),
      flags,
    });
    for (const type of attack.type.split("/")) {
      damageTypes.add(type);
    }
    if (attackerPos && targetPos && !attackerPos.hidden) {
      publishFx(
        campaign.id,
        planAttackFx({
          from: attackerPos.at,
          to: targetPos.at,
          fromTokenId: attackerPos.tokenId,
          toTokenId: targetPos.tokenId,
          hit: true,
          crit,
          ranged,
          damage: dealt,
          damageType: attack.type,
          visibility: hitRoll.visibility,
        }),
      );
    }
    if (typeof applied.hp === "string") {
      targetHp = applied.hp;
    }
    // What the hit carries besides its damage: a save against poison, a
    // shove to the ground, a grapple (SRD 5.1: the rider is part of the
    // attack, so it is the engine's to resolve).
    // The necrotic part of the blow, for a drain of the target's maximum.
    const byType = Array.isArray(applied.damageByType) ? (applied.damageByType as string[]) : null;
    const necrotic = byType
      ? byType.reduce((sum, part) => sum + (/^(\d+) necrotic\b/i.exec(part) ? Number(/^(\d+)/.exec(part)![1]) : 0), 0)
      : /necrotic/i.test(blow.type ?? attack.type) ? dealt : 0;
    const unridden = getSheetById(target.id);
    // A bite that may swallow ends the grapples its target holds: read first.
    const grips = attack.onHit?.swallow ? gripsHeldBy(campaign.id, target.id) : null;
    const onHit = resolveOnHit(campaign, turn, standing, attack, target.id, { sheets, sheetsById, dealt: { total: dealt, necrotic } });
    // What the rider laid on the target, kept with the swing: a reaction
    // that turns it into a miss takes it off (reaction-refund.ts), a swallow
    // with the grapples it ended (swallow.ts swallowMark).
    const ridden = getSheetById(target.id);
    const own = Array.isArray(onHit?.riderCondition) ? (onHit.riderCondition as string[]) : [];
    hitLog.laid(unridden && ridden ? (onHit?.swallowed ? swallowMark(campaign.id, unridden, ridden, target.id, grips, own) : riderMarkOf(unridden, ridden, own)) : null);
    // Charge, Pounce, Trampling Charge: the save the run and this hit force,
    // and a Pounce's bonus attack on a creature left prone (enemy-charge.ts).
    const charged = charge
      ? chargeAfterHit(campaign, standing, attack, charge, { id: target.id, name: target.name }, (ridden) => resolveOnHit(campaign, turn, standing, ridden, target.id, { sheets, sheetsById }), () => liesProne(conditionsOf(getSheetById(target.id) ?? target)))
      : [];
    // Fire Shield, Armor of Agathys and Holy Aura answer the blow
    // (spell-retort.ts), kept with the swing with Thought Shield's: a hit a
    // reaction turns into a miss never set them off (reaction-refund.ts).
    const answered = measureRetort(standing.id, () => spellRetort(campaign, turn, standing, target.id, !ranged, spatial.distance === null || spatial.distance <= 1, sheets, sheetsById, struck.tempHp ?? 0, waits), (out) => out.by, (out) => out.shares);
    // Thought Shield's line with the spells': the GM never heard it here.
    const retort = [psychicBack.result.thoughtShield, answered.result.line].filter(Boolean).join(" ") || null;
    hitLog.retort(joinRetorts(psychicBack.retort, answered.retort));
    hitLog.waiting([...(psychicBack.result.waiting ? [psychicBack.result.waiting] : []), ...answered.result.waiting]);
    if (typeof onHit?.targetHp === "string") {
      targetHp = onHit.targetHp;
    }
    const after = getSheetById(target.id);
    if (applied.dropped || (after && after.currentHp <= 0)) {
      dropped = true;
    }
    swings.push({
      attack: attack.name,
      rolled: hitOutcome.total,
      hit: true,
      ...(crit ? { crit: true } : {}),
      damage: dealt,
      ...(byType ? { damageByType: byType } : {}),
      ...(onHit ?? {}),
      ...(charged.length ? { charge: charged } : {}),
      ...(retort ? { retort } : {}),
    });
  });

  const closing = lastSwing as { attack: EnemyAttack; ranged: boolean } | null;
  hitLog.close({
    attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    attack: (closing?.attack ?? planned[0]).name,
    type: (closing?.attack ?? planned[0]).type,
    ranged: closing?.ranged ?? false,
  });
  // A feature's retaliation for the attack as a whole, kept with its record:
  // a reaction that leaves none of its swings a hit takes it back.
  const retaliationWaits = hitAny && everyHitTurnable ? ([] as WaitingAnswer[]) : undefined;
  const retaliation = measureRetort(standing.id, () => authoredAfterHit(campaign, { encounter, attacker: standing, target, dealt: totalDamage, taken: takenTotal, ranged: (lastSwing as { ranged: boolean } | null)?.ranged ?? false, attackName: closing?.attack.name, waiting: retaliationWaits }), (lines) => (lines.length > (retaliationWaits?.length ?? 0) ? ["A retaliation"] : []));
  hitLog.afterHit(retaliation.retort);
  hitLog.afterWaiting(retaliationWaits);
  notes.push(...retaliation.result);

  const names = [...new Set(planned.map((attack) => attack.name))];
  return {
    attack: names.join(", "),
    vsAc: targetAc(),
    target: target.name,
    ...(spatial.opportunityAttacks?.length
      ? { opportunityAttacks: spatial.opportunityAttacks }
      : {}),
    ...(planned.length > 1 ? { multiattack: planned.map((attack) => attack.name).join(", ") } : {}),
    swings,
    hit: swings.some((entry) => entry.hit),
    ...(totalDamage > 0 ? { totalDamage, damageType: [...damageTypes].join("/") } : {}),
    ...(notes.length ? { conditionEffects: notes } : {}),
    ...(targetHp ? { targetHp } : {}),
    ...(dropped ? { dropped: true, note: `${target.name} falls to 0 HP.` } : {}),
    ...(answersLanded.length ? { answersLanded } : {}),
  };
}

