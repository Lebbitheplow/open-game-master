// Pure translation helpers re-exported from the gettext-style runtime in
// src/lib/i18n/translate.ts so existing callers and tests keep working.
import { translate, translatePlural, type Locale, type TranslateVars } from "./i18n/translate";

export { translate, translatePlural, type Locale, type TranslateVars };
export type MessageKey = string;
export type MessageVars = TranslateVars;
export type MessageDictionary = Record<string, string>;

export function pluralCategory(locale: Locale, count: number): "one" | "other" {
  if (!Number.isFinite(count)) {
    return "other";
  }
  return locale === "fr" ? (count <= 1 ? "one" : "other") : count === 1 ? "one" : "other";
}

export function formatMessage(template: string, vars?: MessageVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (slot, key: string) =>
    Object.hasOwn(vars, key) ? String(Reflect.get(vars, key)) : slot,
  );
}

// The BCP 47 tag a locale resolves to, for toLocaleDateString and friends.
export function localeTag(locale: Locale): string {
  return locale === "fr" ? "fr-FR" : "en-US";
}

export type Translator = ((english: string, vars?: TranslateVars) => string) & { locale?: Locale };
export type PluralTranslator = (
  englishOne: string,
  englishOther: string,
  vars: TranslateVars & { count: number },
) => string;

export function pluralOf(t?: { locale?: Locale } | ((english: string, vars?: TranslateVars) => string)): PluralTranslator {
  const locale = (t as { locale?: Locale } | undefined)?.locale;
  if (locale) {
    return (one, other, vars) => translatePlural(locale, one, other, vars);
  }
  if (typeof t === "function") {
    return (one, other, vars) => t(vars.count === 1 ? one : other, vars);
  }
  return (one, other, vars) => translatePlural("en", one, other, vars);
}
