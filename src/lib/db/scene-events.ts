// The scene event store (docs/specs/ogm-npc-perception.md §5, §14): events,
// who perceived each, and each mind's cursor. Recording an event also leaves
// each perceiver one memory line of it, as they took it in: the memory is of
// the event, never of the narrator's prose.
import { bondsFromEvent } from "@/lib/db/npc-bonds";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { addNpcMemories } from "@/lib/db/npc-minds";
import { ON_STAGE_SOURCE } from "@/lib/dm/npc-mind-logic";
import { perceivedLine, SCENE_VERBS, SCENE_VOLUMES, type SceneEvent, type SenseChannel } from "@/lib/dm/scene-events-logic";
import type { Observer, Perception } from "@/lib/dm/senses-logic";

type EventRow = {
  seq: number;
  turn_id: string;
  instant: number;
  place: string;
  actor: string;
  verb: string;
  targets_json: string;
  object: string;
  zone_from: string;
  zone_to: string;
  volume: string;
  covert: number;
  stealth: number | null;
  success: number;
  speech: string;
  outcome: string;
  own_words: number;
};

function eventOf(row: EventRow): SceneEvent {
  return {
    seq: row.seq,
    turnId: row.turn_id,
    instant: row.instant,
    place: row.place,
    actor: row.actor,
    verb: (SCENE_VERBS as readonly string[]).includes(row.verb) ? (row.verb as SceneEvent["verb"]) : "other",
    targets: parseJson<string[]>(row.targets_json, []),
    object: row.object,
    zoneFrom: row.zone_from,
    zoneTo: row.zone_to,
    volume: (SCENE_VOLUMES as readonly string[]).includes(row.volume) ? (row.volume as SceneEvent["volume"]) : "normal",
    covert: row.covert === 1,
    stealth: row.stealth,
    success: row.success === 1,
    speech: row.speech,
    outcome: row.outcome,
    ownWords: row.own_words === 1,
  };
}

export function recordSceneEvent(
  campaignId: string,
  event: Omit<SceneEvent, "seq">,
  perceptions: readonly Perception[],
  observers: readonly Observer[],
): SceneEvent {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO scene_events (campaign_id, turn_id, instant, place, actor, verb, targets_json, object, zone_from, zone_to, volume, covert, stealth, success, speech, outcome, own_words, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      campaignId,
      event.turnId,
      Math.floor(event.instant),
      event.place,
      event.actor,
      event.verb,
      JSON.stringify(event.targets),
      event.object,
      event.zoneFrom,
      event.zoneTo,
      event.volume,
      event.covert ? 1 : 0,
      event.stealth,
      event.success ? 1 : 0,
      event.speech,
      event.outcome,
      event.ownWords ? 1 : 0,
      nowIso(),
    );
  const seq = Number(result.lastInsertRowid);
  const insert = db.prepare(`INSERT OR REPLACE INTO scene_perceptions (event_seq, campaign_id, npc_id, channels_json) VALUES (?, ?, ?, ?)`);
  const names = new Map(observers.map((observer) => [observer.id, observer.name]));
  for (const perception of perceptions) {
    insert.run(seq, campaignId, perception.observerId, JSON.stringify(perception.channels));
    // An attempt counts as the deed: a failed theft still shows the hand.
    bondsFromEvent(campaignId, perception.observerId, names.get(perception.observerId) ?? "", event, perception.channels);
    const line = perceivedLine(event, names.get(perception.observerId) ?? "", perception.channels);
    if (line) {
      addNpcMemories(campaignId, [perception.observerId], { kind: "knowledge", sourceKind: "perceived", sourceName: ON_STAGE_SOURCE, content: line, learnedAt: event.instant }, event.turnId);
    }
  }
  return { ...event, seq };
}

export type PerceivedEvent = { event: SceneEvent; channels: SenseChannel[] };

// What this mind took in after its cursor, oldest first, at most `limit`
// (the newest kept).
export function listPerceivedSince(campaignId: string, npcId: string, afterSeq: number, limit = 12): PerceivedEvent[] {
  const rows = getDatabase()
    .prepare(
      `SELECT e.*, p.channels_json AS channels FROM scene_perceptions p JOIN scene_events e ON e.seq = p.event_seq
       WHERE p.campaign_id = ? AND p.npc_id = ? AND p.event_seq > ? ORDER BY p.event_seq DESC LIMIT ?`,
    )
    .all(campaignId, npcId, afterSeq, limit) as Array<EventRow & { channels: string }>;
  return rows.reverse().map((row) => ({ event: eventOf(row), channels: parseJson<SenseChannel[]>(row.channels, []) }));
}

export type PerceptionCursor = { seq: number; instant: number };

export function getPerceptionCursor(npcId: string): PerceptionCursor | null {
  const row = getDatabase().prepare(`SELECT seq, instant FROM npc_perception_cursors WHERE npc_id = ?`).get(npcId) as PerceptionCursor | undefined;
  return row ?? null;
}

export function setPerceptionCursor(campaignId: string, npcId: string, cursor: PerceptionCursor) {
  getDatabase()
    .prepare(
      `INSERT INTO npc_perception_cursors (npc_id, campaign_id, seq, instant) VALUES (?, ?, ?, ?)
       ON CONFLICT(npc_id) DO UPDATE SET seq = excluded.seq, instant = excluded.instant`,
    )
    .run(npcId, campaignId, cursor.seq, Math.floor(cursor.instant));
}

export function lastSceneEventSeq(campaignId: string): number {
  const row = getDatabase().prepare(`SELECT MAX(seq) AS seq FROM scene_events WHERE campaign_id = ?`).get(campaignId) as { seq: number | null } | undefined;
  return row?.seq ?? 0;
}

// The words already heard as events this turn, so the narrator's retelling
// of them is not heard a second time.
export function speechHeardInTurn(campaignId: string, turnId: string): string[] {
  const rows = getDatabase().prepare(`SELECT speech FROM scene_events WHERE campaign_id = ? AND turn_id = ? AND speech <> ''`).all(campaignId, turnId) as Array<{ speech: string }>;
  return rows.map((row) => row.speech);
}
