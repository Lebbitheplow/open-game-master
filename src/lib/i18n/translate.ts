import frCatalog from "./fr.json";

export type Locale = "en" | "fr";

export type TranslateVars = Record<string, string | number> & {
  context?: string;
};

type Catalog = {
  messages: Record<string, string>;
  contexts: Record<string, Record<string, string>>;
  plurals: Record<string, [string, string]>;
};

const FR = frCatalog as unknown as Catalog;

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
  if (locale === "fr") {
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
  if (locale === "fr") {
    const pair = FR.plurals[`${englishOne}\0${englishOther}`];
    if (pair) {
      return interpolate(isOne ? pair[0] : pair[1], vars);
    }
  }
  return interpolate(isOne ? englishOne : englishOther, vars);
}
