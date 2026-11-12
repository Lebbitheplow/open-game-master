import type { HandTargetChip } from "@/app/campaigns/[campaignId]/HandAimBar";
import type { TargetEdge, TargetSight } from "@/lib/battlemap/view-tactics";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { effectiveAcFor } from "@/lib/srd";
import { featureAdvantage, type EdgeClock } from "@/lib/battlemap/hand-edge";

// Split from Hand.tsx, which offers these chips on the aim bar.
// The chips a raised card can be aimed at: the living creatures on the other
// side of the fight from this character, with what the board says of each
// (cover, flanking), and the characters on its own side.
//
// Sides (issue 503, the encounter's `sides`): a hero a Dominate spell from
// the foes holds fights for them, and the GM plays its turn with its own
// Hand (issue 685 audit, 4.G); its targets are the party, not the foes it
// now fights beside. The other way round, a character on the foes' side (a
// turncoat companion, a dominated hero) is a target for the party's attacks,
// and a creature the party dominates is no longer one. A fight with no
// exceptions sends no sides, and the chips are the enemy rows and the party.
export function handTargets(
  enemies: PublicEncounter["enemies"],
  sheets: CharacterSheet[],
  selfId: string | undefined,
  edges: Record<string, TargetEdge> | undefined,
  sides?: PublicEncounter["sides"],
  clock?: EdgeClock,
  // Sight as the roll reads it (PlayerMapView.sight), so the preview's odds
  // carry the light's advantage: the foes in magical darkness have no edge.
  sight?: Record<string, TargetSight>,
): HandTargetChip[] {
  const self = sheets.find((entry) => entry.id === selfId);
  // The features that give this character advantage against it (Vow of
  // Enmity, Assassinate), so the preview's odds are the roll's.
  const featured = (id: string, type?: string) => {
    const features = self ? featureAdvantage(self, { id, type }, clock) : [];
    return features.length ? { advantage: features } : {};
  };
  const sideOf = (id: string, kind: "sheet" | "enemy") => sides?.[id] ?? (kind === "sheet" ? "party" : "foe");
  const mine = selfId ? sideOf(selfId, "sheet") : "party";
  const enemyChips: HandTargetChip[] = enemies
    .filter((enemy) => enemy.status === "alive" && sideOf(enemy.id, "enemy") !== mine)
    .map((enemy) => ({
      id: enemy.id,
      name: enemy.name,
      kind: "enemy",
      ac: enemy.ac,
      cr: enemy.cr,
      conditions: enemy.conditions,
      ...(edges?.[enemy.id] ? { edge: edges[enemy.id] } : {}),
      ...(sight?.[enemy.id] ? { sight: sight[enemy.id] } : {}),
      ...featured(enemy.id, enemy.type),
      note: [
        enemy.knockedOut ? "knocked out" : enemy.regenerating ? (enemy.regenerating.stopped ? "down, dies at its turn" : "down, regenerates at its turn") : enemy.health,
        edges?.[enemy.id]?.cover ? `${edges[enemy.id].cover === 2 ? "half" : "3/4"} cover` : null,
        edges?.[enemy.id]?.flanking ? "flanked" : null,
        ...enemy.conditions.slice(0, 2),
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  const living = sheets.filter((entry) => !entry.deathSaves?.dead);
  // Characters on the other side, struck as foes are (src/lib/dm/sheet-foe.ts).
  const sheetFoes: HandTargetChip[] = living
    .filter((entry) => entry.id !== selfId && sideOf(entry.id, "sheet") !== mine)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: "enemy",
      ac: effectiveAcFor(entry),
      conditions: entry.conditions,
      ...(edges?.[entry.id] ? { edge: edges[entry.id] } : {}),
      ...featured(entry.id),
      note: `${entry.currentHp}/${effectiveMaxHp(entry)} hp`,
    }));
  const party: HandTargetChip[] = living
    .filter((entry) => entry.id === selfId || sideOf(entry.id, "sheet") === mine)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.id === selfId ? "self" : "ally",
      conditions: entry.conditions,
      note: `${entry.currentHp}/${effectiveMaxHp(entry)} hp`,
    }));
  return [...enemyChips, ...sheetFoes, ...party];
}

// The dead of this character's own side, the only chips a card that takes the
// dead is aimed at (src/lib/srd/dead-targets.ts): Revivify, Hand of Ultimate
// Mercy. handTargets leaves them out, so no card for the living offers them.
export function deadAllyTargets(sheets: CharacterSheet[], selfId: string | undefined, sides?: PublicEncounter["sides"]): HandTargetChip[] {
  const sideOf = (id: string) => sides?.[id] ?? "party";
  const mine = selfId ? sideOf(selfId) : "party";
  return sheets
    .filter((entry) => entry.id !== selfId && entry.deathSaves?.dead && sideOf(entry.id) === mine)
    .map((entry) => ({ id: entry.id, name: entry.name, kind: "ally", conditions: entry.conditions, note: "dead" }));
}
