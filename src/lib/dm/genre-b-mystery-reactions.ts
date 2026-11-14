// The mystery classes' reactions the authored layer cannot take as written
// (WAVE2 D5), asked once by use_reaction (src/lib/dm/reaction-tools.ts) before
// it:
//
//   General Strike (enforcer)  "1/long rest, you and all allies within 30 ft
//                              each gain a reaction attack when any one of you
//                              is hit, for 1 minute": the enforcer calls it as
//                              one of them is hit, with their reaction, which
//                              spends the use and lays the strike on those
//                              within 30 feet for the minute; from then each
//                              striker answers an attack that hit any of them
//                              with one weapon attack at the creature that
//                              landed it. The authored layer gives a genre
//                              reaction to its holder alone
//                              (authored-effects.ts authoredReactionNamed reads
//                              the subclass rows), so the strikers' is here.
//   Guardian Shade (spirit     "it negates one attack that would hit you": the
//     medium)                  medium alone; the authored reaction that turns
//                              the hit aside would cover an ally named.
//
// Null for any other call; a refusal spends nothing.
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { withinFeet } from "@/lib/dm/authored-saves";
import { ownTurnOf } from "@/lib/dm/held-turn";
import { attackerFoeId, openHits, type LastHit } from "@/lib/dm/last-hit";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { reactionPatch } from "@/lib/dm/reaction-refund";
import { SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { GENERAL_STRIKE } from "@/lib/srd/genre-b-mystery-conditions";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

const COUNTER = "mystery_general_strike";
const MINUTE = 10;
const REACH_FEET = 30;

const strikes = (sheet: { conditions: string[] }) => sheet.conditions.some((entry) => isConditionNamed(entry, GENERAL_STRIKE));
const party = (campaignId: string) => listSheets(campaignId).map((stale) => getSheetById(stale.id) ?? stale).filter((sheet) => !sheet.deathSaves?.dead);

function generalStrike(ctx: Ctx): ToolResult {
  const { campaign, encounter } = ctx;
  const reactor = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  if (!encounter) {
    return { error: "General Strike's attack happens in a fight; there is no active encounter.", refused: "rules" };
  }
  // Calling it: the enforcer, with a use left, as one of those within 30 feet is hit.
  const calls = !strikes(reactor);
  const state = reactor.resources?.[COUNTER];
  if (calls && !holdsGenreFeature(reactor, "enforcer", "General Strike")) {
    return { error: `${reactor.name} is not part of a General Strike: an enforcer calls one as one of them is hit, and it holds for those within 30 feet for a minute. Nothing was spent.`, refused: "rules" };
  }
  if (calls && (!state || state.used >= state.max)) {
    return { error: `${reactor.name} has no General Strike left to call (it comes back on a long rest). Nothing was spent.`, refused: "rules" };
  }
  const reached = (sheet: CharacterSheet) => sheet.id === reactor.id || withinFeet(encounter.id, reactor.id, sheet.id, REACH_FEET);
  const strikers = party(campaign.id).filter((sheet) => (calls ? reached(sheet) : strikes(sheet)));
  // The creature named, by id or name as every tool takes it.
  const named = ctx.args.targetEnemyId ? (resolveTargetFoe(campaign.id, encounter, ctx.args.targetEnemyId)?.id ?? null) : null;
  const landed = (hit: LastHit) => hit.source === "attack" && hit.swings.some((swing) => swing.hit) && attackerFoeId(hit) !== null && (!ctx.args.targetEnemyId || attackerFoeId(hit) === named);
  const hits = strikers.flatMap((striker) => openHits(campaign.id, striker.id).filter(landed));
  const attackerId = attackerFoeId(hits.at(-1));
  const attacker = attackerId ? getEnemy(attackerId) : null;
  if (!attacker || attacker.status !== "alive") {
    return { error: `General Strike answers an attack that has just hit ${calls ? `${reactor.name} or an ally within 30 feet` : "one of the strikers"}, and the server has none ${ctx.args.targetEnemyId ? "by that creature " : ""}on record this turn. Nothing was spent.`, refused: "rules" };
  }
  // A reaction answers another creature's turn (authored-reactions.ts, the
  // reaction attacks): a hit taken on the reactor's own turn is no trigger.
  if (ownTurnOf(encounter, reactor.id)) {
    return { error: `General Strike answers what another creature does on its turn, and it is ${reactor.name}'s own turn. Nothing was spent.`, refused: "rules" };
  }
  const lines: string[] = [];
  if (calls && state) {
    // Audited, so "Revert this turn" gives the use back with the reaction.
    reactionPatch(campaign, ctx.turn.id, reactor.id, { resources: { ...reactor.resources, [COUNTER]: { max: state.max, used: state.used + 1 } } }, "General Strike: a use spent");
    for (const striker of strikers) {
      const fresh = getSheetById(striker.id) ?? striker;
      const kept = fresh.conditions.filter((entry) => textKey(entry) !== textKey(GENERAL_STRIKE));
      const updated = patchSheet(fresh.id, { conditions: [...kept, GENERAL_STRIKE], conditionMeta: { ...fresh.conditionMeta, [GENERAL_STRIKE]: { rounds: MINUTE, source: reactor.id } } });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
    lines.push(`${reactor.name} calls a General Strike: for a minute ${strikers.map((sheet) => sheet.name).join(", ")} each answer a hit on any of them with a reaction attack (use_reaction General Strike).`);
  }
  // One weapon attack with the reaction alone (pc-attack.ts reactionAttack);
  // the weapon's own reach and range decide whether it lands. The strike once
  // called stands, whatever becomes of this attack.
  const result = handlePcAttack(campaign, ctx.turn, JSON.stringify({ characterId: reactor.id, targetEnemyId: attacker.id }), ctx.sheets, ctx.sheetsById, new Set(), null, { reactionAttack: true });
  if (typeof result.error === "string") {
    if (!calls) {
      return { ...result, error: `${result.error} Nothing was spent.` };
    }
    spendReaction(ctx);
    return { ok: true, reaction: "General Strike", spent: SPENT(reactor.name), applied: lines, attackRefused: result.error };
  }
  spendReaction(ctx);
  return { ok: true, reaction: "General Strike", spent: SPENT(reactor.name), ...(lines.length ? { applied: lines } : {}), attack: result };
}

export function mysteryReaction(ctx: Ctx): ToolResult | null {
  const feature = ctx.args.feature ?? "";
  if (isNamed(feature, "general strike")) {
    return generalStrike(ctx);
  }
  // "one attack that would hit you": never a hit on someone else.
  if (isNamed(feature, "guardian shade") && ctx.args.targetCharacterId && ctx.args.targetCharacterId !== ctx.sheet.id) {
    return { error: `Guardian Shade turns aside an attack that hit ${ctx.sheet.name}, not one that hit another creature. Nothing was spent.`, refused: "rules" };
  }
  return null;
}
