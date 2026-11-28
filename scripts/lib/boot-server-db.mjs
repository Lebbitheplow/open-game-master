// Opens the world database the way a server start does
// (src/instrumentation.ts), for tests that need that restart in a fresh
// process: the sheet rules are loaded, so the readers they register are in
// place (a workshop species' rules, src/lib/db/sheets.ts), and the first
// query is the addon settings read, ahead of the workshop's classes being
// registered. boot-db.mjs loads the database module alone, where no reader is
// registered and the boot resync never asks for a workshop row.
// Run with SQLITE_DB_PATH and DB_ENCRYPTION_KEY set; prints what the boot
// logged, then how many times the world database was opened.
import { register } from "node:module";

register("./register-routes.mjs", import.meta.url);

const { databaseOpenCount } = await import("../../src/lib/db/driver.ts");
await import("../../src/lib/db/sheets.ts");
const { refreshPageIsolation } = await import("../../src/lib/addons/store.ts");
refreshPageIsolation();
const { syncWorkshopClasses } = await import("../../src/lib/db/homebrew.ts");
syncWorkshopClasses();
const { getContentDb } = await import("../../src/lib/content/db.ts");
// The driver counts every file it opens; the content pack is the other one.
const worldOpens = databaseOpenCount() - (getContentDb() ? 1 : 0);
console.log(`[boot] opened the world database ${worldOpens} time(s)`);
