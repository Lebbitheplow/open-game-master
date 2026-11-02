import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getBattleMapForEncounter,
  getTokenByRef,
  listHiddenRefIds,
  listTokens,
  placeToken,
} from "@/lib/db/battle-maps";
import { closeStandInTurn, openStandInTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, listEnemies, type EncounterEnemy } from "@/lib/db/encounters";
import {
  armFightEvents,
  claimFightEvent,
  hasArmedFightEvents,
  listFightEvents,
  recordFightEventLines,
  type ArmedFightEvent,
} from "@/lib/db/fight-events";
import type { EncounterTemplate } from "@/lib/db/encounter-templates";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertNote } from "@/lib/db/notes";
import { listSheets } from "@/lib/db/sheets";
import { publishWithSeq } from "@/lib/events";
import { nearestOpenTile } from "@/lib/battlemap/paint";
import { tileIndex } from "@/lib/battlemap/types";
import { occupiedTiles } from "@/lib/battlemap/view";
import { setTokenVisibility } from "@/lib/dm/board";
import { applyExtraEncounterCall } from "@/lib/dm/encounter-tools-extra";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { fixEnemyHp } from "@/lib/dm/enemy-hp-fix";
import { expandRoster, matchSlots } from "@/lib/dm/encounter-template-logic";
import {
  actionWords,
  FIGHT_EVENT_LIMITS,
  fitEventsToBoard,
  hurtTarget,
  outcomeLine,
  triggerMet,
  UNSEEN,
  type FightAction,
  type FightMoment,
} from "@/lib/dm/fight-event-logic";
import { changeGround, preparedBoard } from "@/lib/dm/fight-ground";
import { recordFightEvent } from "@/lib/dm/fight-event-undo";
import { liveTurnChangeOf } from "@/lib/db/turn-changes";
import { dissolveTurn, holdPrune, releasePrune } from "@/lib/db/turn-rows";
import { currentTurnId, runInTurnScope } from "@/lib/dm/job-control";
import { isDefeated } from "@/lib/dm/knockout";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { tableNoteSeq } from "@/lib/dm/narration-slot";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A prepared fight's events at the table (issue 685; what they are:
// src/lib/dm/fight-event-logic.ts). Armed when the fight is deployed, by a
// GM's Deploy or the storyteller's run_prepared_encounter alike
// (template-apply.ts); the "fight starts" ones run there and then, before
// anyone's first turn.
//
// The rest are checked where an engine call finishes (encounter-tools.ts
// settleTurn: the model's calls, the console, the GM's controls, a parked
// roll answered), and where the pointer moves outside one (a player's End
// Turn, the lead's skip, the close of the storyteller's turn, the start of
// the next). Not deep in the round change or the blow that bloodied a
// creature: the code there holds the encounter it read and saves it after,
// and an event that brought in reinforcements in the middle of that would see
// them dropped from the order by the save. So "round 3 begins" is read as
// "the round is 3 or more" once the move that began it has landed, and "the
// boss falls" as "the boss is out of the fight", each event once.
//
// Every action goes through the handler the console's own call reaches, as a
// person's call: add_enemies for reinforcements (their initiative rolled as
// the engine rolls any arrival's, the budget and the cap refusing as they
// would), set and clear condition, the GM's correction of an enemy's hit
// points, the board's hide and reveal, the painter for a change of ground
// (src/lib/dm/fight-ground.ts). A person, because the plan is the
// GM's own call made in advance, not the model's: the rails that keep a
// model from binding a creature without a save are for what a model decides.
// Nothing here rolls a die for a result or sets one.

// Campaigns firing now: an action's own work never fires a second round of
// events inside the first.
const firing = new Set<string>();

// The creature a slot became, as the table may name it.
function tableName(enemy: EncounterEnemy, hidden: Set<string>): string {
  return hidden.has(enemy.id) ? UNSEEN : enemy.displayName;
}

function hiddenNow(encounterId: string): Set<string> {
  const map = getBattleMapForEncounter(encounterId);
  return new Set(map ? listHiddenRefIds(map.id) : []);
}

function momentOf(round: number, slots: Record<number, string>): FightMoment {
  const states: FightMoment["slots"] = new Map();
  for (let slot = 0; slot < FIGHT_EVENT_LIMITS.slots; slot += 1) {
    const enemy = slots[slot] ? getEnemy(slots[slot]) : null;
    if (enemy) {
      states.set(slot, { hp: enemy.currentHp, maxHp: enemy.maxHp, defeated: isDefeated(enemy) });
    }
  }
  return { round, slots: states };
}

// Where a wave comes in is the plan's, as the deploy places the fight's own
// creatures (template-apply.ts): set down, not walked, since a move_token
// would spend movement and draw opportunity attacks the newcomer never had a
// turn to risk. With no anchor the engine's own spot stands.
function placeArrivals(campaign: Campaign, encounterId: string, arrivals: EncounterEnemy[], anchor: { x: number; y: number } | null) {
  const map = getBattleMapForEncounter(encounterId);
  if (!map || !anchor) {
    return;
  }
  const tokens = listTokens(map.id);
  const taken = occupiedTiles(map, tokens, null);
  for (const enemy of arrivals) {
    const token = tokens.find((entry) => entry.refId === enemy.id);
    if (!token) {
      continue;
    }
    taken.delete(tileIndex(map.width, token.x, token.y));
    const spot = nearestOpenTile(map.terrain, map.width, map.height, anchor, taken);
    taken.add(tileIndex(map.width, spot.x, spot.y));
    placeToken(token.id, spot.x, spot.y);
  }
  publishBattleMapUpdate(campaign.id);
}

function anchorFor(encounterId: string, armed: ArmedFightEvent, action: Extract<FightAction, { kind: "reinforce" }>) {
  if (action.at === "entry") {
    return armed.entry;
  }
  if (action.at === "slot" && action.slot !== undefined) {
    const map = getBattleMapForEncounter(encounterId);
    const enemyId = armed.slots[action.slot];
    const token = map && enemyId ? getTokenByRef(map.id, enemyId) : null;
    return token ? { x: token.x, y: token.y } : null;
  }
  return null;
}

type Done = { line: string } | { refused: string };

function runAction(
  campaign: Campaign,
  turn: DmTurn,
  armed: ArmedFightEvent,
  action: FightAction,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  label: (slot: number) => string,
): Done {
  const encounterId = armed.encounterId;
  if (action.kind === "say") {
    return { line: outcomeLine({ kind: "say", text: action.text }) };
  }
  if (action.kind === "reinforce") {
    const before = new Set(listEnemies(encounterId).map((enemy) => enemy.id));
    const result = applyExtraEncounterCall(campaign, turn, "add_enemies", JSON.stringify({ enemies: action.enemies }), sheets, sheetsById)?.result;
    if (!result || typeof result.error === "string") {
      return { refused: `${actionWords(action, label)}: ${String(result?.error ?? "the engine could not add them")}` };
    }
    const arrivals = listEnemies(encounterId).filter((enemy) => !before.has(enemy.id));
    placeArrivals(campaign, encounterId, arrivals, anchorFor(encounterId, armed, action));
    const hidden = hiddenNow(encounterId);
    return { line: outcomeLine({ kind: "reinforce", names: arrivals.map((enemy) => tableName(enemy, hidden)) }) };
  }
  if (action.kind === "ground") {
    const done = changeGround(campaign, armed, action);
    return "refused" in done ? { refused: `${actionWords(action, label)}: ${done.refused}` } : done;
  }
  const enemyId = armed.slots[action.slot];
  const enemy = enemyId ? getEnemy(enemyId) : null;
  if (!enemy || enemy.encounterId !== encounterId || enemy.status !== "alive") {
    return { refused: `${actionWords(action, label)}: ${label(action.slot)} is not in the fight.` };
  }
  if (action.kind === "hurt") {
    const target = hurtTarget(action, enemy.currentHp, enemy.maxHp);
    if (target === null) {
      return { line: "" };
    }
    const fixed = fixEnemyHp(enemy, target);
    if ("error" in fixed) {
      return { refused: `${actionWords(action, label)}: ${fixed.error}` };
    }
    return { line: outcomeLine({ kind: "hurt", name: tableName(enemy, hiddenNow(encounterId)), half: target * 2 <= enemy.maxHp }) };
  }
  if (action.kind === "condition") {
    const tool = action.remove ? "clear_enemy_condition" : "set_enemy_condition";
    const result = applyExtraEncounterCall(campaign, turn, tool, JSON.stringify({ enemyId: enemy.id, condition: action.condition }), sheets, sheetsById)?.result;
    if (!result || typeof result.error === "string") {
      return { refused: `${actionWords(action, label)}: ${String(result?.error ?? "the engine could not do it")}` };
    }
    // "Already prone": nothing happened to tell.
    if (!action.remove && typeof result.condition !== "string") {
      return { line: "" };
    }
    return {
      line: outcomeLine({ kind: "condition", name: tableName(enemy, hiddenNow(encounterId)), condition: action.condition, remove: action.remove }),
    };
  }
  // Visibility: the board's own hide and reveal.
  const map = getBattleMapForEncounter(encounterId);
  const token = map ? getTokenByRef(map.id, enemy.id) : null;
  if (!map || !token) {
    return { refused: `${actionWords(action, label)}: ${label(action.slot)} has no token on the board.` };
  }
  if (token.hidden === action.hidden) {
    return { line: "" };
  }
  const shown = setTokenVisibility(campaign, token.id, action.hidden);
  if ("error" in shown) {
    return { refused: `${actionWords(action, label)}: ${shown.error}` };
  }
  return { line: outcomeLine({ kind: "visibility", name: enemy.displayName, hidden: action.hidden }) };
}

// The slot labels the GM wrote the plan against, for the GM's own note.
function slotLabels(armed: ArmedFightEvent): (slot: number) => string {
  return (slot) => {
    const enemy = armed.slots[slot] ? getEnemy(armed.slots[slot]) : null;
    return enemy?.displayName ?? `creature ${slot + 1}`;
  };
}

// One event, its actions in the order the GM wrote them, on a person's turn
// the engine opens for work it does on its own (dm-turns.ts openStandInTurn).
// The table reads one line of what happened; what the rules refused goes to
// the GM alone, in a note beside the fight's plan.
//
// It is kept under the turn it fired in, so "Revert this turn" arms it again
// (fight-event-undo.ts) as it puts back what it did, which the turn's fight
// rows hold (src/lib/db/turn-rows.ts). Fired where no turn runs (a player's
// End Turn), the stand-in is that turn: what the event rolls and changes is
// filed under it, and its revert takes all of it.
function runEvent(campaign: Campaign, armed: ArmedFightEvent): string {
  const turn = openStandInTurn(campaign.id);
  try {
    const owner = currentTurnId();
    return owner ? playEvent(campaign, armed, turn, owner) : runInTurnScope(turn.id, () => playEvent(campaign, armed, turn, turn.id));
  } finally {
    closeStandInTurn(turn);
  }
}

function playEvent(campaign: Campaign, armed: ArmedFightEvent, turn: DmTurn, owner: string): string {
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const label = slotLabels(armed);
  const lines: string[] = [];
  const refused: string[] = [];
  for (const action of armed.event.actions) {
    if (!getActiveEncounter(campaign.id)) {
      break;
    }
    const done = runAction(campaign, turn, armed, action, sheets, sheetsById, label);
    if ("refused" in done) {
      refused.push(done.refused);
    } else if (done.line) {
      lines.push(done.line);
    }
  }
  publishEncounter(campaign.id);
  const content = lines.join(" ");
  let messageId: string | null = null;
  if (content) {
    const seq = tableNoteSeq(campaign.id);
    const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-battle", content });
    publishWithSeq(campaign.id, seq, "message_added", { message });
    messageId = message.id;
  }
  let noteId: string | null = null;
  if (refused.length) {
    noteId = insertNote({
      campaignId: campaign.id,
      characterId: null,
      authorUserId: campaign.ownerUserId,
      authorKind: "dm",
      visibility: "private",
      status: "active",
      title: `${armed.templateName}: what an event could not do`,
      body: refused.join("\n"),
      seq: allocateSeq(campaign.id),
    }).id;
  }
  recordFightEventLines(armed.id, lines);
  recordFightEvent(campaign, owner, armed, { line: content, messageId, noteId });
  return content;
}

// A player's End Turn and the lead's skip move the fight on where no GM turn
// runs. In a fight whose plan still holds an event, the move is a turn of its
// own, opened before it: the round it begins, the turn it hands on and the
// event it brings on are one change "Revert this turn" takes back together,
// so the event, armed again, waits for its round to come round again, as at
// an AI turn. A move that brought on no event leaves no turn behind: it is
// the player's, as it always was (src/lib/db/turn-rows.ts dissolveTurn).
export function asEventTurn<T>(campaignId: string, move: () => T): T {
  const encounter = getActiveEncounter(campaignId);
  if (currentTurnId() || !encounter || !hasArmedFightEvents(encounter.id)) {
    return move();
  }
  const turn = openStandInTurn(campaignId);
  holdPrune(turn.id);
  try {
    return runInTurnScope(turn.id, move);
  } finally {
    closeStandInTurn(turn);
    if (!liveTurnChangeOf(campaignId, turn.id, "fight_event")) {
      dissolveTurn(campaignId, turn.id);
    }
    releasePrune(campaignId, turn.id);
  }
}

// Runs every event the fight has come to, each once, and returns what the
// table was told. An event's actions may bring on another (a wound that
// bloodies the captain); a few passes settle it, and none fires twice.
export function fireFightEvents(campaign: Campaign): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || firing.has(campaign.id) || !hasArmedFightEvents(encounter.id)) {
    return [];
  }
  firing.add(campaign.id);
  try {
    const told: string[] = [];
    for (let pass = 0; pass < FIGHT_EVENT_LIMITS.events; pass += 1) {
      // Read fresh each pass: the last one's actions changed the fight, and
      // may have ended it, which disarms the rest.
      const live = getActiveEncounter(campaign.id);
      if (!live || live.id !== encounter.id) {
        break;
      }
      const armed = listFightEvents(live.id);
      const waiting = armed.filter((entry) => !entry.firedAt);
      if (!waiting.length) {
        break;
      }
      const due = waiting.filter((entry) => triggerMet(entry.event.trigger, momentOf(live.round, entry.slots)));
      if (!due.length) {
        break;
      }
      for (const entry of due) {
        // Claimed before it runs: an event that fails halfway is not run
        // again, which "once" means at a table.
        if (claimFightEvent(entry.id)) {
          const line = runEvent(campaign, entry);
          if (line) {
            told.push(line);
          }
        }
      }
    }
    return told;
  } finally {
    firing.delete(campaign.id);
  }
}

// Arms a prepared fight's events on the fight it just started, and runs the
// "fight starts" ones. `matched`: the enemy each slot became, read before
// the plan renamed any (template-apply.ts). A change of ground is kept only
// when the fight stands on its own prepared map, its squares fitted to it.
export function armTemplateEvents(
  campaign: Campaign,
  template: EncounterTemplate,
  matched: Map<number, { id: string }>,
): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!template.extras.events?.length || !encounter) {
    return [];
  }
  const board = preparedBoard(campaign, template, encounter.id);
  const events = fitEventsToBoard(template.extras.events, board);
  if (!events.length) {
    return [];
  }
  armFightEvents({
    campaignId: campaign.id,
    encounterId: encounter.id,
    templateName: template.name,
    events,
    slots: Object.fromEntries([...matched].map(([slot, enemy]) => [slot, enemy.id])),
    entry: template.extras.entry,
    board,
  });
  return fireFightEvents(campaign);
}

// The slot each roster creature became, matched in roster order.
export function matchTemplateSlots(template: EncounterTemplate, encounterId: string) {
  const enemies = listEnemies(encounterId).filter((enemy) => enemy.status === "alive");
  return matchSlots(expandRoster(template.enemies), enemies);
}

// For the storyteller's GAME STATE: what the plan has already done in this
// fight, so the model narrates it and never does it again with a tool. Empty
// when nothing has fired, so a fight without events costs nothing.
export function firedEventsBlock(campaignId: string): string {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return "";
  }
  const lines = listFightEvents(encounter.id)
    .filter((entry) => entry.firedAt && entry.lines.length)
    .map((entry) => `- ${entry.lines.join(" ")}`);
  return lines.length
    ? `Prepared events that have happened in this fight (the server already did them; narrate them as part of the scene, and never repeat them with a tool):\n${lines.join("\n")}`
    : "";
}

// The same, for a tool result: what just fired during the model's call.
export function firedEventsNote(lines: string[]): string {
  return `A prepared event of this fight just happened (the server did it; narrate it, do not repeat it with a tool): ${lines.join(" ")}`;
}
