// A net's hold on the creature it caught (SRD 5.1, Weapons, Net): "A
// creature can use its action to make a DC 10 Strength check, freeing itself
// or another creature within its reach on a success. Dealing 5 slashing
// damage to the net (AC 10) also frees the creature without harming it,
// ending the effect and destroying the net."
//
// pc_attack lays the restraint with this source (attack-swing.ts hitSwing),
// so only the net's own instance ends here, and a Web or a grapple holding
// the same creature stays. The escape is take_action escape (grapple.ts);
// the blow at the net is damage_object naming "Net" (object-damage.ts),
// which this module resolves to the creature it holds.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getTokenByRef } from "@/lib/db/battle-maps";
import { listDroppedItems, takeFromDroppedItem, type DroppedItem } from "@/lib/db/dropped-items";
import { getActiveBattleMap } from "@/lib/battlemap/view";
import { d20Expression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { instancesOf, removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { canEnemyAct } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { dmRoll } from "@/lib/dm/roll-card";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { placeName } from "@/lib/dm/gear-ground";
import { matchWeapon, SPECIAL_WEAPONS } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

// The source a net's restraint records.
export const NET_HOLD = "net";
export const RESTRAINED = "restrained";
// The net as an object: "AC 10", and 5 slashing damage destroys it.
export const NET_AC = 10;
export const NET_HP = 5;
const NET_ESCAPE_DC = 10;

type Held = { conditions: string[]; conditionMeta: unknown };

// Whether a net holds this creature.
export function netHolds(held: Held): boolean {
  const meta = held.conditionMeta as ConditionMetaMap | undefined;
  return held.conditions.some((name) => isConditionNamed(name, RESTRAINED) && instancesOf(meta?.[name]).some((entry) => entry.source === NET_HOLD));
}

// The creature with the net's own restraint taken off; others stay.
export function withoutNet(held: Held): { conditions: string[]; meta: ConditionMetaMap } {
  const cleared = removeConditionInstances(held.conditions, held.conditionMeta as ConditionMetaMap, RESTRAINED, (entry) => entry.source === NET_HOLD);
  return { conditions: cleared.conditions, meta: cleared.meta };
}

const isNet = (item: { name: string }) => matchWeapon({ name: item.name })?.name === SPECIAL_WEAPONS.net;

// A creature held by a net, enemy or character.
export type Netted = { kind: "enemy"; enemy: EncounterEnemy } | { kind: "pc"; sheet: CharacterSheet };

export const nettedId = (netted: Netted) => (netted.kind === "enemy" ? netted.enemy.id : netted.sheet.id);
export const nettedName = (netted: Netted) => (netted.kind === "enemy" ? netted.enemy.displayName : netted.sheet.name);

function everyNetted(campaignId: string): Netted[] {
  const encounter = getActiveEncounter(campaignId);
  const enemies: Netted[] = (encounter ? listEnemies(encounter.id) : [])
    .filter((enemy) => enemy.status === "alive" && netHolds(enemy))
    .map((enemy) => ({ kind: "enemy", enemy }));
  const sheets: Netted[] = listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => netHolds(sheet))
    .map((sheet) => ({ kind: "pc", sheet }));
  return [...enemies, ...sheets];
}

// The net lying over a creature: on the board at its square, or with no
// board, the one left at this place most lately.
function netOver(campaignId: string, refId: string): DroppedItem | null {
  const map = getActiveBattleMap(campaignId);
  const token = map ? getTokenByRef(map.id, refId) : null;
  const nets = listDroppedItems(campaignId).filter((entry) => !entry.heldByEnemy && isNet(entry.item));
  if (map && token) {
    return nets.find((entry) => entry.mapId === map.id && entry.x === token.x && entry.y === token.y) ?? null;
  }
  const here = textKey(placeName(campaignId));
  return nets.filter((entry) => entry.mapId === null && textKey(entry.place) === here).at(-1) ?? null;
}

// What damage_object's name means when it is a net: "Net" with one creature
// held by a net, or the ground id of the net over one. Null when the name is
// no net; refused when it names one but no creature, or two creatures fit.
export function netObject(campaignId: string, name: string): { netted: Netted; ground: DroppedItem | null } | ToolError | null {
  const byId = listDroppedItems(campaignId).find((entry) => entry.id === name.trim() && isNet(entry.item)) ?? null;
  if (!byId && !isNet({ name })) {
    return null;
  }
  const netted = everyNetted(campaignId);
  const fits = byId ? netted.filter((entry) => netOver(campaignId, nettedId(entry))?.id === byId.id) : netted;
  if (fits.length === 1) {
    return { netted: fits[0], ground: byId ?? netOver(campaignId, nettedId(fits[0])) };
  }
  if (!fits.length) {
    return { error: "No creature is held by that net: damage_object's net is one restraining a creature. Nothing was rolled.", retry: true };
  }
  return {
    error: `Nets hold ${fits.map((entry) => `${nettedName(entry)}${netOver(campaignId, nettedId(entry)) ? ` (net ${netOver(campaignId, nettedId(entry))?.id})` : ""}`).join(", ")}: name the net by its ground id. Nothing was rolled.`,
    retry: true,
  };
}

// The net's hold ends on the creature. `destroyed`: cut through, the net
// leaves the ground too; broken free of, it still lies there.
export function freeFromNet(campaign: Campaign, netted: Netted, destroyed: boolean): string {
  if (netted.kind === "enemy") {
    const cleared = withoutNet(netted.enemy);
    patchEnemyConditions(netted.enemy.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
  } else {
    const fresh = getSheetById(netted.sheet.id) ?? netted.sheet;
    const cleared = withoutNet(fresh);
    const updated = patchSheet(fresh.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const ground = destroyed ? netOver(campaign.id, nettedId(netted)) : null;
  if (ground) {
    takeFromDroppedItem(ground.id, 1);
    publishBattleMapUpdate(campaign.id);
  }
  return destroyed
    ? `The net is cut through: ${nettedName(netted)} is free, unharmed, and the net is destroyed.`
    : `${nettedName(netted)} breaks free of the net; it lies where it fell.`;
}

// An enemy's action to break the net: a DC 10 Strength check.
export function enemyNetEscape(campaign: Campaign, turn: DmTurn, enemy: EncounterEnemy): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: an enemy breaks a net only in a fight.", retry: true };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  spendEnemyAction(encounter, enemy.id);
  saveEncounter(encounter);
  const mod = Math.floor(((enemy.stats.abilities?.str ?? 10) - 10) / 2);
  const total = dmRoll(campaign.id, turn, "ability_check", `${enemy.displayName}: STR check to break free of the net`, d20Expression(mod)).total;
  const escaped = total >= NET_ESCAPE_DC;
  return {
    ok: true,
    action: "escape",
    check: `${total} vs DC ${NET_ESCAPE_DC}`,
    success: escaped,
    note: escaped ? freeFromNet(campaign, { kind: "enemy", enemy }, false) : `${enemy.displayName} strains against the net and stays restrained; its action is spent.`,
  };
}

// A character's action to break the net. The caller has priced the action;
// `spend` pays it.
export function characterNetEscape(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, spend: () => void): ToolResult {
  spend();
  const check = rollCharacterCheck(campaign, sheet, { ability: "str", dc: NET_ESCAPE_DC }, `${sheet.name}: STR check to break free of the net`);
  if (check.rollId) {
    turn.rollIds.push(check.rollId);
  }
  const escaped = !check.autoFailed && check.total >= NET_ESCAPE_DC;
  return {
    ok: true,
    action: "escape",
    check: `${check.total} vs DC ${NET_ESCAPE_DC}`,
    success: escaped,
    note: escaped ? freeFromNet(campaign, { kind: "pc", sheet }, false) : `${sheet.name} is still restrained by the net.`,
  };
}
