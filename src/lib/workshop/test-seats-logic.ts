// Who sits where at a test fight (issue 685, src/lib/workshop/test-fight.ts),
// the pure half: the seat a runner gives the author, the allies a test may
// bring, and what the author's console leaves to the AI at a test the AI
// runs, and what a steering seat's cards leave to it at any table it runs.
// No "@/" imports, so a suite loads it directly.

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

// Whether the AI GM plays the enemies, and the allies nobody commands, at a
// table of this mode, live or a test: it narrates every turn, and its turn
// plays the enemies the pointer walked past, its end playing any it left
// (src/lib/dm/enemies-due.ts, encounter-tools.ts advanceAfterTurn). That is
// so with nobody in a GM seat ("ai") and with a person steering beside it
// ("steered", src/lib/dm/viewer.ts): hasHumanDm is false there, so a move
// wakes the AI's turn (src/lib/dm/loop.ts requestDmTurn) and no person is
// the one playing the monsters (enemies-due.ts personRunsTable).
// The steering seat keeps the console's forms for corrections; the monsters'
// Hand and an ally's are not theirs (issue 685 audit, section 7).
export function aiRunsFoes(dmMode: DmMode | undefined): boolean {
  return dmMode === "steered" || dmMode === "ai";
}

// The same rule at a test table: kept by this name for its callers.
export function aiRunsTest(dmMode: DmMode | undefined): boolean {
  return aiRunsFoes(dmMode);
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

// At a live table the AI runs with a person steering, the console's forms
// stay the steering seat's to correct the fight with; the monsters' cards
// are the AI's turn, played twice if the seat played them too.
export const AI_PLAYS_FOES =
  "The AI GM plays the enemies at this table, so their cards are its to play. Ask for a move with Direct, or correct one with the console's forms.";

// The refusal for a person's call in which an enemy acts, or null. At a test
// the AI runs, every such call from the console (the author holds every seat
// there, and the test measures the AI's play). At a live table the AI runs,
// only a monsters' Hand card (`hand`), the console's own form going through.
export function enemyCallRefusal(
  row: { kind: CampaignKind; gameSettings: { dmMode: DmMode } },
  name: string,
  args: Record<string, unknown>,
  from: { hand?: boolean } = {},
): string | null {
  if (!enemyActsIn(name, args)) {
    return null;
  }
  if (aiRunsTestTable(row)) {
    return AI_RUNS_FOES;
  }
  return from.hand && aiRunsFoes(row.gameSettings.dmMode) ? AI_PLAYS_FOES : null;
}

// The refusal for a GM seat's move for a character whose turn the AI plays
// at a table it runs (an ally nobody commands, a hero the other side
// dominates): the seat's Hand for it is not offered, and an older screen
// that still offers it hears why rather than "You need a character to act".
export function aiTurnRefusal(row: { kind: CampaignKind }, name: string): string {
  return row.kind === "playtest"
    ? AI_RUNS_TURNS
    : `The AI GM plays ${name}'s turn at this table, as it plays the enemies'. Ask for a move with Direct.`;
}
