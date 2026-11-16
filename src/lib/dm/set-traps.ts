// A trap lying on a square of the battle map. SRD 5.1, Adventuring Gear,
// Hunting Trap: "When you use your action to set it, this trap forms a
// saw-toothed steel ring that snaps shut when a creature steps on a pressure
// plate in the center." Traps: "A trap's description specifies the checks
// and DCs needed to detect it ... You can also compare the DC to detect the
// trap with each character's passive Wisdom (Perception) score to determine
// whether anyone in the party notices the trap in passing." Nothing could lie
// on a square before: an enemy walking onto the party's trap was caught only
// if the GM remembered and sprang it by hand.
//
// A set trap is an area of one square (src/lib/battlemap/zones.ts) that runs
// as the set-trap row (zones-gear.ts), its trap's name in `spell`. The zone
// triggers hand the first creature to enter it here (zone-triggers.ts
// areasAfterMove), and it springs by the trap's own numbers through the
// engine apply_hazard runs (trap-run.ts springTrapOn for a character,
// enemy-trap.ts springOnEnemy for an enemy, with its save from its block),
// then it is spent. A trap the GM sets (apply_hazard place) is hidden: no
// player's board draws it (zone-view.ts) until a character notices it, by
// passive Perception as they walk into it when its text gives a Perception
// DC, or by a Search that meets its DC with the skill its text names
// (object-actions.ts searchAction). A trap a character sets (take_action
// use_object with one they carry) lies in the party's sight.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { getActiveBoard, getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { MAX_ZONES, type SpellZone } from "@/lib/battlemap/zones";
import type { XY } from "@/lib/battlemap/types";
import { zoneKey } from "@/lib/battlemap/zones-spells";
import { SET_TRAP } from "@/lib/battlemap/zones-gear";
import { liveZones, publishZones, saveZones } from "@/lib/dm/zone-store";
import { trapAt } from "@/lib/srd/table-hazards";
import { springTrapOn } from "@/lib/dm/trap-run";
import { springOnEnemy } from "@/lib/dm/enemy-trap";
import { passiveScore } from "@/lib/dm/check-tools";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import { enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { findCarriedItem } from "@/lib/dm/item-logic";
import { saveEquipment } from "@/lib/dm/gear-store";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

export const isSetTrap = (zone: SpellZone) => zoneKey(zone) === zoneKey(SET_TRAP);

// A Search finds what lies within 30 feet of the searcher.
const SEARCH_TILES = 6;

const cellOf = (map: BattleMap, at: XY) => at.y * map.width + at.x;

// Lays the trap named `name` (an SRD sample trap, a hunting trap or a
// workshop trap) on the square `at`: hidden from the players' boards when
// the GM sets it.
export function setTrapAt(campaign: Campaign, args: { name: string; at: XY; by: { kind: "pc" | "enemy"; id: string; name: string }; hidden: boolean }): { line: string } | ToolError {
  const found = trapAt(args.name, campaign.id);
  if (!found) {
    return { error: `No trap is named "${args.name}": a set trap is an SRD sample trap, a hunting trap or one of the table's workshop traps. Nothing was set.`, retry: true };
  }
  const encounter = getActiveBoard(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return { error: "A trap is set on a square of the battle map, and there is none. Narrate where it lies; spring it with apply_hazard when something steps in. Nothing was set.", retry: true };
  }
  if (args.at.x < 0 || args.at.y < 0 || args.at.x >= map.width || args.at.y >= map.height) {
    return { error: `(${args.at.x},${args.at.y}) is off the ${map.width}x${map.height} board. Nothing was set.`, retry: true };
  }
  const zones = liveZones(map, encounter);
  if (zones.length >= MAX_ZONES) {
    return { error: `The board holds ${MAX_ZONES} areas already. Nothing was set.`, refused: "limit" };
  }
  const zone: SpellZone = {
    id: crypto.randomUUID().slice(0, 12),
    spell: found.name,
    runsAs: SET_TRAP,
    casterId: args.by.id,
    casterKind: args.by.kind,
    casterName: args.by.name,
    origin: args.at,
    cells: [cellOf(map, args.at)],
    concentration: false,
    castRound: encounter.round,
    untilRound: null,
    slotLevel: null,
    dc: null,
    ...(args.hidden ? { hidden: true } : {}),
  };
  saveZones(map.id, [...zones, zone]);
  publishZones(campaign.id);
  return { line: `The ${found.name} lies set at (${args.at.x},${args.at.y})${args.hidden ? ", hidden from the players' board" : ""}: the first creature to step on it springs it by its own numbers.` };
}

// take_action use_object with a trap the character carries (a hunting
// trap): set on the square in front of them, toward the nearest foe on the
// board (as caltrops are spread, gear-zones.ts), and out of their pack. Null
// when the item is no trap they carry or there is no board: the plain Use an
// Object goes on.
export function setCarriedTrap(campaign: Campaign, turn: DmTurn, sheet: CharacterSheet, item: string | undefined, spend: () => void): ToolResult | null {
  const carried = item?.trim() ? findCarriedItem(sheet.equipment, item) : null;
  const found = carried ? trapAt(carried.name, campaign.id) : null;
  const encounter = found ? getActiveBoard(campaign.id) : null;
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const own = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!carried || !found || !map || !own) {
    return null;
  }
  const apart = (token: { x: number; y: number }) => Math.max(Math.abs(token.x - own.x), Math.abs(token.y - own.y));
  const nearest = listTokens(map.id)
    .filter((token) => token.kind === "enemy")
    .reduce<{ x: number; y: number } | null>((best, token) => (!best || apart(token) < apart(best) ? token : best), null);
  const at = nearest ? { x: own.x + Math.sign(nearest.x - own.x), y: own.y + Math.sign(nearest.y - own.y) } : { x: own.x, y: own.y };
  const set = setTrapAt(campaign, { name: found.name, at, by: { kind: "pc", id: sheet.id, name: sheet.name }, hidden: false });
  if ("error" in set) {
    return set;
  }
  spend();
  const fresh = getSheetById(sheet.id) ?? sheet;
  const line = findCarriedItem(fresh.equipment, item ?? "");
  const equipment: EquipmentItem[] = fresh.equipment.flatMap((entry) => (entry !== line ? [entry] : (entry.qty ?? 1) > 1 ? [{ ...entry, qty: (entry.qty ?? 1) - 1 }] : []));
  saveEquipment(campaign, turn, fresh, equipment, "use_item", { item: carried.name, qty: -1 }, `Set a ${found.name}`);
  return { ok: true, action: "Use an Object", applied: `${sheet.name} sets the ${found.name}. ${set.line}` };
}

type Mover = { kind: "pc" | "enemy"; id: string };

// The first creature to step on the trap's square (zone-triggers.ts): a
// character who notices a hidden trap in passing stops short of it, and it
// is no longer hidden; anyone else springs it, and it is spent. `stopAt` is
// where the walk ends: short of the trap, or on it for a creature it holds.
export function enterSetTrap(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  map: BattleMap,
  zone: SpellZone,
  mover: Mover,
  start: XY,
  steps: XY[],
): { lines: string[]; stopAt: XY | null } {
  const cell = zone.cells[0];
  const at = steps.findIndex((step) => cellOf(map, step) === cell);
  const found = trapAt(zone.spell, campaign.id);
  if (at < 0 || !found || cellOf(map, start) === cell) {
    return { lines: [], stopAt: null };
  }
  const sheets = listSheets(campaign.id).map((stale) => getSheetById(stale.id) ?? stale);
  const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
  const sheet = mover.kind === "pc" ? sheetsById.get(mover.id) : undefined;
  const spot = found.trap.spot;
  if (zone.hidden && sheet && spot?.skill === "perception") {
    const passive = passiveScore(campaign, sheet, "perception");
    if (passive >= spot.dc) {
      zone.hidden = false;
      return {
        lines: [`${sheet.name} notices the ${found.name} in passing (passive Perception ${passive} against DC ${spot.dc}) and stops short of it.`],
        stopAt: at > 0 ? steps[at - 1] : start,
      };
    }
  }
  const from = { fromX: zone.origin.x, fromY: zone.origin.y };
  const enemy = mover.kind === "enemy" ? getEnemy(mover.id) : null;
  const outcome = sheet
    ? springTrapOn(campaign, turn, sheet, found.name, found.trap, sheets, sheetsById, from)
    : enemy && enemy.status === "alive"
      ? springOnEnemy({ campaign, turn, encounter, sheets, sheetsById }, enemy, found.name, found.trap, from)
      : null;
  if (!outcome) {
    return { lines: [], stopAt: null };
  }
  // Spent: the row's budget of one is dealt (zone-triggers.ts settle).
  zone.dealt = 1;
  zone.hidden = false;
  const name = sheet?.name ?? enemy?.displayName ?? "A creature";
  // Held on the square (a hunting trap's jaws, a net): its walk ends there.
  const held = sheet
    ? effectiveSpeed((getSheetById(sheet.id) ?? sheet).conditions, sheet.speed) === 0
    : Boolean(enemy && enemySpeedTiles(getEnemy(enemy.id) ?? enemy) === 0);
  const note = typeof outcome.note === "string" && outcome.note ? ` ${outcome.note}` : "";
  return { lines: [`${name} steps on the ${found.name} at (${zone.origin.x},${zone.origin.y}) and springs it.${note}`], stopAt: held ? steps[at] : null };
}

// A Search that meets a hidden set trap's DC with the skill its text names
// finds it, within 30 feet of the searcher: it is drawn on the players'
// boards from then on. The line for the Search's result, or null.
export function revealSetTraps(campaign: Campaign, sheet: CharacterSheet, skill: "perception" | "investigation", total: number): string | null {
  const encounter = getActiveBoard(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const zones = liveZones(map, encounter);
  const found: string[] = [];
  for (const zone of zones) {
    const spot = zone.hidden && isSetTrap(zone) ? trapAt(zone.spell, campaign.id)?.trap.spot : undefined;
    const near = Math.max(Math.abs(zone.origin.x - token.x), Math.abs(zone.origin.y - token.y)) <= SEARCH_TILES;
    if (spot && near && spot.skill === skill && total >= spot.dc) {
      zone.hidden = false;
      found.push(`the ${zone.spell} at (${zone.origin.x},${zone.origin.y})`);
    }
  }
  if (!found.length) {
    return null;
  }
  saveZones(map.id, zones);
  publishZones(campaign.id);
  return `${sheet.name} finds ${found.join(" and ")}.`;
}
