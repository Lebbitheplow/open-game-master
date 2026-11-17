import type { HandTargetChip } from "@/app/campaigns/[campaignId]/HandAimBar";
import type { TargetEdge, TargetSight } from "@/lib/battlemap/view-tactics";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { effectiveAcFor } from "@/lib/srd";
import { featureAdvantage, type EdgeClock } from "@/lib/battlemap/hand-edge";
import { translate } from "@/lib/messages-logic";

// Split from Hand.tsx, which offers these chips on the aim bar.
// The chips a raised card can be aimed at: the living creatures on the other
// side of the fight from this character, with what the board says of each
// (cover, flanking), and the characters on its own side. Like composerGate,
// the reading takes the translator from the component that draws the chips
// (the notes are table.hand.target.*), so a language switch rewords them
// with everything else. Pure otherwise.
//
// Sides (issue 503, the encounter's `sides`): a hero a Dominate spell from
// the foes holds fights for them, and the GM plays its turn with its own
// Hand (issue 685 audit, 4.G); its targets are the party, not the foes it
// now fights beside. The other way round, a character on the foes' side (a
// turncoat companion, a dominated hero) is a target for the party's attacks,
// and a creature the party dominates is no longer one. A fight with no
// exceptions sends no sides, and the chips are the enemy rows and the party.
type HandTargetsT = (key: string, vars?: Record<string, string | number>) => string;

export function handTargets(
  ...args:
    | [t: HandTargetsT, enemies: PublicEncounter["enemies"], sheets: CharacterSheet[], selfId: string | undefined, edges: Record<string, TargetEdge> | undefined, sides?: PublicEncounter["sides"], clock?: EdgeClock, sight?: Record<string, TargetSight>]
    // Upstream's suites call the plain form without a translator.
    | [enemies: PublicEncounter["enemies"], sheets: CharacterSheet[], selfId: string | undefined, edges: Record<string, TargetEdge> | undefined, sides?: PublicEncounter["sides"], clock?: EdgeClock, sight?: Record<string, TargetSight>]
): HandTargetChip[] {
  // Both call shapes: the components pass the translator first (t-first, the
  // agoLabel pattern), the plain form falls back to the dictionary's English.
  const withT = typeof args[0] === "function";
  const t = (withT ? args[0] : (key: string, vars?: Record<string, string | number>) => translate("en", key, vars)) as HandTargetsT;
  const [enemies, sheets, selfId, edges, sides, clock, sight] = (withT ? args.slice(1) : args) as [
    PublicEncounter["enemies"],
    CharacterSheet[],
    string | undefined,
    Record<string, TargetEdge> | undefined,
    PublicEncounter["sides"]?,
    EdgeClock?,
    Record<string, TargetSight>?,
  ];
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
        enemy.knockedOut
          ? t("knocked out", { context: "table.hand.target.knockedOut" })
          : enemy.regenerating
            ? enemy.regenerating.stopped
              ? t("down, dies at its turn")
              : t("down, regenerates at its turn")
            : enemy.health,
        edges?.[enemy.id]?.cover
          ? t(edges[enemy.id].cover === 2 ? "half cover" : "3/4 cover")
          : null,
        edges?.[enemy.id]?.flanking ? t("flanked") : null,
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
      note: t("{hp}/{max} hp", { hp: entry.currentHp, max: effectiveMaxHp(entry) }),
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
