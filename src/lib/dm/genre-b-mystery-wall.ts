// Wall of Muscle (enforcer, 18th level): "Enemies treat all squares within
// 10 ft of you as difficult terrain" (src/lib/classes/mystery-features.json;
// WAVE2 D5: the genre text is the rule, played on the SRD 5.1 engine).
//
// Every walk's step costs come through zone-rules.ts withZoneSteps, which asks
// here once: a creature on the other side from a standing enforcer pays two
// feet a foot for each square within two of them, as on difficult ground
// (SRD 5.1, Difficult Terrain: "every foot of movement in difficult terrain
// costs 1 extra foot"). The enforcer's own side walks it freely, and so does
// a mover no difficult terrain slows (Freedom of Movement: the caller skips
// this with the spell areas' own costs).
//
// Before this the feature was its sentence in the GM's prompt, and a goblin
// crossed the enforcer's reach at full speed.
import type { BattleMap } from "@/lib/db/battle-maps";
import { listTokens } from "@/lib/db/battle-maps";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { tileIndex } from "@/lib/battlemap/types";
import { sideOf } from "@/lib/dm/combatant";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

type Step = (from: number, to: number, cost: number) => number;

// "within 10 ft of you": two squares, the enforcer's own included.
const WALL_TILES = 2;
// What a square of difficult terrain costs (src/lib/battlemap/types.ts).
const DIFFICULT = 2;

// The squares a standing enforcer's Wall of Muscle makes difficult for this
// mover, or none: only a creature fighting the enforcer is slowed.
function walledCells(map: BattleMap, moverKind: string, moverRef: string | undefined): Set<number> | null {
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
    if (!sheet || sheet.currentHp <= 0 || sheet.deathSaves?.dead || !holdsGenreFeature(sheet, "enforcer", "Wall of Muscle")) {
      continue;
    }
    moverSide ??= sideOf(encounter, kind, moverRef);
    if (sideOf(encounter, "sheet", sheet.id, sheet) === moverSide) {
      continue;
    }
    for (let dy = -WALL_TILES; dy <= WALL_TILES; dy += 1) {
      for (let dx = -WALL_TILES; dx <= WALL_TILES; dx += 1) {
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

// The spell areas' step costs with the wall's: `inner` unchanged when no
// enforcer's wall stands before this mover.
export function withWallOfMuscle(map: BattleMap, moverKind: string, moverRef: string | undefined, inner: Step | null): Step | null {
  const cells = walledCells(map, moverKind, moverRef);
  if (!cells) {
    return inner;
  }
  return (from, to, cost) => {
    const base = inner ? inner(from, to, cost) : cost;
    return cells.has(to) ? Math.max(base, DIFFICULT) : base;
  };
}
