// A request's language, and the words that ride on it: the app's own locale
// header first (X-Odm-Locale), then the odm_locale cookie (so EventSource and
// SSR requests carry the user's choice), then Accept-Language. Routes answer
// their refusals in this language, falling back to English.
import { localeFromAcceptLanguage, resolveRequestLocale } from "@/lib/i18n/locale";
import { translate, translatePlural, type Locale, type TranslateVars } from "@/lib/i18n/translate";
// Routes answer in French with the catalog installed (translate.ts).
import "@/lib/i18n/fr-catalog";

export type BookLocale = Locale;
export { localeFromAcceptLanguage };

export function bookLocaleOf(request: Request): BookLocale {
  const own = request.headers.get("x-odm-locale");
  if (own === "fr" || own === "en") {
    return own;
  }
  return resolveRequestLocale(request);
}

export function requestT(request: Request): ((english: string, vars?: TranslateVars) => string) & { locale: Locale } {
  const locale = bookLocaleOf(request);
  return Object.assign((english: string, vars?: TranslateVars) => translate(locale, english, vars), { locale });
}

export function requestTp(
  request: Request,
): (englishOne: string, englishOther: string, vars: TranslateVars & { count: number }) => string {
  const locale = bookLocaleOf(request);
  return (englishOne, englishOther, vars) => translatePlural(locale, englishOne, englishOther, vars);
}
