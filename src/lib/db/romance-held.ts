import { getDatabase, nowIso } from "@/lib/db/core";
import { parseHeldStep, serializeHeldStep, type HeldStep } from "@/lib/dm/romance-held-logic";

// The column issue 640 added to a bond (relationships.held_step_json): a
// romantic step asked mid-fight, waiting for its answer
// (src/lib/dm/romance-held-logic.ts). Read and written by the bond's id,
// apart from patchRelationship, which leaves the column as it is.

export function heldStepOf(relationshipId: string): HeldStep | null {
  const row = getDatabase().prepare(`SELECT held_step_json FROM relationships WHERE id = ?`).get(relationshipId) as
    | { held_step_json: string }
    | undefined;
  return parseHeldStep(row?.held_step_json);
}

export function saveHeldStep(relationshipId: string, step: HeldStep | null) {
  getDatabase()
    .prepare(`UPDATE relationships SET held_step_json = ?, updated_at = ? WHERE id = ?`)
    .run(serializeHeldStep(step), nowIso(), relationshipId);
}

// Every bond in the campaign holding a step, by bond id.
export function listHeldSteps(campaignId: string): Map<string, HeldStep> {
  const rows = getDatabase()
    .prepare(`SELECT id, held_step_json FROM relationships WHERE campaign_id = ? AND held_step_json != ''`)
    .all(campaignId) as Array<{ id: string; held_step_json: string }>;
  const held = new Map<string, HeldStep>();
  for (const row of rows) {
    const step = parseHeldStep(row.held_step_json);
    if (step) {
      held.set(row.id, step);
    }
  }
  return held;
}
