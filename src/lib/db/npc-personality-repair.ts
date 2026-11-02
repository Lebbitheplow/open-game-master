import type { SqliteDatabase } from "./driver.ts";
import { parsePersonality, repairSkewedPersonality } from "@/lib/dm/npc-logic";
import type { Attitude } from "@/lib/db/npcs";
import { textKey } from "@/lib/language/text-logic";

type Row = {
  id: string;
  campaign_id: string;
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
// fix, and by a module's import (src/lib/db/workshop-bundle.ts). A repaired
// row is never moved again. Returns how many it moved.
export function repairSkewedPersonalities(db: SqliteDatabase, campaignId?: string): number {
  const select = `SELECT n.id, n.campaign_id, n.name, n.trait, n.attitude, n.aliases_json, n.personality_json, n.companion_snapshot_json,
                         s.name AS sheet_name, s.personality AS sheet_personality
                    FROM npcs n LEFT JOIN character_sheets s ON s.id = n.companion_sheet_id AND n.companion_sheet_id != ''
                   WHERE n.personality_json != ''`;
  const rows = (
    campaignId ? db.prepare(`${select} AND n.campaign_id = ?`).all(campaignId) : db.prepare(select).all()
  ) as Row[];
  const update = db.prepare(`UPDATE npcs SET personality_json = ? WHERE id = ?`);
  const notes = new Map<string, Map<string, Set<string>>>();
  let moved = 0;
  for (const row of rows) {
    const saved = parsePersonality(row.personality_json);
    if (!saved) {
      continue;
    }
    // The old spread put every axis at -3..-1, so only a row whose undrifted
    // axes all sit there is worth reading the campaign's turns for.
    const couldBeSkewed = saved.drive < 0 && saved.diligence < 0 && saved.boldness < 0;
    let given: Map<string, Set<string>> | undefined;
    if (couldBeSkewed) {
      given = notes.get(row.campaign_id) ?? notesTheAiGave(db, row.campaign_id);
      notes.set(row.campaign_id, given);
    }
    const repaired = repairSkewedPersonality(saved, seedsOf(row, given), row.attitude);
    if (repaired) {
      update.run(JSON.stringify(repaired), row.id);
      moved += 1;
    }
  }
  return moved;
}

// Every name and text the row's personality may have been seeded from: each
// name it answers to with its note today and every note the AI gave that
// name, then a companion's sheet.
function seedsOf(row: Row, given?: Map<string, Set<string>>): Array<{ name: string; trait: string }> {
  const seeds: Array<{ name: string; trait: string }> = [];
  for (const name of [row.name, ...strings(row.aliases_json)]) {
    for (const trait of new Set([row.trait, ...(given?.get(textKey(name)) ?? [])])) {
      seeds.push({ name, trait });
    }
  }
  if (row.sheet_name !== null) {
    seeds.push({ name: row.sheet_name, trait: row.sheet_personality ?? "" });
  }
  const departed = snapshotSheet(row.companion_snapshot_json);
  if (departed) {
    seeds.push(departed);
  }
  return seeds;
}

// The notes the AI gave each name it registered or met (set_npc,
// npc_reaction), read back from the calls its turns keep
// (dm_turns.conversation_json). A personality is seeded from the note an NPC
// has when it is registered, and set_npc rewrites that note as the story
// goes (it is the AI's own recall note), so the note on the row today is
// often not the one its personality came from. A call that gave no note
// registered them with none. Keyed by the name's textKey, as getNpcByName
// matches it.
function notesTheAiGave(db: SqliteDatabase, campaignId: string): Map<string, Set<string>> {
  const notes = new Map<string, Set<string>>();
  const turns = db
    .prepare(
      `SELECT conversation_json FROM dm_turns
        WHERE campaign_id = ? AND (conversation_json LIKE '%set_npc%' OR conversation_json LIKE '%npc_reaction%')`,
    )
    .all(campaignId) as Array<{ conversation_json: string }>;
  for (const { conversation_json } of turns) {
    for (const args of registrations(conversation_json)) {
      const key = textKey(args.name);
      const known = notes.get(key) ?? new Set<string>();
      known.add(args.trait);
      notes.set(key, known);
    }
  }
  return notes;
}

// The name and note of every set_npc and npc_reaction call in one turn's
// conversation, its arguments as the model sent them (a JSON string) or
// already parsed, as src/lib/db/turn-ledger.ts lastToolNaming reads them.
function registrations(raw: string): Array<{ name: string; trait: string }> {
  let conversation: unknown;
  try {
    conversation = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(conversation)) {
    return [];
  }
  const found: Array<{ name: string; trait: string }> = [];
  for (const message of conversation as Array<{ tool_calls?: unknown }>) {
    if (!Array.isArray(message?.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls as Array<{ function?: { name?: unknown; arguments?: unknown } }>) {
      const tool = call?.function?.name;
      if (tool !== "set_npc" && tool !== "npc_reaction") {
        continue;
      }
      let args = call.function?.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          continue;
        }
      }
      const { name, trait } = (args ?? {}) as { name?: unknown; trait?: unknown };
      if (typeof name === "string" && name.trim()) {
        found.push({ name, trait: typeof trait === "string" ? trait : "" });
      }
    }
  }
  return found;
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
