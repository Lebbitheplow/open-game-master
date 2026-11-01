// What a legendary action bought for a later call, and what happens when
// that call is refused (issue 685 audit, 4.G). The spend and its follow-up
// are two calls from the AI's turn and the console's bare form, and one
// from the monsters' Hand (legendary-play.ts); either way a refused
// follow-up gives the action back, so a swing out of reach or a save on
// nobody costs nothing. Imports point downward only: encounter-tools.ts
// dispatches here.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter, turnKey, type Encounter } from "@/lib/db/encounters";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { publishPersisted } from "@/lib/events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { legendaryProfile, livePurchase, type LegendaryPurchaseRecord } from "@/lib/dm/legendary-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";

function dropPurchase(encounter: Encounter, enemyId: string): void {
  const purchases = { ...(encounter.legendary.purchases ?? {}) };
  delete purchases[enemyId];
  encounter.legendary.purchases = purchases;
  saveEncounter(encounter);
}

// Whether what a legendary action bought for a later call is still waiting
// for it: the swing, the ability, the spell, the move or the jump.
function purchaseWaits(encounter: Encounter, enemyId: string, record: LegendaryPurchaseRecord): boolean {
  if (record.strike && (encounter.legendary.strikes ?? []).includes(enemyId)) {
    return true;
  }
  if (record.bought && (encounter.legendary.abilities?.[enemyId]?.bought ?? []).includes(record.bought)) {
    return true;
  }
  return Boolean(record.move || record.teleportFeet);
}

// The legendary action given back: its cost to the pool, its place at this
// turn's end, and what it bought struck off. Returns the sentence the refusal
// carries, or null when nothing was waiting.
export function refundLegendaryPurchase(campaign: Campaign, enemyId: string): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const record = encounter?.legendary.purchases?.[enemyId];
  const enemy = encounter ? resolveEnemyRef(encounter.id, enemyId) : null;
  if (!encounter || !record || !enemy) {
    return null;
  }
  const profile = legendaryProfile(enemy.stats);
  const pool = encounter.legendary.pools[enemyId];
  if (pool && profile) {
    encounter.legendary.pools[enemyId] = { ...pool, actions: Math.min(profile.actionsPerRound, pool.actions + record.cost) };
  }
  const opportunities = encounter.legendary.opportunities;
  if (opportunities?.key === record.key) {
    encounter.legendary.opportunities = { key: opportunities.key, ids: opportunities.ids.filter((id) => id !== enemyId) };
  }
  const dropOne = (list: string[] | undefined, value: string) => {
    const at = (list ?? []).indexOf(value);
    return at >= 0 ? [...(list ?? []).slice(0, at), ...(list ?? []).slice(at + 1)] : (list ?? []);
  };
  if (record.strike && (encounter.legendary.strikes ?? []).includes(enemyId)) {
    encounter.legendary.strikes = dropOne(encounter.legendary.strikes, enemyId);
    const acted = encounter.legendary.acted;
    if (acted?.round === encounter.round && acted.owed?.includes(enemyId)) {
      const owed = dropOne(acted.owed, enemyId);
      encounter.legendary.acted = { round: acted.round, ids: acted.ids, ...(owed.length ? { owed } : {}) };
    }
  }
  const ledger = encounter.legendary.abilities?.[enemyId];
  if (record.bought && ledger?.bought?.includes(record.bought)) {
    encounter.legendary.abilities = { ...(encounter.legendary.abilities ?? {}), [enemyId]: { ...ledger, bought: dropOne(ledger.bought, record.bought) } };
  }
  dropPurchase(encounter, enemyId);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  return `${enemy.displayName} keeps its legendary action (${record.action}): nothing was spent.`;
}

// What a legendary action bought, made: nothing left to give back.
export function closeLegendaryPurchase(campaign: Campaign, enemyId: string): void {
  const encounter = getActiveEncounter(campaign.id);
  if (encounter?.legendary.purchases?.[enemyId]) {
    dropPurchase(encounter, enemyId);
  }
}

// The calls that make what a legendary action bought, and the enemy each
// names.
const FOLLOW_UPS: Record<string, string[]> = {
  enemy_attack: ["enemyId"],
  cast_at_player: ["casterEnemyId"],
  aoe_damage: ["casterEnemyId"],
  move_token: ["token"],
  teleport_token: ["token"],
};

// After a call that may make what a legendary action bought, from the AI's
// turn or the console (src/lib/dm/encounter-tools.ts applyEncounterCall): a
// refusal while the purchase still waits gives the action back, so a swing
// out of reach or a save on nobody costs nothing (issue 685 audit); a call
// that made it closes the purchase.
export function settleLegendaryFollowUp(campaign: Campaign, toolName: string, rawArguments: string, result: ToolResult): ToolResult {
  const fields = FOLLOW_UPS[toolName];
  const encounter = fields ? getActiveEncounter(campaign.id) : null;
  if (!fields || !encounter?.legendary.purchases) {
    return result;
  }
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return result;
  }
  const ref = fields.map((field) => args[field]).find((value): value is string => typeof value === "string" && value.trim() !== "");
  const enemy = ref ? resolveEnemyRef(encounter.id, ref) : null;
  if (!enemy || !encounter.legendary.purchases[enemy.id]) {
    return result;
  }
  const record = livePurchase(encounter.legendary, { turn: turnKey(encounter), round: encounter.round }, enemy.id);
  if (!record) {
    // Bought at a turn's end that has passed, and never made: nothing is
    // given back now, and the call is the creature's own.
    dropPurchase(encounter, enemy.id);
    return result;
  }
  // A move or a jump is the follow-up only for the call that moves it.
  if ((record.move && toolName !== "move_token") || (record.teleportFeet && toolName !== "teleport_token") || ((record.strike || record.bought) && (toolName === "move_token" || toolName === "teleport_token"))) {
    return result;
  }
  if (typeof result.error === "string") {
    if (!purchaseWaits(encounter, enemy.id, record)) {
      return result;
    }
    const kept = refundLegendaryPurchase(campaign, enemy.id);
    return kept ? { ...result, error: `${result.error} ${kept}` } : result;
  }
  if (!purchaseWaits(encounter, enemy.id, record) || record.move || record.teleportFeet) {
    dropPurchase(encounter, enemy.id);
  }
  return result;
}
