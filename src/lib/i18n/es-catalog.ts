// The Spanish catalog for a server process: imported by the server's own
// modules (instrumentation.ts at start, the root layout, request-locale.ts),
// never by a client component, so the JSON stays out of the pages' bundles
// (translate.ts). Importing it installs it.
//
// es.json is a machine translation of the English strings, made with the
// official Spanish SRD 5.1's game terms and not yet read through by a
// Spanish speaker. A line that reads wrong is corrected in es.json, by its
// English key; a line it does not carry reads English.
import esCatalog from "./es.json";
import { installCatalog } from "./translate.ts";

installCatalog("es", esCatalog);
