// The mood store (docs/specs/ogm-npc-perception.md §9): written from the
// events a mind took in, from its body and from words read for it; read into
// its frame. The rules are mood-logic's.
import { getDatabase } from "@/lib/db/core";
import { getBond } from "@/lib/db/npc-bonds";
import { getNpcById } from "@/lib/db/npcs";
import { moodles } from "@/lib/dm/body-logic";
import { appraise, renew, sameMoodlet, shapeByTemperament, EMOTIONS, type Emotion, type Moodlet } from "@/lib/dm/mood-logic";
import type { SceneEvent, SenseChannel } from "@/lib/dm/scene-events-logic";

type MoodRow = { emotion: string; toward: string; source: string; weight: number; started_at: number; expires_at: number };

export function listMoodlets(campaignId: string, npcId: string, now: number): Moodlet[] {
  return (getDatabase().prepare(`SELECT * FROM npc_moodlets WHERE campaign_id = ? AND npc_id = ? AND expires_at > ?`).all(campaignId, npcId, now) as MoodRow[])
    .filter((row) => (EMOTIONS as readonly string[]).includes(row.emotion))
    .map((row) => ({ emotion: row.emotion as Emotion, toward: row.toward, source: row.source, weight: row.weight, startedAt: row.started_at, expiresAt: row.expires_at }));
}

// New feelings for a mind, shaped by its temperament; the same cause toward
// the same person renews the old one instead of adding to it.
export function addMoodlets(campaignId: string, npcId: string, born: readonly Moodlet[]) {
  const npc = getNpcById(npcId);
  if (!npc || !born.length) {
    return;
  }
  const shaped = shapeByTemperament(born, npc.agency.personality ?? null);
  const db = getDatabase();
  const now = Math.min(...shaped.map((moodlet) => moodlet.startedAt));
  db.prepare(`DELETE FROM npc_moodlets WHERE campaign_id = ? AND npc_id = ? AND expires_at <= ?`).run(campaignId, npcId, now);
  const live = listMoodlets(campaignId, npcId, now);
  const upsert = db.prepare(
    `INSERT INTO npc_moodlets (campaign_id, npc_id, emotion, toward, source, weight, started_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, npc_id, emotion, toward, source) DO UPDATE SET weight = excluded.weight, started_at = excluded.started_at, expires_at = excluded.expires_at`,
  );
  for (const moodlet of shaped) {
    const old = live.find((entry) => sameMoodlet(entry, moodlet));
    const next = old ? renew(old, moodlet) : moodlet;
    upsert.run(campaignId, npcId, next.emotion, next.toward, next.source, next.weight, Math.floor(next.startedAt), Math.floor(next.expiresAt));
  }
}

// What one event a mind took in stirs in it.
export function moodsFromEvent(campaignId: string, npcId: string, observer: string, event: Pick<SceneEvent, "actor" | "verb" | "targets" | "object" | "instant" | "success">, channels: readonly SenseChannel[]) {
  const npc = getNpcById(npcId);
  if (!npc) {
    return;
  }
  const born = appraise(event, observer, channels, {
    careToward: (name) => getBond(campaignId, npcId, name)?.affection ?? 0,
    body: moodles(npc.state, event.instant),
  });
  addMoodlets(campaignId, npcId, born);
}
