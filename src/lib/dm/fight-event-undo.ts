import type { Campaign } from "@/lib/db/campaigns";
import {
  clearExplored,
  deleteToken,
  getBattleMapForEncounter,
  getToken,
  listTokens,
  placeToken,
  renameTokenByRef,
  setBattleMapTerrain,
  setTokenHidden,
} from "@/lib/db/battle-maps";
import { getDatabase } from "@/lib/db/core";
import { deleteEnemy, getEncounter, listEnemies, restoreEnemyState, saveEncounter } from "@/lib/db/encounters";
import { getFightEvent, rearmFightEvent, type ArmedFightEvent } from "@/lib/db/fight-events";
import { getCampaignMessage, updateMessageContent } from "@/lib/db/messages";
import { deleteNote } from "@/lib/db/notes";
import { recordTurnChange, type TurnChange } from "@/lib/db/turn-changes";
import { footprintLookup } from "@/lib/battlemap/view";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import {
  diffFightPictures,
  planTakeBack,
  takenBackLine,
  undoesNothing,
  type FightEventUndo,
  type FightPicture,
  type TakeBackPlan,
} from "@/lib/dm/fight-event-undo-logic";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishPersisted } from "@/lib/events";

// "Revert this turn" for a prepared fight's event (issue 685; the rules:
// fight-event-undo-logic.ts). An event fired during a turn is kept under it
// with what it did; the turn's revert puts that back, arms the event again
// so it fires when its moment comes round, and tells the chronicle its line
// was taken back. Before, the event stayed fired: replayed, the moment came
// and nothing happened.

export function fightPicture(encounterId: string): FightPicture | null {
  const encounter = getEncounter(encounterId);
  if (!encounter) {
    return null;
  }
  const enemies = listEnemies(encounterId);
  const map = getBattleMapForEncounter(encounterId);
  const footprint = footprintLookup(new Map(enemies.map((enemy) => [enemy.id, enemy])));
  return {
    encounterId,
    order: encounter.order,
    turnIndex: encounter.turnIndex,
    enemies: Object.fromEntries(
      enemies.map((enemy) => [
        enemy.id,
        {
          displayName: enemy.displayName,
          currentHp: enemy.currentHp,
          status: enemy.status,
          conditions: enemy.conditions,
          conditionMeta: enemy.conditionMeta,
        },
      ]),
    ),
    map: map ? { id: map.id, width: map.width, height: map.height, drawn: map.drawnTerrain, ground: map.terrain } : null,
    tokens: Object.fromEntries(
      (map ? listTokens(map.id) : []).map((token) => [
        token.id,
        { refId: token.refId, name: token.name, x: token.x, y: token.y, hidden: token.hidden, footprint: footprint(token) },
      ]),
    ),
  };
}

// Keeps what one event did under the turn it fired in.
export function recordFightEvent(
  campaign: Campaign,
  turnId: string,
  armed: ArmedFightEvent,
  before: FightPicture | null,
  told: { line: string; messageId: string | null; noteId: string | null },
) {
  const after = fightPicture(armed.encounterId);
  const undo = before && after ? diffFightPictures(before, after) : null;
  if ((!undo || undoesNothing(undo)) && !told.messageId && !told.noteId) {
    // It did nothing and said nothing; it is armed again all the same.
    recordTurnChange(campaign.id, turnId, "fight_event", { eventId: armed.id, encounterId: armed.encounterId, line: "", undo: null, messageId: null, noteId: null });
    return;
  }
  recordTurnChange(campaign.id, turnId, "fight_event", {
    eventId: armed.id,
    encounterId: armed.encounterId,
    // Nothing told: the log still needs a row to offer the revert on, and the
    // fight's own name may be the GM's secret.
    line: told.line || "A prepared event of the fight ran.",
    undo,
    messageId: told.messageId,
    noteId: told.noteId,
  });
}

type Payload = {
  eventId: string;
  encounterId: string;
  line: string;
  undo: FightEventUndo | null;
  messageId: string | null;
  noteId: string | null;
};

function payloadOf(change: TurnChange): Payload {
  const raw = change.payload;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    eventId: text(raw.eventId) ?? "",
    encounterId: text(raw.encounterId) ?? "",
    line: text(raw.line) ?? "",
    undo: raw.undo && typeof raw.undo === "object" ? (raw.undo as FightEventUndo) : null,
    messageId: text(raw.messageId),
    noteId: text(raw.noteId),
  };
}

// The fight the event belonged to, while it is still being fought.
function liveFight(payload: Payload) {
  const encounter = getEncounter(payload.encounterId);
  return encounter && encounter.status === "active" && getFightEvent(payload.eventId) ? encounter : null;
}

function planFor(payload: Payload): TakeBackPlan | null {
  const now = payload.undo ? fightPicture(payload.encounterId) : null;
  return payload.undo && now ? planTakeBack(payload.undo, now) : null;
}

// What the lead is told before saying yes.
export function fightEventWarnings(change: TurnChange): string[] {
  const payload = payloadOf(change);
  if (!liveFight(payload)) {
    return [`That fight is over, so what its plan did stays${payload.line ? `: ${payload.line}` : "."}`];
  }
  return planFor(payload)?.warnings ?? [];
}

function applyPlan(campaign: Campaign, plan: TakeBackPlan, encounterId: string) {
  const map = getBattleMapForEncounter(encounterId);
  getDatabase().transaction(() => {
    for (const tokenId of plan.removeTokens) {
      deleteToken(tokenId);
    }
    for (const enemyId of plan.removeEnemies) {
      deleteEnemy(enemyId);
    }
    for (const entry of plan.enemies) {
      restoreEnemyState(entry.id, entry.set);
    }
    if (plan.ground && map && map.id === plan.ground.mapId) {
      setBattleMapTerrain(map.id, plan.ground.drawn);
      // The ground changed again: fog memory of it goes, as for any change.
      clearExplored(map.id);
    }
    for (const entry of plan.tokens) {
      const token = getToken(entry.id);
      if (!token) {
        continue;
      }
      if (entry.set.x !== undefined && entry.set.y !== undefined) {
        placeToken(token.id, entry.set.x, entry.set.y);
      }
      if (entry.set.hidden !== undefined) {
        setTokenHidden(token.id, entry.set.hidden);
      }
      if (entry.set.name !== undefined && map) {
        renameTokenByRef(map.id, token.refId, entry.set.name);
      }
    }
    if (plan.order) {
      const encounter = getEncounter(encounterId);
      if (encounter) {
        encounter.order = plan.order.order;
        encounter.turnIndex = plan.order.turnIndex;
        saveEncounter(encounter);
      }
    }
  })();
  publishEncounter(campaign.id);
  if (map) {
    publishBattleMapUpdate(campaign.id);
  }
}

// Takes one event back. False when the fight is over and nothing could be.
export function takeBackFightEvent(campaign: Campaign, change: TurnChange): boolean {
  const payload = payloadOf(change);
  if (!liveFight(payload)) {
    return false;
  }
  const plan = planFor(payload);
  if (plan) {
    applyPlan(campaign, plan, payload.encounterId);
  }
  rearmFightEvent(payload.eventId);
  const message = payload.messageId ? getCampaignMessage(payload.messageId) : null;
  if (message) {
    const updated = updateMessageContent(message.id, takenBackLine(message.content), []);
    if (updated) {
      publishPersisted(campaign.id, "message_updated", { message: updated });
    }
  }
  if (payload.noteId) {
    deleteNote(payload.noteId);
  }
  return true;
}
