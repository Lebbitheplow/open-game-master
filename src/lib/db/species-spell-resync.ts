import { getDatabase } from "@/lib/db/core";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { innateSpellCounters, RACIAL_COUNTER_PREFIX } from "@/lib/srd/racial-grants";

// The spells' counters of every sheet at a table on a workshop species,
// sized again after its author saves it (issue #833): a spell's uses raised
// from one to three, a long rest turned into a short one (its counter's id
// changes with it) or a spell added waited for the sheet's next level
// change. A species purged for good takes its spells' counters with it.
// The cast guard and the Hand read a missing or stale counter at the
// grant's own size anyway (src/lib/srd/granted-casts.ts grantUses); this
// keeps what the sheet shows true as well.
export function resyncSpeciesSpellCounters(raceId: string, options: { gone?: boolean } = {}): number {
  const rows = getDatabase().prepare(`SELECT id FROM character_sheets WHERE race = ?`).all(raceId) as Array<{ id: string }>;
  let changed = 0;
  for (const { id } of rows) {
    const sheet = getSheetById(id);
    if (!sheet) {
      continue;
    }
    const kept = Object.fromEntries(Object.entries(sheet.resources ?? {}).filter(([key]) => !key.startsWith(RACIAL_COUNTER_PREFIX)));
    const counters = options.gone ? {} : innateSpellCounters(sheet.race, sheet.level, sheet.resources, undefined, { features: sheet.features });
    const next = { ...kept, ...counters };
    if (JSON.stringify(next) === JSON.stringify(sheet.resources ?? {})) {
      continue;
    }
    const updated = patchSheet(id, { resources: next });
    if (updated) {
      publishPersisted(updated.campaignId, "sheet_updated", { sheet: updated });
      changed += 1;
    }
  }
  return changed;
}
