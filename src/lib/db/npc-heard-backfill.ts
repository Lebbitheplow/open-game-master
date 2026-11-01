import type { SqliteDatabase } from "./driver.ts";
import { heardKey, namesHeard } from "@/lib/dm/cast-logic";

// The NPCs a table's transcript had already named when npcs gained
// heard_at (issue 650), marked heard as of the first GM or system message
// whose words, or the speakers its quoted lines were shown under, say the
// name (src/lib/dm/cast-logic.ts). A player's words do not count, as they do
// not in play (src/lib/dm/cast.ts noteNamesHeard). Run by the migration that
// adds the column (src/lib/db/core.ts), so an upgraded table's players keep
// every face and name they have already been shown. Takes the handle rather
// than opening one, since the migration runs while the database is still
// being opened. Read a campaign at a time, and only the campaigns that hold
// someone the party has not met. A rewind runs it for its one campaign
// (src/lib/db/snapshots.ts restoreSnapshot): a chapter snapshot taken before
// the column existed brings every NPC back unheard.
export function backfillNpcHeard(db: SqliteDatabase, campaignId?: string) {
  const strangers = (
    campaignId
      ? db.prepare(`SELECT id, campaign_id, name FROM npcs WHERE campaign_id = ? AND met_at = '' AND heard_at = ''`).all(campaignId)
      : db.prepare(`SELECT id, campaign_id, name FROM npcs WHERE met_at = '' AND heard_at = ''`).all()
  ) as Array<{ id: string; campaign_id: string; name: string }>;
  const byCampaign = new Map<string, Array<{ id: string; name: string }>>();
  for (const npc of strangers) {
    byCampaign.set(npc.campaign_id, [...(byCampaign.get(npc.campaign_id) ?? []), { id: npc.id, name: npc.name }]);
  }
  const passages = db.prepare(
    `SELECT content, speech_json, created_at FROM campaign_messages
     WHERE campaign_id = ? AND author_type != 'player' ORDER BY seq`,
  );
  const mark = db.prepare(`UPDATE npcs SET heard_at = ? WHERE id = ? AND heard_at = ''`);
  for (const [campaignId, cast] of byCampaign) {
    let unheard = cast;
    for (const row of passages.all(campaignId) as Array<{ content: string; speech_json: string | null; created_at: string }>) {
      const heard = new Set(namesHeard(unheard, [heardKey(row.content, speakersOf(row.speech_json))]).map((npc) => npc.id));
      if (!heard.size) {
        continue;
      }
      for (const id of heard) {
        mark.run(row.created_at, id);
      }
      unheard = unheard.filter((npc) => !heard.has(npc.id));
      if (!unheard.length) {
        break;
      }
    }
  }
}

// The names a message's quoted lines were shown under (src/lib/dm/speech.ts
// SpokenLine), from its stored speech.
function speakersOf(speechJson: string | null): string[] {
  let lines: unknown;
  try {
    lines = JSON.parse(speechJson ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(lines)
    ? lines.flatMap((line) => {
        const name = (line as { speaker?: { name?: unknown } } | null)?.speaker?.name;
        return typeof name === "string" ? [name] : [];
      })
    : [];
}
