// A request's language, and the words that ride on it: the app's own locale
// header first (X-Odm-Locale), then the odm_locale cookie (so EventSource and
// SSR requests carry the user's choice), then Accept-Language. Routes answer
// their refusals in this language, falling back to English.
import { getGlobalConfig } from "@/lib/db/app-settings";
import { localeOfServerLanguage, resolveRequestLocale } from "@/lib/i18n/locale";
import { isLocale, translate, type Locale, type TranslateVars } from "@/lib/i18n/translate";
// Routes answer in French or Spanish with the catalog installed (translate.ts).
import "@/lib/i18n/fr-catalog";
import "@/lib/i18n/es-catalog";

export type BookLocale = Locale;

export function bookLocaleOf(request: Request): BookLocale {
  const own = request.headers.get("x-odm-locale");
  if (isLocale(own)) {
    return own;
  }
  return resolveRequestLocale(request, null, localeOfServerLanguage(getGlobalConfig().serverLanguage));
}

export function requestT(request: Request): ((english: string, vars?: TranslateVars) => string) & { locale: Locale } {
  const locale = bookLocaleOf(request);
  return Object.assign((english: string, vars?: TranslateVars) => translate(locale, english, vars), { locale });
}

