// The bonds store (docs/specs/ogm-npc-perception.md §10): written only from
// the events a mind took in (scene-events recordSceneEvent), read into its
// frame. The rules are bonds-logic's.
import { getDatabase, parseJson } from "@/lib/db/core";
import { applyDelta, bondDeltas, type Bond } from "@/lib/dm/bonds-logic";
import type { SceneEvent, SenseChannel } from "@/lib/dm/scene-events-logic";
import { textKey } from "@/lib/language/text-logic";

type BondRow = { toward: string; trust: number; affection: number; fear: number; reasons_json: string };

function bondOf(row: BondRow): Bond {
  return { toward: row.toward, trust: row.trust, affection: row.affection, fear: row.fear, reasons: parseJson<string[]>(row.reasons_json, []) };
}

export function getBond(campaignId: string, npcId: string, toward: string): Bond | null {
  const row = getDatabase().prepare(`SELECT * FROM npc_bonds WHERE campaign_id = ? AND npc_id = ? AND toward_key = ?`).get(campaignId, npcId, textKey(toward)) as BondRow | undefined;
  return row ? bondOf(row) : null;
}

export function listBonds(campaignId: string, npcId: string): Bond[] {
  return (getDatabase().prepare(`SELECT * FROM npc_bonds WHERE campaign_id = ? AND npc_id = ?`).all(campaignId, npcId) as BondRow[]).map(bondOf);
}

function saveBond(campaignId: string, npcId: string, bond: Bond) {
  getDatabase()
    .prepare(
      `INSERT INTO npc_bonds (campaign_id, npc_id, toward_key, toward, trust, affection, fear, reasons_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, npc_id, toward_key) DO UPDATE SET toward = excluded.toward, trust = excluded.trust, affection = excluded.affection, fear = excluded.fear, reasons_json = excluded.reasons_json`,
    )
    .run(campaignId, npcId, textKey(bond.toward), bond.toward, bond.trust, bond.affection, bond.fear, JSON.stringify(bond.reasons));
}

// One mind's bonds moved by one event it took in.
export function bondsFromEvent(campaignId: string, npcId: string, observer: string, event: Pick<SceneEvent, "actor" | "verb" | "targets" | "object">, channels: readonly SenseChannel[]) {
  const deltas = bondDeltas(event, observer, channels, (name) => getBond(campaignId, npcId, name)?.affection ?? 0);
  for (const delta of deltas) {
    saveBond(campaignId, npcId, applyDelta(getBond(campaignId, npcId, delta.toward), delta));
  }
}
