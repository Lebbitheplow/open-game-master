// Hold the Line (steam knight 3, Boilerplate Vanguard): "Enemies within your
// reach treat the area as difficult terrain" (src/lib/classes/steampunk-features.json;
// WAVE2 D5: the genre text is the rule, played on the SRD 5.1 engine).
//
// Asked by src/lib/dm/zone-rules.ts withZoneSteps beside Wall of Muscle: a
// creature on the other side from a standing knight pays two feet a foot for
// each square within the knight's reach (5 feet, 10 with a reach weapon in
// hand), as on difficult ground (SRD 5.1, Difficult Terrain). The knight's
// own side walks it freely, and so does a mover no difficult terrain slows
// (the caller skips this for one).
//
// Before this the feature was its sentence in the GM's prompt (and, before
// that, borrowed the Cavalier's Hold the Line).
import type { BattleMap } from "@/lib/db/battle-maps";
import { listTokens } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { tileIndex } from "@/lib/battlemap/types";
import { sideOf } from "@/lib/dm/combatant";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { matchWeapon } from "@/lib/srd/weapons";

type Step = (from: number, to: number, cost: number) => number;

// What a square of difficult terrain costs (src/lib/battlemap/types.ts).
const DIFFICULT = 2;

// The knight's reach in squares: a melee weapon with the reach property in
// hand reaches two, anything else one. Read by its row (matchWeapon), so a
// renamed glaive keeps its reach.
export function knightReachTiles(sheet: Pick<CharacterSheet, "equipment">): number {
  const reach = (sheet.equipment ?? []).some((item) => item.equipped && matchWeapon(item)?.properties?.includes("reach"));
  return reach ? 2 : 1;
}

function heldCells(map: BattleMap, moverKind: string, moverRef: string | undefined): Set<number> | null {
  const encounter = getActiveEncounter(map.campaignId);
  if (!encounter || encounter.id !== map.encounterId || !moverRef) {
    return null;
  }
  const kind = moverKind === "enemy" ? "enemy" : "sheet";
  let moverSide: ReturnType<typeof sideOf> | null = null;
  const cells = new Set<number>();
  for (const token of listTokens(map.id)) {
    if (token.kind !== "pc" || token.refId === moverRef) {
      continue;
    }
    const sheet = getSheetById(token.refId);
    if (!sheet || sheet.currentHp <= 0 || sheet.deathSaves?.dead || !holdsGenreFeature(sheet, "steam_knight", "Hold the Line")) {
      continue;
    }
    moverSide ??= sideOf(encounter, kind, moverRef);
    if (sideOf(encounter, "sheet", sheet.id, sheet) === moverSide) {
      continue;
    }
    const tiles = knightReachTiles(sheet);
    for (let dy = -tiles; dy <= tiles; dy += 1) {
      for (let dx = -tiles; dx <= tiles; dx += 1) {
        const x = token.x + dx;
        const y = token.y + dy;
        if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
          cells.add(tileIndex(map.width, x, y));
        }
      }
    }
  }
  return cells.size ? cells : null;
}

// The step costs so far with the knights' held ground: `inner` unchanged when
// no knight holds the line before this mover.
export function withHoldTheLine(map: BattleMap, moverKind: string, moverRef: string | undefined, inner: Step | null): Step | null {
  const cells = heldCells(map, moverKind, moverRef);
  if (!cells) {
    return inner;
  }
  return (from, to, cost) => {
    const base = inner ? inner(from, to, cost) : cost;
    return cells.has(to) ? Math.max(base, DIFFICULT) : base;
  };
}
