import type { SqliteDatabase } from "./driver.ts";
import { mendedFeatSpells, type SpellLists } from "@/lib/srd/feat-spells";

// The stored sheets and library characters written while featSpellSpec
// misread two of ODM's own feats (src/lib/srd/feat-spells.ts
// mendedFeatSpells): a Magic Initiate's cantrip "It" comes off, and a
// Telepathic character gains the free cast of detect thoughts its feat
// gives. Run once by the migration (src/lib/db/core.ts), whose boot resync
// gives the free cast its counter, and for its one campaign by a rewind
// (src/lib/db/snapshots.ts) and a module's import
// (src/lib/db/workshop-bundle.ts), whose sheets may predate the fix. Only
// rows naming one of the two feats are read. Returns how many rows changed.
export function repairFeatSpellMisreadings(db: SqliteDatabase, campaignId?: string): number {
  let changed = 0;
  const named = `(feats_json LIKE '%Magic Initiate%' OR feats_json LIKE '%Telepathic%')`;
  const sheets = (
    campaignId
      ? db.prepare(`SELECT id, feats_json, features_json, spellcasting_json FROM character_sheets WHERE campaign_id = ? AND ${named}`).all(campaignId)
      : db.prepare(`SELECT id, feats_json, features_json, spellcasting_json FROM character_sheets WHERE ${named}`).all()
  ) as Array<{ id: string; feats_json: string | null; features_json: string | null; spellcasting_json: string | null }>;
  const updateSheet = db.prepare(`UPDATE character_sheets SET features_json = ?, spellcasting_json = ? WHERE id = ?`);
  for (const row of sheets) {
    try {
      const mended = mendedFeatSpells({
        feats: JSON.parse(row.feats_json ?? "[]") as string[],
        features: JSON.parse(row.features_json ?? "[]") as Array<{ name: string }>,
        spellcasting: JSON.parse(row.spellcasting_json ?? "null") as SpellLists | null,
      });
      if (mended) {
        updateSheet.run(JSON.stringify(mended.features), JSON.stringify(mended.spellcasting), row.id);
        changed += 1;
      }
    } catch {
      // An unreadable row stays as it is.
    }
  }
  if (campaignId) {
    return changed;
  }
  const library = db
    .prepare(`SELECT id, sheet_json FROM library_characters WHERE sheet_json LIKE '%Magic Initiate%' OR sheet_json LIKE '%Telepathic%'`)
    .all() as Array<{ id: string; sheet_json: string }>;
  const updateLibrary = db.prepare(`UPDATE library_characters SET sheet_json = ? WHERE id = ?`);
  for (const row of library) {
    try {
      const sheet = JSON.parse(row.sheet_json) as { feats?: string[]; features?: Array<{ name: string }>; spellcasting?: SpellLists | null };
      const mended = mendedFeatSpells(sheet);
      if (mended) {
        updateLibrary.run(JSON.stringify({ ...sheet, features: mended.features, spellcasting: mended.spellcasting }), row.id);
        changed += 1;
      }
    } catch {
      // An unreadable row stays as it is.
    }
  }
  return changed;
}
