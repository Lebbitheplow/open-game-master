// A catalog in the browser, fetched when the reader's language needs it:
// each one is its own chunk, so a reader in English never downloads any
// (translate.ts), nor the French name tables (fr-tables.ts). One fetch per
// locale however many components ask.
import { installFrTables } from "./fr-tables.ts";
import { catalogInstalled, installCatalog, type Locale } from "./translate.ts";

const loading = new Map<Locale, Promise<void>>();

// Each language's own chunk. French brings its name tables with it, installed
// first: the catalog's arrival is what re-renders.
const FETCH: Record<Locale, () => Promise<unknown>> = {
  en: () => Promise.resolve(null),
  fr: () =>
    Promise.all([
      import("./fr.json"),
      import("../content/names-fr.ts"),
      import("../content/names-fr-translated.ts"),
      import("../srd/class-resources-fr-data.ts"),
    ]).then(([catalog, names, translated, resources]) => {
      installFrTables({ names: names.FR_NAMES_BY_TABLE, translated: translated.FR_TRANSLATED_NAMES_BY_TABLE, resources: resources.RESOURCE_FR });
      return catalog;
    }),
  es: () => import("./es.json"),
};

export function loadCatalog(locale: Locale): Promise<void> {
  let pending = loading.get(locale);
  if (pending) {
    return pending;
  }
  if (catalogInstalled(locale)) {
    pending = Promise.resolve();
    loading.set(locale, pending);
    return pending;
  }
  pending = FETCH[locale]()
    .then((catalog) => {
      installCatalog(locale, (catalog as { default?: unknown }).default ?? catalog);
    })
    .catch((error) => {
      // A failed fetch leaves English on screen and lets a later ask retry.
      loading.delete(locale);
      console.error(`[i18n] the ${locale} catalog did not load`, error);
    });
  loading.set(locale, pending);
  return pending;
}
