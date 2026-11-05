import type { EncounterEnemy } from "@/lib/db/encounters";
import { enemySpeedTiles } from "@/lib/dm/enemy-speed";
import type { LegendaryStep } from "@/lib/dm/legendary-route-logic";

// The movement a legendary move allows (legendary-route-logic.ts "move"):
// squares (a count of feet, else its walking or flying speed, or a part of
// it), whether leaving reach provokes, and whether it flies. None of it is
// the creature's own turn's movement (src/lib/dm/map-tools.ts
// handleMoveToken). Read by the GM's card and by the move that spends it.
export function legendaryMoveFor(
  enemy: Pick<EncounterEnemy, "stats" | "conditions" | "id" | "campaignId">,
  step: Extract<LegendaryStep, { kind: "move" }>,
): { tiles: number; provokes: boolean; fly: boolean } {
  const speed = step.feet !== null ? Math.floor(step.feet / 5) : enemySpeedTiles(enemy, { flying: step.mode === "fly" });
  return { tiles: Math.floor(speed * step.fraction), provokes: step.provokes, fly: step.mode === "fly" };
}
