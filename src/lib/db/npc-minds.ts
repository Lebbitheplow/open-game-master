import { randomUUID } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { ON_STAGE_SOURCE, parseAway, parseMindModel, type MindModelChoice, type NpcAway, type NpcMemory, type NpcMemoryKind, type NpcSourceKind } from "@/lib/dm/npc-mind-logic";

// The registers behind the NPC minds (src/lib/dm/npc-mind.ts): what each NPC
// knows and from whom, and each time a mind was asked. Thin on purpose; the
// rules live in src/lib/dm/npc-mind-logic.ts.

type MemoryRow = {
  npc_id: string;
  kind: NpcMemoryKind;
  source_kind: NpcSourceKind;
  source_name: string;
  content: string;
  learned_at: number;
};

export function addNpcMemories(
  campaignId: string,
  npcIds: readonly string[],
  memory: Omit<NpcMemory, "npcId">,
  turnId = "",
): number {
  const insert = getDatabase().prepare(
    `INSERT INTO npc_memories (id, campaign_id, npc_id, kind, source_kind, source_name, content, learned_at, turn_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const at = nowIso();
  for (const npcId of npcIds) {
    insert.run(randomUUID(), campaignId, npcId, memory.kind, memory.sourceKind, memory.sourceName, memory.content, Math.floor(memory.learnedAt), turnId, at);
  }
  return npcIds.length;
}

// The NPCs whose own minds acted (said or did something) in DM turn
// `turnId`: who was on stage then (src/lib/dm/npc-mind.ts mindsOwedTurn).
export function npcsActedInTurn(campaignId: string, turnId: string): Set<string> {
  if (!turnId) {
    return new Set();
  }
  const rows = getDatabase()
    .prepare(`SELECT DISTINCT npc_id FROM npc_memories WHERE campaign_id = ? AND turn_id = ? AND source_kind = 'self'`)
    .all(campaignId, turnId) as Array<{ npc_id: string }>;
  return new Set(rows.map((row) => row.npc_id));
}

// The NPCs still on stage across the recent DM turns `turnIdsNewestFirst`:
// for each NPC, the newest of those turns that left it a memory of the scene
// decides. It acted there (said or did something), or the scene reached it
// where it stood (npc_speak's moment, words it overheard through npc_hear,
// marked ON_STAGE_SOURCE): still on stage. It was only told something, or
// shown it from afar (npc_inform): it had left the scene. A time skip asks
// the first kind for their turn (npc-mind.ts mindsAwaitingTurn). Played
// live: the prisoner on the cart who only overheard the last exchange was
// taken for gone, and the afternoon's march was lived by the captain alone.
export function npcsOnStageRecently(campaignId: string, turnIdsNewestFirst: readonly string[]): Set<string> {
  const onStage = new Set<string>();
  const decided = new Set<string>();
  const read = getDatabase().prepare(
    `SELECT npc_id, MAX(source_kind = 'self' OR (source_kind = 'perceived' AND source_name = ?)) AS acted, MAX(source_kind <> 'background') AS lived
     FROM npc_memories WHERE campaign_id = ? AND turn_id = ? GROUP BY npc_id`,
  );
  for (const turnId of turnIdsNewestFirst) {
    if (!turnId) {
      continue;
    }
    for (const row of read.all(ON_STAGE_SOURCE, campaignId, turnId) as Array<{ npc_id: string; acted: number; lived: number }>) {
      // Only their background was seeded there: it says nothing of where
      // they stood.
      if (decided.has(row.npc_id) || !row.lived) {
        continue;
      }
      decided.add(row.npc_id);
      if (row.acted) {
        onStage.add(row.npc_id);
      }
    }
  }
  return onStage;
}

export function listNpcMemories(campaignId: string, npcId: string): NpcMemory[] {
  const rows = getDatabase()
    .prepare(
      `SELECT npc_id, kind, source_kind, source_name, content, learned_at FROM npc_memories
       WHERE campaign_id = ? AND npc_id = ? ORDER BY learned_at, created_at, rowid`,
    )
    .all(campaignId, npcId) as MemoryRow[];
  return rows.map((row) => ({
    npcId: row.npc_id,
    kind: row.kind,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    content: row.content,
    learnedAt: row.learned_at,
  }));
}

export type NpcProposalRecord = {
  npcId: string;
  turnId: string;
  mode: "scene" | "offscreen";
  status: "committed" | "failed";
  speech: string;
  intent: string;
  error: string;
  flags: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export function recordNpcProposal(campaignId: string, record: NpcProposalRecord): string {
  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO npc_proposals (id, campaign_id, npc_id, turn_id, mode, status, speech, intent, error, flags_json, latency_ms, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      campaignId,
      record.npcId,
      record.turnId,
      record.mode,
      record.status,
      record.speech,
      record.intent,
      record.error,
      JSON.stringify(record.flags),
      Math.round(record.latencyMs),
      Math.round(record.inputTokens),
      Math.round(record.outputTokens),
      nowIso(),
    );
  return id;
}

type ProposalRow = {
  npc_id: string;
  turn_id: string;
  mode: "scene" | "offscreen";
  status: "committed" | "failed";
  speech: string;
  intent: string;
  error: string;
  flags_json: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
};

export function listNpcProposals(campaignId: string, npcId?: string): NpcProposalRecord[] {
  const rows = (
    npcId
      ? getDatabase().prepare(`SELECT * FROM npc_proposals WHERE campaign_id = ? AND npc_id = ? ORDER BY created_at, rowid`).all(campaignId, npcId)
      : getDatabase().prepare(`SELECT * FROM npc_proposals WHERE campaign_id = ? ORDER BY created_at, rowid`).all(campaignId)
  ) as ProposalRow[];
  return rows.map((row) => ({
    npcId: row.npc_id,
    turnId: row.turn_id,
    mode: row.mode,
    status: row.status,
    speech: row.speech,
    intent: row.intent,
    error: row.error,
    flags: parseJson<string[]>(row.flags_json, []),
    latencyMs: row.latency_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  }));
}

// When each NPC's mind last acted off-screen, as a clock instant: the
// longest idle go first (npc-mind-logic.ts offscreenCandidates).
export function lastOffscreenInstants(campaignId: string): Map<string, number> {
  const rows = getDatabase()
    .prepare(
      `SELECT npc_id, MAX(learned_at) AS at FROM npc_memories WHERE campaign_id = ? AND kind = 'did' GROUP BY npc_id`,
    )
    .all(campaignId) as Array<{ npc_id: string; at: number }>;
  return new Map(rows.map((row) => [row.npc_id, row.at]));
}

export function getNpcInspiration(npcId: string): string {
  const row = getDatabase().prepare(`SELECT inspiration FROM npcs WHERE id = ?`).get(npcId) as { inspiration?: string } | undefined;
  return row?.inspiration ?? "";
}

export function setNpcInspiration(npcId: string, inspiration: string) {
  getDatabase().prepare(`UPDATE npcs SET inspiration = ?, updated_at = ? WHERE id = ?`).run(inspiration, nowIso(), npcId);
}

// The tier an NPC was given ('primary' or 'secondary'); a party companion is
// first-tier whatever this says (src/lib/dm/npc-mind-logic.ts tierOf).
export function getNpcTier(npcId: string): string {
  const row = getDatabase().prepare(`SELECT tier FROM npcs WHERE id = ?`).get(npcId) as { tier?: string } | undefined;
  return row?.tier ?? "secondary";
}

// Where a first-tier mind apart from the party is, or null while it is with
// the party.
export function getNpcAway(npcId: string): NpcAway | null {
  const row = getDatabase().prepare(`SELECT away_json FROM npcs WHERE id = ?`).get(npcId) as { away_json?: string } | undefined;
  return parseAway(row?.away_json ?? "");
}

export function setNpcAway(npcId: string, away: NpcAway | null) {
  getDatabase().prepare(`UPDATE npcs SET away_json = ?, updated_at = ? WHERE id = ?`).run(away ? JSON.stringify(away) : "", nowIso(), npcId);
}

// The mind's own model and effort (ticket 09), or null for the table's.
export function getNpcMindModel(npcId: string): MindModelChoice | null {
  const row = getDatabase().prepare(`SELECT mind_model_json FROM npcs WHERE id = ?`).get(npcId) as { mind_model_json?: string } | undefined;
  return parseMindModel(row?.mind_model_json ?? "");
}

export function setNpcMindModel(npcId: string, choice: MindModelChoice | null) {
  const value = choice && (choice.model || choice.effort) ? JSON.stringify({ model: choice.model, effort: choice.effort }) : "";
  getDatabase().prepare(`UPDATE npcs SET mind_model_json = ?, updated_at = ? WHERE id = ?`).run(value, nowIso(), npcId);
}

// The lines the narrator voiced for an NPC (campaign_messages speech_json),
// the newest `limit`, oldest first: what a second-tier character said in
// its own words before the story gave it a mind of its own.
export function npcVoicedLines(campaignId: string, npcId: string, limit: number): string[] {
  const rows = getDatabase()
    .prepare(`SELECT speech_json FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' AND speech_json LIKE ? ORDER BY seq DESC LIMIT 400`)
    .all(campaignId, `%${npcId}%`) as { speech_json: string }[];
  const lines: string[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.speech_json);
    } catch {
      continue;
    }
    const spoken = Array.isArray(parsed) ? (parsed as { line?: unknown; speaker?: { kind?: unknown; id?: unknown } }[]) : [];
    for (const entry of [...spoken].reverse()) {
      if (entry?.speaker?.kind === "npc" && entry.speaker.id === npcId && typeof entry.line === "string" && entry.line.trim()) {
        lines.push(entry.line.trim());
      }
    }
    if (lines.length >= limit) {
      break;
    }
  }
  return lines.slice(0, limit).reverse();
}

// Set by the narrator as the story goes (npc_past firstTier): a character
// the story comes to hinge on is promoted, one it leaves behind gives its
// place back.
export function setNpcTier(npcId: string, tier: "primary" | "secondary") {
  getDatabase().prepare(`UPDATE npcs SET tier = ?, updated_at = ? WHERE id = ?`).run(tier, nowIso(), npcId);
}
