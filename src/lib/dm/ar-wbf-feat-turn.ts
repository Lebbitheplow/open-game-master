// What a feat reads off the turn it is used on, for the doors that move a
// character (the player's move route, the GM's move_token for a character)
// and the ones that resolve what follows the walk (pc_attack, take_action
// shove). The rules themselves are in src/lib/srd/feat-moves.ts; this file is
// the turn budget's side of them.
import type { Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { budgetApplies, type TurnBudget } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { CHARGER_PUSH_TILES, CHARGER_RAN, CHARGER_RUN_TILES, dashCrossesDifficultTerrain, hasCharger } from "@/lib/srd/feat-moves";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type XY = { x: number; y: number };

const ownBudget = (encounter: Encounter | null, sheetId: string): TurnBudget | null =>
  encounter && budgetApplies(encounter.turnBudget, sheetId, encounter.round) ? encounter.turnBudget : null;

// Mobile on a turn its holder Dashed: every pcMoveTraits caller that prices a
// character's own walk passes this as `anyGround`, so the board lights the
// squares the move route will charge.
export function crossesAnyGround(encounter: Encounter | null, sheet: Pick<CharacterSheet, "id" | "feats" | "features">): boolean {
  return dashCrossesDifficultTerrain(sheet, ownBudget(encounter, sheet.id)?.dashed === true);
}

// The run a Charger's walk leaves on the turn, kept as one mark:
// "charger:ran-straight:<dx>,<dy>:<squares>". Two walks on one heading add
// up (a drag of 5 feet and another of 5 are 10 feet in a straight line); a
// step on any other heading starts the count again from that step.
const runOf = (budget: TurnBudget): { mark: string; heading: string; squares: number } | null => {
  const mark = budget.oncePerTurn.find((entry) => entry.startsWith(`${CHARGER_RAN}:`));
  if (!mark) {
    return null;
  }
  const [heading, squares] = mark.slice(CHARGER_RAN.length + 1).split(":");
  return { mark, heading, squares: Number(squares) || 0 };
};

// Called by each door that walks a character, with the square left and every
// square entered. Nothing for a character without Charger, or off their turn.
export function noteStraightRun(encounter: Encounter | null, stale: CharacterSheet, from: XY, path: XY[] | null | undefined): void {
  if (!encounter || !path?.length || !hasCharger(stale)) {
    return;
  }
  const sheet = getSheetById(stale.id) ?? stale;
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget) {
    return;
  }
  const before = runOf(budget);
  const squares = [from, ...path];
  let heading = before?.heading ?? "";
  let count = before?.squares ?? 0;
  for (let at = 1; at < squares.length; at += 1) {
    const step = `${squares[at].x - squares[at - 1].x},${squares[at].y - squares[at - 1].y}`;
    count = step === heading ? count + 1 : 1;
    heading = step;
  }
  const marks = budget.oncePerTurn.filter((entry) => entry !== before?.mark);
  storeBudget(encounter, { ...budget, oncePerTurn: [...marks, `${CHARGER_RAN}:${heading}:${count}`] });
}

// Whether the character's walk this turn ended in 10 feet on one heading.
export function ranStraight(encounter: Encounter | null, sheetId: string): boolean {
  const budget = ownBudget(encounter, sheetId);
  return Boolean(budget) && (runOf(budget as TurnBudget)?.squares ?? 0) >= CHARGER_RUN_TILES;
}

// Charger's shove after that run: the squares it pushes past the shove's own
// 5 feet, and the line the result carries. Null for any other shove.
export function chargerShove(encounter: Encounter | null, sheetId: string, feature: string | undefined): { tiles: number; note: string } | null {
  return feature === "Charger" && ranStraight(encounter, sheetId)
    ? { tiles: CHARGER_PUSH_TILES, note: "Charger: a 10-foot straight run first, so the shove pushes 10 feet farther" }
    : null;
}
