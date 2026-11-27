import { isLocale, type Locale } from "./translate";

export const LOCALE_COOKIE = "odm_locale";

export function parseLocale(raw: string | null | undefined): Locale | null {
  return isLocale(raw) ? raw : null;
}

// The menus' language a table language asks for, where the menus have it:
// French and Spanish, the translations the menus have besides English.
const LOCALE_OF_LANGUAGE: Record<string, Locale> = { french: "fr", spanish: "es" };

// The menus' language a server's own language asks for (global config
// serverLanguage, set by its admin). English is every server's default and
// says nothing about its readers, so it leaves the choice to them and their
// browser.
export function localeOfServerLanguage(language: string | null | undefined): Locale | null {
  return (language && Object.hasOwn(LOCALE_OF_LANGUAGE, language) && LOCALE_OF_LANGUAGE[language]) || null;
}

// The language the server's own lines are written in at a table that plays
// in `language` (a hold's notice, a board's label): the table's, where the
// menus have it, else English.
export function localeOfTableLanguage(language: string | null | undefined): Locale {
  return localeOfServerLanguage(language) ?? "en";
}

// The interface language a BCP 47 tag names ("fr-CA" is French, "es-419"
// Spanish), or null for a language the menus do not have.
export function localeOfTag(tag: string): Locale | null {
  const language = tag.trim().toLowerCase().split("-")[0];
  return isLocale(language) ? language : null;
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return "en";
  const tags = header
    .split(",")
    .map((part, at) => {
      const [tag, ...params] = part.split(";");
      const q = params.map((param) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param)?.[1]).find((value) => value !== undefined);
      const weight = q === undefined ? 1 : Number(q);
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, at };
    })
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight || a.at - b.at);
  for (const { tag } of tags) {
    const locale = localeOfTag(tag);
    if (locale) return locale;
  }
  return "en";
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Server-side locale resolution (per @mcerina's design in #919):
// 1. User's saved profile setting (when signed in)
// 2. `odm_locale` cookie (set by the client when switching language / pre-login)
// 3. the server's own language, where the menus have it (localeOfServerLanguage)
// 4. `Accept-Language` header
// 5. Default `"en"`
export function resolveLocale(options: {
  savedLocale?: string | null;
  cookieHeader?: string | null;
  serverLocale?: Locale | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    parseLocale(options.savedLocale) ??
    parseLocale(cookieValue(options.cookieHeader ?? null, LOCALE_COOKIE)) ??
    options.serverLocale ??
    localeFromAcceptLanguage(options.acceptLanguage)
  );
}

export function resolveRequestLocale(request: Request, savedLocale?: string | null, serverLocale?: Locale | null): Locale {
  return resolveLocale({
    savedLocale,
    cookieHeader: request.headers.get("cookie"),
    serverLocale,
    acceptLanguage: request.headers.get("accept-language"),
  });
}
