export type Locale = "en" | "fr";

export type TranslateVars = Record<string, string | number> & {
  context?: string;
};

type Catalog = {
  messages: Record<string, string>;
  contexts: Record<string, Record<string, string>>;
  plurals: Record<string, [string, string]>;
};

// The French catalog is about 1 MB of JSON (340 KiB gzip). Imported here it
// rode in the first load of every page, French reader or not (the shared
// LocaleApplier and every useT pull this module in). It is installed
// instead: on the server at start (fr-catalog.ts, from instrumentation.ts,
// the root layout and request-locale.ts), in a browser on demand when the
// reader's language is French (catalog-loader.ts, its own chunk). Until a
// catalog is installed its locale reads English, the source. The store sits
// on globalThis so the server's module layers (route, page, SSR) share one.
const STORE = "__odmI18nCatalogs";

function catalogs(): Partial<Record<Locale, Catalog>> {
  const holder = globalThis as typeof globalThis & { [STORE]?: Partial<Record<Locale, Catalog>> };
  holder[STORE] ??= {};
  return holder[STORE];
}

export function installCatalog(locale: Locale, catalog: unknown): void {
  if (locale !== "en") {
    catalogs()[locale] = catalog as Catalog;
  }
}

// English is the source and needs no catalog.
export function catalogInstalled(locale: Locale): boolean {
  return locale === "en" || Boolean(catalogs()[locale]);
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    if (name === "context") return match;
    return name in vars ? String(vars[name]) : match;
  });
}

// Gettext-style translation: English is the key and fallback.
// When `vars.context` is given and an override exists in `contexts`,
// that disambiguated French string wins over the default entry.
export function translate(locale: Locale, english: string, vars?: TranslateVars): string {
  let text = english;
  const FR = locale === "fr" ? catalogs().fr : undefined;
  if (FR) {
    const ctx = vars?.context;
    const ctxMatch = ctx ? FR.contexts[english]?.[ctx] : undefined;
    text = ctxMatch ?? FR.messages[english] ?? english;
  }
  return interpolate(text, vars);
}

export function translatePlural(
  locale: Locale,
  englishOne: string,
  englishOther: string,
  vars: TranslateVars & { count: number },
): string {
  const isOne = locale === "fr" ? vars.count <= 1 : vars.count === 1;
  const FR = locale === "fr" ? catalogs().fr : undefined;
  if (FR) {
    const pair = FR.plurals[`${englishOne}\0${englishOther}`];
    if (pair) {
      return interpolate(isOne ? pair[0] : pair[1], vars);
    }
  }
  return interpolate(isOne ? englishOne : englishOther, vars);
}
