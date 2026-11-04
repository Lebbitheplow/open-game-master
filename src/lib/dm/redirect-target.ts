// Who takes a blow a redirect turns aside, and whether it lands on them
// (src/lib/dm/authored-reactions.ts, the "redirect" reactions), settled
// before anything is rolled or spent. From the features' own text in the
// content pack:
//
// - Misdirection (Mastermind): "redirects an attack aimed at you onto a
//   creature within 5 feet that is giving you cover". Any creature, friend or
//   foe, standing in the line between the attacker and the rogue.
// - Instinctive Charm (Enchantment): the attacker must "target the creature
//   closest to it (other than you or itself) instead". The wizard picks
//   nobody: the board does, and among creatures equally close the attacker
//   chooses, so the call names one of them.
//
// Either way the attack now targets that creature, so its roll is set
// against that creature's AC: a blow that beat the holder's AC can miss the
// one it turns onto.
import type { Encounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { acWithEffects, enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { coversAgainst } from "@/lib/dm/attack-spatial";
import { withinFeet } from "@/lib/dm/authored-saves";
import { tilesApart } from "@/lib/dm/board-reach";
import { combatantDefeated, combatantsOf, resolveCombatant, type Combatant } from "@/lib/dm/combatant";
import type { SwingRecord } from "@/lib/dm/last-hit";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A redirect lands on a creature this near the holder (Misdirection).
export const REDIRECT_BESIDE_FT = 5;

export type RedirectAsk = {
  campaignId: string;
  encounter: Encounter;
  holder: CharacterSheet;
  // The creature that made the attack, by id, and as the record names it.
  attackerId: string | null;
  attackerName: string;
  // The creature the call names: targetEnemyId, else targetCharacterId.
  named: string | null;
  reaction: string;
  // Instinctive Charm: the creature closest to the attacker, not one beside
  // the holder.
  closest: boolean;
};

export function redirectTaker(ask: RedirectAsk): Combatant | ToolError {
  const { campaignId, encounter, holder, attackerId, attackerName, reaction } = ask;
  const named = ask.named ? resolveCombatant(campaignId, encounter, ask.named) : null;
  if (ask.named && (!named || combatantDefeated(named))) {
    return { error: `No creature still in this fight matches "${ask.named}". Nothing was spent.`, retry: true };
  }
  if (named && named.id === holder.id) {
    return { error: `${reaction} turns the attack onto another creature, not ${holder.name}. Nothing was spent.`, refused: "rules" };
  }
  if (named && named.id === attackerId) {
    return { error: `${reaction} turns the attack onto another creature, not ${named.name}, who made it. Nothing was spent.`, refused: "rules" };
  }
  if (ask.closest) {
    return closestTaker(ask, named);
  }
  if (!named) {
    return { error: `${reaction} turns the attack onto a creature beside ${holder.name} that gives them cover: pass its targetEnemyId, or targetCharacterId for a character. Nothing was spent.`, retry: true };
  }
  if (!withinFeet(encounter.id, holder.id, named.id, REDIRECT_BESIDE_FT)) {
    return { error: `${named.name} is not within ${REDIRECT_BESIDE_FT} feet of ${holder.name}. Nothing was spent.`, refused: "rules" };
  }
  if (attackerId && !coversAgainst(encounter.id, attackerId, holder.id, named.id)) {
    return { error: `${named.name} does not stand between ${attackerName} and ${holder.name}, so gives no cover: ${reaction} turns the attack only onto a creature that does. Nothing was spent.`, refused: "rules" };
  }
  return named;
}

// The creature closest to the attacker, other than the holder and itself.
function closestTaker(ask: RedirectAsk, named: Combatant | null): Combatant | ToolError {
  const { campaignId, encounter, holder, attackerId, attackerName, reaction } = ask;
  const map = getBattleMapForEncounter(encounter.id);
  const from = map && attackerId ? getTokenByRef(map.id, attackerId) : null;
  const pass = `pass its targetEnemyId, or targetCharacterId for a character`;
  // No board, or no token for the attacker: nothing to measure, and the
  // call's creature stands.
  if (!map || !from) {
    return named ?? { error: `${reaction} turns the attack onto the creature closest to ${attackerName}: ${pass}. Nothing was spent.`, retry: true };
  }
  const placed = combatantsOf(campaignId, encounter)
    .filter((entry) => entry.id !== holder.id && entry.id !== attackerId && !combatantDefeated(entry))
    .flatMap((entry) => {
      const token = getTokenByRef(map.id, entry.id);
      return token ? [{ entry, tiles: tilesApart(from, token) }] : [];
    });
  if (!placed.length) {
    return { error: `No other creature is on the board for ${attackerName} to turn on, so ${reaction} has nothing to do. Nothing was spent.`, refused: "rules" };
  }
  const nearest = Math.min(...placed.map((entry) => entry.tiles));
  const closest = placed.filter((entry) => entry.tiles === nearest).map((entry) => entry.entry);
  const names = closest.map((entry) => entry.name).join(" and ");
  if (named) {
    return closest.some((entry) => entry.id === named.id)
      ? named
      : { error: `${named.name} is not the creature closest to ${attackerName}: ${names} ${closest.length > 1 ? "are" : "is"}. Nothing was spent.`, refused: "rules" };
  }
  const [only, ...tied] = closest;
  return tied.length
    ? { error: `${names} stand equally close to ${attackerName}, which chooses among them: ${pass}. Nothing was spent.`, retry: true }
    : only;
}

// The AC the turned attack meets, and whether its roll still hits: a
// critical hits whatever it meets.
export function blowLandsOn(campaignId: string, taker: Combatant, swing: Pick<SwingRecord, "total" | "crit">): { ac: number; lands: boolean } {
  const ac = taker.kind === "enemy" ? enemyAcWithEffects(campaignId, taker.enemy) : acWithEffects(campaignId, taker.sheet);
  return { ac, lands: swing.crit || swing.total >= ac };
}
