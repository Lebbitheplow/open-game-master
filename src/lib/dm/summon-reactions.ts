// The reactions of the creatures a character brings to a fight, which are
// the creature's own and never its master's:
//
//   Deflect Attack   the Battle Smith's steel defender (a sheet of its own,
//                    summon-defender.ts): "a reaction imposes disadvantage on
//                    an attack against a creature within 5 ft. of it" other
//                    than itself, and with Improved Defender the attacker
//                    takes 1d4 + the artificer's Intelligence modifier force.
//   Infused Strikes  the Drakewarden's drake (a pet on the ranger's sheet,
//                    pet-build.ts): "when another creature within 30 feet of
//                    it that it can see hits with a weapon attack, that attack
//                    deals an extra 1d6 damage of its essence type".
//
// Before this neither was a reaction the engine knew: use_reaction refused
// "Deflect Attack" for a sheet with no features, and "Infused Strikes" for a
// ranger whose sheet does not carry the drake's stat block as a feature.
//
// A summon's reaction is spent under its own sheet id, as a character's is.
// A pet has no place in the order (D2: it stands with its owner), so its
// reaction is kept under a key of its own that the owner's turn gives back
// (held-turn.ts withoutReactionsOf): taking it leaves the owner's reaction
// theirs. A new reaction of a summoned creature or a pet is a branch here.

import { getActiveEncounter, getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { rollCard } from "@/lib/dm/action-common";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import { rollHitAgainAtDisadvantage } from "@/lib/dm/authored-reactions";
import { withinFeet } from "@/lib/dm/authored-saves";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { answerKey, attackerFoeId } from "@/lib/dm/last-hit";
import { petPlaceOf } from "@/lib/dm/pet-place";
import { allyOf, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { defenderUpgrade, STEEL_DEFENDER } from "@/lib/dm/summon-defender";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { rollAgainst } from "@/lib/roll-labels";
import { computeSheetDerived } from "@/lib/srd";
import { PET_REACTION_PREFIX } from "@/lib/srd/authored-effects-more";
import { isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

const DEFLECT_ATTACK = "Deflect Attack";
const INFUSED_STRIKES = "Infused Strikes";
const DEFLECT_REACH_FEET = 5;
const INFUSED_REACH_FEET = 30;

// The key a pet's reaction is kept under until its owner's next turn starts.
export function petReactionKey(ownerId: string, petName: string): string {
  return `${PET_REACTION_PREFIX}${ownerId}:${textKey(petName)}`;
}

// Deflect Attack, taken by the steel defender (use_reaction with the
// defender's own characterId and the creature attacked as targetCharacterId).
// Null for any other reactor or feature.
export function summonReaction(ctx: Ctx): ToolResult | null {
  if (ctx.sheet.summon?.spell !== STEEL_DEFENDER || !isNamed(ctx.args.feature, DEFLECT_ATTACK)) {
    return null;
  }
  const encounter = ctx.encounter;
  const covered = allyOf(ctx);
  if (!encounter || !covered) {
    return { error: `${DEFLECT_ATTACK} turns an attack on a creature beside ${ctx.sheet.name}: pass that creature as targetCharacterId. Nothing was spent.`, retry: true };
  }
  if (covered.id === ctx.sheet.id) {
    return { error: `${DEFLECT_ATTACK} covers a creature other than ${ctx.sheet.name} itself. Nothing was spent.`, refused: "rules" };
  }
  if (!withinFeet(encounter.id, ctx.sheet.id, covered.id, DEFLECT_REACH_FEET)) {
    return { error: `${covered.name} is beyond ${DEFLECT_REACH_FEET} feet of ${ctx.sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  const label = answerKey(textKey(DEFLECT_ATTACK), ctx.sheet.id);
  const again = rollHitAgainAtDisadvantage(ctx, covered, DEFLECT_ATTACK, label);
  if ("error" in again) {
    return again;
  }
  const out: Record<string, unknown> = { applied: again.applied };
  // Improved Defender: the deflecting reaction also strikes the attacker.
  const artificer = ctx.sheet.summon.casterId ? getSheetById(ctx.sheet.summon.casterId) : null;
  const foeId = attackerFoeId(again.record);
  const attacker = foeId ? getEnemy(foeId) : null;
  if (artificer && defenderUpgrade(artificer) > 0 && attacker && attacker.status === "alive") {
    const int = computeSheetDerived(artificer).abilityMods.int;
    const expression = int > 0 ? `1d4+${int}` : int < 0 ? `1d4${int}` : "1d4";
    const rolled = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "damage", rollAgainst(`${DEFLECT_ATTACK} (Improved Defender)`, attacker.displayName), expression, { kind: "sheet", id: ctx.sheet.id, name: ctx.sheet.name });
    const amount = Math.max(0, rolled.total);
    out.rolled = `${expression}: ${amount} force`;
    if (amount > 0) {
      Object.assign(out, applyEnemyDamage(ctx.campaign, ctx.turn, encounter, attacker, amount, ctx.sheets, ctx.sheetsById, "force", { magical: true }));
      publishEncounter(ctx.campaign.id);
    }
  }
  spendReaction(ctx);
  return { ok: true, reaction: DEFLECT_ATTACK, spent: SPENT(ctx.sheet.name), ...out };
}

// Infused Strikes, the drake's reaction, taken through the ranger it is
// bonded to (use_reaction with the ranger's characterId; the creature hit as
// targetEnemyId when more than one was hit this turn). It answers the running
// turn's own record of a weapon hit (attack-swing.ts WEAPON_HIT), and spends
// the drake's reaction, never the ranger's. Null for any other feature.
export function petReaction(ctx: Ctx): ToolResult | null {
  if (!isNamed(ctx.args.feature, INFUSED_STRIKES)) {
    return null;
  }
  const { sheet } = ctx;
  const drake = (sheet.pets ?? []).find((pet) => pet.kind === "drake");
  if (!drake) {
    return { error: `${INFUSED_STRIKES} is the reaction of a Drakewarden's drake, and ${sheet.name} has no drake out. Nothing was spent.`, refused: "rules" };
  }
  if (drake.hp <= 0) {
    return { error: `${drake.name} is down and takes no reaction. Nothing was spent.`, refused: "rules" };
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: "Reactions only exist in combat; there is no active encounter.", refused: "rules" };
  }
  const key = petReactionKey(sheet.id, drake.name);
  if (encounter.reactionsUsed.includes(key)) {
    return { error: `${drake.name} has already used its reaction; it comes back at the start of ${sheet.name}'s next turn. ${INFUSED_STRIKES} does not happen.`, refused: "rules" };
  }
  // The weapon hits of the turn now running, by the creature whose turn it is.
  const budget = encounter.turnBudget && encounter.turnBudget.round === encounter.round ? encounter.turnBudget : null;
  const hits = (budget?.oncePerTurn ?? []).filter((mark) => mark.startsWith(WEAPON_HIT)).map((mark) => mark.slice(WEAPON_HIT.length));
  const named = ctx.args.targetEnemyId ? resolveTargetFoe(encounter.campaignId, encounter, ctx.args.targetEnemyId) : null;
  const struckId = named ? (hits.includes(named.id) ? named.id : null) : (hits.at(-1) ?? null);
  const struck = struckId ? getEnemy(struckId) : null;
  if (!budget || !struck) {
    return {
      error: `${INFUSED_STRIKES} answers a weapon attack that has just hit, made by a creature other than ${drake.name} within ${INFUSED_REACH_FEET} feet of it, and the server has ${named ? `none on ${named.displayName}` : "none"} on record this turn. Nothing was spent.`,
      refused: "rules",
    };
  }
  // A pet stands with its owner (pet-place.ts): the 30 feet is measured from
  // the ranger's place to the creature that made the hit.
  if (budget.ownerId !== sheet.id && !withinFeet(encounter.id, petPlaceOf(sheet), budget.ownerId, INFUSED_REACH_FEET)) {
    const hitter = getSheetById(budget.ownerId)?.name ?? "The attacker";
    return { error: `${hitter} is beyond ${INFUSED_REACH_FEET} feet of ${drake.name}, who stands with ${sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  const essence = drake.immune?.trim() || "fire";
  const out: Record<string, unknown> = {};
  if (struck.status === "alive") {
    const rolled = rollCard(ctx.campaign, ctx.turn, sheet.id, "damage", rollAgainst(`${drake.name}'s ${INFUSED_STRIKES}`, struck.displayName), "1d6", { kind: "sheet", id: sheet.id, name: sheet.name });
    out.rolled = `1d6: ${rolled.total} ${essence}`;
    Object.assign(out, applyEnemyDamage(ctx.campaign, ctx.turn, encounter, struck, rolled.total, ctx.sheets, ctx.sheetsById, essence, { magical: true }));
    publishEncounter(ctx.campaign.id);
  } else {
    out.applied = `${struck.displayName} is already down; the infusion adds nothing.`;
  }
  const live = getActiveEncounter(ctx.campaign.id);
  if (live && !live.reactionsUsed.includes(key)) {
    markReactionUsed(live, key);
  }
  return { ok: true, reaction: INFUSED_STRIKES, spent: `${drake.name}'s reaction is used until the start of ${sheet.name}'s next turn; ${sheet.name}'s own is untouched.`, ...out };
}
