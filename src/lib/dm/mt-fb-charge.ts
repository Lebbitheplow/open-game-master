// A run at a creature, kept on the turn so the features that ride one can ask
// for it: Ferocious Charger ("when you move at least 10 feet in a straight line
// right before attacking a creature and hit it") and Totemic Attunement's tiger
// ("after moving at least 20 feet straight toward a Large or smaller target").
// Before this both were taken on the call's word: a cavalier who had not moved
// knocked a creature prone, and a tiger who stood still made the bonus attack.
//
// The board is squares, so "a straight line toward it" is measured as the feet
// the run brought the character nearer the creature: a run that curls away, or
// goes past, earns none of them. A character's own walk on their turn starts a
// run where they stood (noteRun, called by the two doors that walk a character:
// token-rules.ts walkCharacter and the board's move route); a melee attack ends
// it at the creature attacked (chargedBudget, called by attack-swing.ts), so the
// next walk is a new run. Everything that asks whether a character charged goes
// through chargedFeet (src/lib/srd/mt-fb-run.ts).
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { tilesApart } from "@/lib/dm/board-reach";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { ToolError } from "@/lib/dm/tool-errors";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { CHARGED, NATURAL_HIT, OPEN_RUN, RUN_FROM, chargedFeet } from "@/lib/srd/mt-fb-run";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The character walks on their own turn in a fight: the square they left is
// where the run began, unless one is already under way.
export function noteRun(campaignId: string, sheet: CharacterSheet, from: { x: number; y: number }) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || (encounter.kind ?? "fight") !== "fight") {
    return;
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget || budget.oncePerTurn.some((key) => key.startsWith(RUN_FROM))) {
    return;
  }
  storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, `${RUN_FROM}${from.x},${from.y}`] });
}

// How many feet nearer the creature the run brought its owner.
function runFeet(encounter: Encounter, ownerId: string, enemyId: string, run: string | undefined): number {
  const map = getBattleMapForEncounter(encounter.id);
  const mover = map ? getTokenByRef(map.id, ownerId) : null;
  const target = map ? getTokenByRef(map.id, enemyId) : null;
  if (!map || !mover || !target) {
    return OPEN_RUN;
  }
  if (!run) {
    return 0;
  }
  const [x, y] = run.slice(RUN_FROM.length).split(",").map(Number);
  const before = tilesApart({ ...mover, x, y }, target);
  return Math.max(0, before - tilesApart(mover, target)) * 5;
}

// The turn after a melee attack on a creature: the run under way ended at it.
// A second attack on the same creature keeps the feet of the run that brought
// the character there.
export function chargedBudget(encounter: Encounter, budget: TurnBudget, enemyId: string): TurnBudget {
  const run = budget.oncePerTurn.find((key) => key.startsWith(RUN_FROM));
  const feet = Math.max(chargedFeet(budget.oncePerTurn, enemyId), runFeet(encounter, budget.ownerId, enemyId, run));
  const kept = budget.oncePerTurn.filter((key) => !key.startsWith(RUN_FROM) && !key.startsWith(`${CHARGED}${enemyId}:`));
  return { ...budget, oncePerTurn: [...kept, `${CHARGED}${enemyId}:${feet}`] };
}

// The refusal of a spend that rides a charge (AuthoredSpend.chargeFeet) when
// the creature named was not run at this turn, or null.
export function chargeRefusal(campaignId: string, sheet: CharacterSheet, label: string, feet: number, enemyId: string | undefined): ToolError | null {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget && encounter.turnBudget.ownerId === sheet.id ? encounter.turnBudget : null;
  if (chargedFeet(budget?.oncePerTurn, enemyId) >= feet) {
    return null;
  }
  return {
    error: `${label} follows a run of at least ${feet} feet straight at the creature, right before the attack that hit it, and ${sheet.name} has made no such run this turn. Nothing was spent.`,
    refused: "rules",
  };
}

// The refusal of a spend that rides a natural weapon's hit
// (AuthoredSpend.afterNaturalHit) when none landed on the creature named this
// turn, or null. With no creature named, any such hit this turn opens it and
// the spend's own target rule picks the creature.
export function naturalHitRefusal(campaignId: string, sheet: CharacterSheet, label: string, enemyId: string | undefined): ToolError | null {
  const encounter = getActiveEncounter(campaignId);
  const marks = encounter?.turnBudget && encounter.turnBudget.ownerId === sheet.id ? encounter.turnBudget.oncePerTurn : [];
  if (enemyId ? marks.includes(`${NATURAL_HIT}${enemyId}`) : marks.some((mark) => mark.startsWith(NATURAL_HIT))) {
    return null;
  }
  return {
    error: `${label} rides a hit of ${sheet.name}'s natural weapon (bite, claws or tail) on the creature, and none has landed on it this turn: pc_attack with that weapon first. Nothing was spent.`,
    refused: "rules",
  };
}
