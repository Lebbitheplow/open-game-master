import type { SqliteDatabase } from "./driver.ts";
import { workshopClassFrom } from "@/lib/homebrew/class-data";
import { registerWorkshopClasses } from "@/lib/classes/workshop-registry";

// Every class kept in any workshop, registered with the engines
// (src/lib/classes/workshop-registry.ts), so a sheet holding one is read as a
// bundled class's is. It reads the database it is handed, as
// src/lib/db/table-feats.ts does, so the boot resync can register them from
// the database it is still opening (src/lib/db/core.ts resyncSheets); every
// other caller goes through src/lib/db/homebrew.ts syncWorkshopClasses.
export function registerWorkshopClassesFrom(db: SqliteDatabase): void {
  const rows = db.prepare(`SELECT id, name, data_json FROM homebrew_entries WHERE kind = 'class'`).all() as Array<{
    id: string;
    name: string;
    data_json: string;
  }>;
  registerWorkshopClasses(
    rows.flatMap((row) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(row.data_json) as Record<string, unknown>;
      } catch {
        // A row that does not parse is no class; workshopClassFrom says so.
      }
      return workshopClassFrom({ id: row.id, name: row.name, data }) ?? [];
    }),
    { replace: true },
  );
}
