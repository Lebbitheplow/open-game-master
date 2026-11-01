import { getDatabase } from "@/lib/db/core";
import { NO_PACING, parsePacing, type Pacing } from "@/lib/dm/romance-scene-logic";

// The storage half of a romance's pace (issue 643): one JSON column on the
// relationship row, read and written here alone so the row's own reader and
// patch (src/lib/db/relationships.ts) carry none of it. What it holds is
// src/lib/dm/romance-scene-logic.ts Pacing; the rules are that module and
// romance-pace-logic.ts.

export function readPacing(relationshipId: string): Pacing {
  const row = getDatabase().prepare(`SELECT pacing_json FROM relationships WHERE id = ?`).get(relationshipId) as
    | { pacing_json: string | null }
    | undefined;
  return row ? parsePacing(row.pacing_json ?? "") : NO_PACING;
}

export function writePacing(relationshipId: string, pacing: Pacing) {
  getDatabase().prepare(`UPDATE relationships SET pacing_json = ? WHERE id = ?`).run(JSON.stringify(pacing), relationshipId);
}

// The GM's narrations, as the scene engine counts replies: what the reroll
// offer and the console's exchange guard read as narration
// (src/lib/db/messages.ts getLatestDmMessage), so an out-of-character answer
// and a companion's own posted line are not replies.
const NARRATION = `campaign_id = ? AND author_type = 'dm' AND content NOT LIKE '(ooc)%'
  AND NOT COALESCE(user_id IS NULL AND dm_turn_id IS NULL AND json_array_length(speech_json) = 1 AND json_extract(speech_json, '$[0].speaker.kind') = 'pc', 0)`;

export function latestNarrationSeq(campaignId: string): number {
  const row = getDatabase().prepare(`SELECT MAX(seq) AS seq FROM campaign_messages WHERE ${NARRATION}`).get(campaignId) as
    | { seq: number | null }
    | undefined;
  return row?.seq ?? 0;
}

export function narrationsAfter(campaignId: string, seq: number): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE ${NARRATION} AND seq > ?`).get(campaignId, seq) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}
