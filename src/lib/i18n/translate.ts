// The interface's languages. English is the source every string is written
// in; the others are catalogs keyed by the English (fr.json, es.json).
const LOCALES = ["en", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(raw: unknown): raw is Locale {
  return typeof raw === "string" && (LOCALES as readonly string[]).includes(raw);
}

export type TranslateVars = Record<string, string | number> & {
  context?: string;
};

type Catalog = {
  messages: Record<string, string>;
  contexts: Record<string, Record<string, string>>;
  plurals: Record<string, [string, string]>;
};

// A catalog is about 1 MB of JSON (340 KiB gzip). Imported here it
// rode in the first load of every page, whatever the reader's language (the
// shared LocaleApplier and every useT pull this module in). It is installed
// instead: on the server at start (fr-catalog.ts and es-catalog.ts, from
// instrumentation.ts, the root layout and request-locale.ts), in a browser on
// demand when the reader's language needs it (catalog-loader.ts, its own
// chunk). Until a
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

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    if (name === "context") return match;
    return name in vars ? String(vars[name]) : match;
  });
}

// Gettext-style translation: English is the key and fallback.
// When `vars.context` is given and an override exists in `contexts`,
// that disambiguated string wins over the default entry.
export function translate(locale: Locale, english: string, vars?: TranslateVars): string {
  let text = english;
  const catalog = locale === "en" ? undefined : catalogs()[locale];
  if (catalog) {
    const ctx = vars?.context;
    const ctxMatch = ctx ? catalog.contexts[english]?.[ctx] : undefined;
    text = ctxMatch ?? catalog.messages[english] ?? english;
  }
  return interpolate(text, vars);
}

// Which of a pair a count takes: French counts 0 and 1 as one ("0 jour"),
// English and Spanish only 1 ("0 days", "0 días").
function isOne(locale: Locale, count: number): boolean {
  return locale === "fr" ? count <= 1 : count === 1;
}

export function translatePlural(
  locale: Locale,
  englishOne: string,
  englishOther: string,
  vars: TranslateVars & { count: number },
): string {
  const one = isOne(locale, vars.count);
  const catalog = locale === "en" ? undefined : catalogs()[locale];
  if (catalog) {
    const pair = catalog.plurals[`${englishOne}\0${englishOther}`];
    if (pair) {
      return interpolate(one ? pair[0] : pair[1], vars);
    }
  }
  return interpolate(one ? englishOne : englishOther, vars);
}
