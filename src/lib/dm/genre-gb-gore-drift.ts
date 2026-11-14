// Gore Drift (road warrior 11, Highway Reaver): "After you hit with Ram Speed,
// make one extra attack against a different creature within reach"
// (src/lib/classes/post-apocalyptic-features.json; WAVE2 D5: the genre text is
// the rule, played on the SRD 5.1 engine).
//
// A Ram Speed hit is a melee hit at the end of a run of 20 feet or more
// straight at the creature (src/lib/dm/genre-run-hits.ts reads the same run).
// Once a turn it adds one attack to the turn's count, marked with the creature
// it struck (src/lib/dm/attack-blow.ts calls goreDrift after the blow); the
// attack plan (src/lib/dm/pc-attack-plan.ts) refuses the last attack of the
// turn at that creature while the drift's attack has not gone to another, so
// the extra one lands elsewhere. Reach is the swing's own: a creature out of
// it is refused as any melee attack is.
//
// Before this the feature was its sentence in the GM's prompt.
import type { AttackRecord } from "@/lib/dm/attack-record";
import { attackTurn, type SwingScene } from "@/lib/dm/attack-swing";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { storeBudget } from "@/lib/dm/turn-budget";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";
import { chargedFeet } from "@/lib/srd/mt-fb-run";

const DRIFT = "gore drift";
const OTHER = `${DRIFT}:other`;
// Ram Speed: "When you move 20+ ft straight toward a target".
const RAM_RUN_FT = 20;

export function goreDrift(scene: SwingScene, record: AttackRecord): string | null {
  const { campaign, sheet, enemy } = scene;
  if (!record.melee || !holdsGenreFeature(sheet, "road_warrior", "Gore Drift") || !holdsGenreFeature(sheet, "road_warrior", "Ram Speed")) {
    return null;
  }
  const turn = attackTurn(campaign.id, record);
  if (!turn) {
    return null;
  }
  const marks = turn.budget.oncePerTurn;
  const struck = marks.find((mark) => mark.startsWith(`${DRIFT}:`) && mark !== OTHER);
  if (struck) {
    // A hit on another creature while the drift stands: the extra attack has
    // gone where the text sends it.
    if (struck !== `${DRIFT}:${enemy.id}` && !marks.includes(OTHER)) {
      storeBudget(turn.encounter, { ...turn.budget, oncePerTurn: [...marks, OTHER] });
    }
    return null;
  }
  if (marks.includes(DRIFT) || chargedFeet(marks, enemy.id) < RAM_RUN_FT) {
    return null;
  }
  storeBudget(turn.encounter, { ...turn.budget, attacksAllowed: turn.budget.attacksAllowed + 1, oncePerTurn: [...marks, DRIFT, `${DRIFT}:${enemy.id}`] });
  return `Gore Drift: the Ram Speed hit grants one more attack this turn, against a creature other than ${enemy.displayName} within reach.`;
}

// The turn's last attack aimed at the rammed creature while the drift's extra
// attack has gone nowhere else: refused, with what to do instead.
export function goreDriftRefusal(budget: TurnBudget | null | undefined, enemyId: string, enemyName: string): string | null {
  if (!budget) {
    return null;
  }
  const marks = budget.oncePerTurn;
  if (!marks.includes(`${DRIFT}:${enemyId}`) || marks.includes(OTHER) || budget.attacksMade + 1 !== budget.attacksAllowed) {
    return null;
  }
  return `Gore Drift's extra attack is against a creature other than ${enemyName}: aim it at another creature within reach, or end the attacks here.`;
}
