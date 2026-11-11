// The Undead warlock's Spirit Projection on the board (subclasses.json,
// warlock, The Undead, 14th level): "project your spirit from your body ...
// while the body lies unconscious ... you can fly at your walking speed and
// hover, passing through creatures and objects as difficult terrain (1d10
// force damage if you end a turn inside one)".
//
// The warlock's token is the spirit. The body is left where the projection
// began: a prop token bound to the sheet ("<name>'s body"), as an Echo
// Knight's echo is (mt-fb-echo.ts). It keeps the warlock's Armor Class and
// hit points, so a blow at it is a blow at the warlock: rolled with advantage
// against the unconscious, a critical hit from within 5 feet, the damage
// dealt to the warlock's own hit points through the one damage door
// (pc-damage.ts applyPcDamage), concentration and all. The body is gone with
// the projection.
//
// Everything that leaves, strikes or clears a body goes through here:
//   - mutations.ts use_resource leaves it after the counter's spend
//     (projectionAfterSpend);
//   - enemy-attack.ts aims a creature's attack at it (enemyStrikesBody);
//   - turn-end.ts clears a body whose projection is over, and deals the 1d10
//     force to a spirit whose turn ends inside a creature or an object
//     (projectionTurnEnd);
//   - enemy-damage.ts applyEnemyDamage, the door every blow at a creature
//     lands through, hands the necrotic part of a blow to projectionDreadHeal
//     ("while in Form of Dread, once on each of your turns when you deal
//     necrotic damage, you regain hit points equal to half of it").
// The passage itself is the board's (ar-ws-umbral-logic.ts
// movesThroughEverything, read by passage.ts pcMoveTraits).
import { getBattleMapForEncounter, insertToken, listTokens, removeTokenByRef } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { closeStandInTurn, openStandInTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, saveEncounter, turnKey, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import type { BattleToken } from "@/lib/battlemap/types";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { attackNamed } from "@/lib/dm/enemy-profile";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { currentActor } from "@/lib/dm/acting-party";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { enemyAttacker, rollCard } from "@/lib/dm/roll-card";
import { noneNamed, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { effectiveAcFor } from "@/lib/srd";
import { hasCondition } from "@/lib/srd/authored-effects";

export const SPIRIT_PROJECTION = "spirit projection";
const COUNTER = "sub_spirit_projection";
const BODY_REF = "body:";
// "1d10 force damage if you end a turn inside one".
const INSIDE_DAMAGE = "1d10";

const published = (campaignId: string) => publishEphemeral(campaignId, "battle_map_updated", {});
const apart = (a: Pick<BattleToken, "x" | "y">, b: Pick<BattleToken, "x" | "y">) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Whose body a token is, or null for any other token.
export function bodyOwnerOf(token: Pick<BattleToken, "kind" | "refId">): string | null {
  return token.kind === "prop" && token.refId.startsWith(BODY_REF) ? token.refId.slice(BODY_REF.length) : null;
}

// The projection begun: in a fight, the body stays on the spirit's square.
export function projectionAfterSpend(campaign: Campaign, stale: CharacterSheet, counterId: string | undefined): Record<string, unknown> {
  if (counterId !== COUNTER) {
    return {};
  }
  const sheet = getSheetById(stale.id) ?? stale;
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter && hasCondition(sheet, SPIRIT_PROJECTION) ? getBattleMapForEncounter(encounter.id) : null;
  const at = map ? listTokens(map.id).find((token) => token.kind === "pc" && token.refId === sheet.id) : null;
  if (!map || !at) {
    return {};
  }
  removeTokenByRef(map.id, `${BODY_REF}${sheet.id}`);
  insertToken({ mapId: map.id, campaignId: campaign.id, kind: "prop", refId: `${BODY_REF}${sheet.id}`, name: `${sheet.name}'s body`, x: at.x, y: at.y });
  published(campaign.id);
  return { body: `${sheet.name}'s body lies unconscious on their square, the spirit free of it. A creature can attack the body (enemy_attack naming "${sheet.name}'s body"): the blow lands on ${sheet.name}'s hit points.` };
}

// Bodies whose projection is over leave the board; true when one went.
function clearBodies(campaignId: string, map: { id: string }): boolean {
  let cleared = false;
  for (const token of listTokens(map.id)) {
    const owner = bodyOwnerOf(token);
    const sheet = owner ? getSheetById(owner) : null;
    if (owner && (!sheet || !hasCondition(sheet, SPIRIT_PROJECTION))) {
      removeTokenByRef(map.id, token.refId);
      cleared = true;
    }
  }
  if (cleared) {
    published(campaignId);
  }
  return cleared;
}

// A creature's attack at a body on the board, or null when the target named
// is no body.
export function enemyStrikesBody(
  campaign: Campaign,
  turn: DmTurn | null,
  encounter: Encounter,
  enemy: EncounterEnemy,
  targetRef: string,
  attackName: string | undefined,
): ToolResult | null {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  const wanted = textKey(targetRef);
  const body = listTokens(map.id).find((token) => bodyOwnerOf(token) !== null && (token.id === targetRef.trim() || token.refId === targetRef.trim() || textKey(token.name) === wanted));
  const owner = body ? getSheetById(bodyOwnerOf(body)!) : null;
  if (!body || !owner) {
    return null;
  }
  if (!hasCondition(owner, SPIRIT_PROJECTION)) {
    clearBodies(campaign.id, map);
    return { error: `${owner.name}'s projection is over: the spirit is back in the body, so attack ${owner.name}.`, retry: true };
  }
  const named = attackName ? attackNamed(enemy.stats.attacks, attackName) : null;
  if (attackName && !named) {
    return noneNamed(`${enemy.displayName} has no attack called`, attackName, enemy.stats.attacks.map((entry) => entry.name));
  }
  const attack = named ?? enemy.stats.attacks[0];
  if (!attack) {
    return { error: `${enemy.displayName} has no attack on its block to make at ${body.name}.`, retry: true };
  }
  const ac = effectiveAcFor(owner);
  // Attacks against an unconscious creature have advantage (SRD 5.1,
  // Conditions, Unconscious).
  const rolled = rollCard(campaign, turn, null, "attack", `${enemy.displayName}: ${attack.name} at ${body.name} (AC ${ac}, unconscious: advantage)`, `2d20kh1${attack.toHit >= 0 ? "+" : ""}${attack.toHit}`, enemyAttacker(enemy));
  const natural = rolled.natural ?? 0;
  const hit = natural === 20 || (natural !== 1 && rolled.total >= ac);
  const live = getActiveEncounter(campaign.id) ?? encounter;
  spendEnemyAction(live, enemy.id);
  saveEncounter(live);
  if (!hit) {
    return { hit: false, toHit: rolled.total, applied: `${enemy.displayName}'s ${attack.name} (${rolled.total}) misses ${body.name} (AC ${ac}).` };
  }
  // "Any attack that hits the creature is a critical hit if the attacker is
  // within 5 feet of the creature" (Unconscious).
  const striker = listTokens(map.id).find((token) => token.kind === "enemy" && token.refId === enemy.id);
  const critical = natural === 20 || Boolean(striker && apart(striker, body) <= 1);
  const damage = rollCard(campaign, turn, null, "damage", `${enemy.displayName}: ${attack.name} at ${body.name}${critical ? " (critical)" : ""}`, critical ? critDamageExpression(attack.damage) : attack.damage, enemyAttacker(enemy));
  const amount = Math.max(0, damage.total);
  const hurt = amount > 0 && turn
    ? applyPcDamage(campaign, turn.id, getSheetById(owner.id) ?? owner, { amount, type: attack.type, reason: `${enemy.displayName}'s ${attack.name} at ${owner.name}'s body` })
    : null;
  return {
    hit: true,
    critical,
    toHit: rolled.total,
    damage: amount,
    applied: `${enemy.displayName}'s ${attack.name} (${rolled.total}) hits ${body.name} (AC ${ac})${critical ? ", a critical hit on the unconscious body" : ""}: ${amount} ${attack.type ?? ""} damage to ${owner.name}.`.replace("  ", " "),
    ...(hurt && !("error" in hurt) ? { target: hurt } : {}),
  };
}

// As turns end: bodies of a projection now over are cleared, and a spirit
// whose turn ends inside a creature or an object takes 1d10 force damage.
export function projectionTurnEnd(campaign: Campaign, combatantIds: string[]): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return [];
  }
  clearBodies(campaign.id, map);
  const lines: string[] = [];
  const tokens = listTokens(map.id);
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    const spirit = sheet && hasCondition(sheet, SPIRIT_PROJECTION) ? tokens.find((token) => token.kind === "pc" && token.refId === id) : null;
    if (!sheet || !spirit) {
      continue;
    }
    const inside = tokens.find((token) => token.id !== spirit.id && token.refId !== `${BODY_REF}${id}` && token.x === spirit.x && token.y === spirit.y);
    if (!inside) {
      continue;
    }
    // A turn of its own for the roll and the damage, closed once used, as a
    // spell area's turn-end strike has (zone-triggers.ts).
    const turn = openStandInTurn(campaign.id);
    try {
      const rolled = rollCard(campaign, turn, sheet.id, "damage", `${sheet.name}: the turn ends inside ${inside.name}`, INSIDE_DAMAGE, null);
      const hurt = applyPcDamage(campaign, turn.id, sheet, { amount: rolled.total, type: "force", reason: `the spirit's turn ended inside ${inside.name}` });
      lines.push(`${sheet.name}'s spirit ends its turn inside ${inside.name} and takes ${"error" in hurt ? rolled.total : (hurt.damageApplied ?? rolled.total)} force damage.`);
    } finally {
      closeStandInTurn(turn);
    }
  }
  return lines;
}

const FORM_OF_DREAD = "form of dread";

// Necrotic damage the acting character just dealt: projected and in Form of
// Dread, on their own turn, once a turn, they regain half of it. The turn is
// kept on the projection's own meta (usedTurn), so a second blow of the turn
// heals nothing.
export function projectionDreadHeal(campaign: Campaign, encounter: Encounter, necrotic: number): string | null {
  const actor = currentActor();
  const sheet = actor?.kind === "sheet" ? getSheetById(actor.ref) : null;
  if (!sheet || !hasCondition(sheet, SPIRIT_PROJECTION) || !hasCondition(sheet, FORM_OF_DREAD) || sheet.currentHp <= 0) {
    return null;
  }
  const live = getActiveEncounter(campaign.id) ?? encounter;
  if (!ownTurnOf(live, sheet.id)) {
    return null;
  }
  const key = turnKey(live);
  const meta = sheet.conditionMeta?.[SPIRIT_PROJECTION] ?? {};
  if (meta.usedTurn === key) {
    return null;
  }
  const healed = Math.min(sheet.maxHp, sheet.currentHp + Math.floor(necrotic / 2)) - sheet.currentHp;
  patchSheetAudited(campaign.id, sheet.id, { currentHp: sheet.currentHp + healed, conditionMeta: { ...sheet.conditionMeta, [SPIRIT_PROJECTION]: { ...meta, usedTurn: key } } }, {
    kind: "heal",
    reason: `Spirit Projection in Form of Dread: half of ${necrotic} necrotic damage dealt`,
    delta: { healed },
  });
  return `${sheet.name} regains ${healed} hit points, half the ${necrotic} necrotic damage dealt (Spirit Projection in Form of Dread, once a turn).`;
}
