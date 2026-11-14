import { randomUUID } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { parseAway, parseMindModel, type MindModelChoice, type NpcAway, type NpcMemory, type NpcMemoryKind, type NpcSourceKind } from "@/lib/dm/npc-mind-logic";

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

// Set where an adventure is made, never by the narrator in play: for now no
// NPC is promoted by the story.
export function setNpcTier(npcId: string, tier: "primary" | "secondary") {
  getDatabase().prepare(`UPDATE npcs SET tier = ?, updated_at = ? WHERE id = ?`).run(tier, nowIso(), npcId);
}
