// Who sits where at a test fight (issue 685, src/lib/workshop/test-fight.ts),
// the pure half: the seat a runner gives the author, the allies a test may
// bring, and what the author's console leaves to the AI at a test the AI
// runs. No "@/" imports, so a suite loads it directly.

import type { CompanionSetting } from "../schemas/game-settings-options.ts";
import { mergedCall } from "../dm/tool-merge-logic.ts";
import type { DmMode } from "../dm/viewer.ts";
import type { CampaignKind } from "./kind.ts";

// The most allies a test seats beside its heroes: the most lasting
// companions any table allows (game-settings.ts MAX_COMPANIONS_CAP). Allies
// do not count against the party's own cap, which is the target party's
// size: the fight's budget is measured against the heroes, and an ally is
// what the fight adds to them.
export const TEST_ALLY_LIMIT = 4;

// The seat each runner gives the author. A person runs the test from the GM
// seat ("human"). The AI GM runs it with the author in the steering seat
// ("steered", src/lib/dm/viewer.ts): the AI narrates every turn and runs the
// enemies as at a table the AI runs, and the author holds the console beside
// the party, for set-ups and corrections without asking the AI through
// Direct (gap 2 of issue 685). Tests opened before this read "ai": nobody
// holds a GM seat there.
export function testFightDmMode(runner: "ai" | "person"): DmMode {
  return runner === "ai" ? "steered" : "human";
}

// Whether the AI GM runs a test table of this mode: the enemies, and the
// allies nobody commands, are its to play.
export function aiRunsTest(dmMode: DmMode | undefined): boolean {
  return dmMode === "steered" || dmMode === "ai";
}

export function aiRunsTestTable(row: { kind: CampaignKind; gameSettings: { dmMode: DmMode } }): boolean {
  return row.kind === "playtest" && aiRunsTest(row.gameSettings.dmMode);
}

// The test table's companions setting: the workshop's own, so the fight
// plays as a table built from the workshop would. Allies the author seated
// need the setting on: with "off" the AI's prompt drops the rules it plays
// companions by (src/lib/dm/prompt.ts), and the console's Add a companion
// refuses. Picking allies is the author saying this fight has them.
export function testCompanionsSetting(workshop: CompanionSetting, allies: number): CompanionSetting {
  return allies > 0 && workshop === "off" ? "full" : workshop;
}

// The console calls in which an enemy acts or spends something of its own:
// an attack, an action, an ability or a spell it uses, a legendary action or
// resistance, its flight, and the lair's own action. Read after the merge
// (tool-merge-logic.ts), so a retired name or an old field name is caught
// as the call it became. A call that only does something TO an enemy (damage,
// a condition, a move of its token) is a set-up or a correction, not a turn.
const ENEMY_ACTS = new Set(["enemy_attack", "enemy_flees", "take_action", "legendary_action", "legendary_resist"]);

function named(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function enemyActsIn(name: string, args: Record<string, unknown>): boolean {
  const call = mergedCall(name, args);
  if (call.name === "lair_action" || named(call.args.casterEnemyId)) {
    return true;
  }
  return ENEMY_ACTS.has(call.name) && named(call.args.enemyId);
}

export const AI_RUNS_FOES =
  "The AI GM runs the enemies at this test, so their attacks, actions and abilities are its to play. Ask for a move with Direct, set the board up from the console (damage, conditions, positions), or run the test yourself to play the enemies.";

export const AI_RUNS_TURNS =
  "The AI GM plays the enemies' turns at this test, and the turns of any ally nobody commands. To play an ally yourself, take command of them on their card in the Party panel.";

// The refusal for a person's console call at a test the AI runs, or null.
export function testConsoleRefusal(
  row: { kind: CampaignKind; gameSettings: { dmMode: DmMode } },
  name: string,
  args: Record<string, unknown>,
): string | null {
  return aiRunsTestTable(row) && enemyActsIn(name, args) ? AI_RUNS_FOES : null;
}
