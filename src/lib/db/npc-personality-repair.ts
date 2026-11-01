import type { SqliteDatabase } from "./driver.ts";
import { parsePersonality, repairSkewedPersonality } from "@/lib/dm/npc-logic";
import type { Attitude } from "@/lib/db/npcs";

type Row = {
  id: string;
  name: string;
  trait: string;
  attitude: Attitude;
  aliases_json: string;
  personality_json: string;
  companion_snapshot_json: string;
  sheet_name: string | null;
  sheet_personality: string | null;
};

// The personalities saved from derivePersonality's skewed spread, moved onto
// the corrected one (issue 732, src/lib/dm/npc-logic.ts
// repairSkewedPersonality). Most rows hold one: registering an NPC saves the
// derived personality (set_npc, npc_reaction), and so does a lasting
// companion's row, seeded from the sheet's name and personality text, which
// a departed companion keeps in its snapshot. Run once by the migration
// (src/lib/db/core.ts), and for its one campaign by a rewind
// (src/lib/db/snapshots.ts restoreSnapshot), whose snapshot may predate the
// fix. A repaired row is never moved again. Returns how many it moved.
export function repairSkewedPersonalities(db: SqliteDatabase, campaignId?: string): number {
  const select = `SELECT n.id, n.name, n.trait, n.attitude, n.aliases_json, n.personality_json, n.companion_snapshot_json,
                         s.name AS sheet_name, s.personality AS sheet_personality
                    FROM npcs n LEFT JOIN character_sheets s ON s.id = n.companion_sheet_id AND n.companion_sheet_id != ''
                   WHERE n.personality_json != ''`;
  const rows = (
    campaignId ? db.prepare(`${select} AND n.campaign_id = ?`).all(campaignId) : db.prepare(select).all()
  ) as Row[];
  const update = db.prepare(`UPDATE npcs SET personality_json = ? WHERE id = ?`);
  let moved = 0;
  for (const row of rows) {
    const saved = parsePersonality(row.personality_json);
    if (!saved) {
      continue;
    }
    const repaired = repairSkewedPersonality(saved, seedsOf(row), row.attitude);
    if (repaired) {
      update.run(JSON.stringify(repaired), row.id);
      moved += 1;
    }
  }
  return moved;
}

// Every name and text the row's personality may have been seeded from.
function seedsOf(row: Row): Array<{ name: string; trait: string }> {
  const seeds = [row.name, ...strings(row.aliases_json)].map((name) => ({ name, trait: row.trait }));
  if (row.sheet_name !== null) {
    seeds.push({ name: row.sheet_name, trait: row.sheet_personality ?? "" });
  }
  const departed = snapshotSheet(row.companion_snapshot_json);
  if (departed) {
    seeds.push(departed);
  }
  return seeds;
}

function strings(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function snapshotSheet(raw: string): { name: string; trait: string } | null {
  if (!raw) {
    return null;
  }
  try {
    const sheet = (JSON.parse(raw) as { sheet?: { name?: unknown; personality?: unknown } } | null)?.sheet;
    return sheet && typeof sheet.name === "string"
      ? { name: sheet.name, trait: typeof sheet.personality === "string" ? sheet.personality : "" }
      : null;
  } catch {
    return null;
  }
}
