// The French catalog and name tables for a server process: imported by the
// server's own modules (instrumentation.ts at start, the root layout,
// request-locale.ts), never by a client component, so the JSON and the tables
// stay out of the pages' bundles (translate.ts). Importing it installs them.
import frCatalog from "./fr.json";
import { FR_NAMES_BY_TABLE } from "../content/names-fr.ts";
import { FR_TRANSLATED_NAMES_BY_TABLE } from "../content/names-fr-translated.ts";
import { RESOURCE_FR } from "../srd/class-resources-fr-data.ts";
import { installFrTables } from "./fr-tables.ts";
import { installCatalog } from "./translate.ts";

installCatalog("fr", frCatalog);
installFrTables({ names: FR_NAMES_BY_TABLE, translated: FR_TRANSLATED_NAMES_BY_TABLE, resources: RESOURCE_FR });
