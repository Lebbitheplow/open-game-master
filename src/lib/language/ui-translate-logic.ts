// The interface's text in another language, read from a catalog keyed by the
// English text itself (docs/specs/ogm-italian-ui.md). The catalog is a flat
// {"English text": "Testo italiano"}, the shape an Italian table already uses
// in front of an unchanged build (upstream issue #919), so either catalog
// serves both. A text matches only whole, after its outer spaces; anything
// without an entry stays English.

export type UiCatalog = Readonly<Record<string, string>>;

// Text built at run time ("Kara, their turn") is matched by a pattern whose
// {words} stand for any text and are copied into the translation. Kept apart
// from the catalog so the catalog keeps its plain shape.
export type UiPatterns = Readonly<Record<string, string>>;

export type UiTranslator = (text: string) => string | null;

const SLOT = /\{(\w+)\}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CompiledPattern = { match: RegExp; slots: string[]; into: string; longest: string };

function compilePattern(english: string, translated: string): CompiledPattern | null {
  const slots: string[] = [];
  let source = "";
  let last = 0;
  for (const found of english.matchAll(SLOT)) {
    source += escapeRegExp(english.slice(last, found.index));
    source += "(.+?)";
    slots.push(found[1]);
    last = (found.index ?? 0) + found[0].length;
  }
  if (!slots.length) {
    return null;
  }
  source += escapeRegExp(english.slice(last));
  // Its longest fixed words, which a text must hold before the pattern is tried.
  const longest = english.split(SLOT).filter((_, index) => index % 2 === 0).reduce((a, b) => (b.length > a.length ? b : a), "");
  return { match: new RegExp(`^${source}$`, "s"), slots, into: translated, longest };
}

// One translator for a catalog and its patterns. The catalog wins over a
// pattern; a pattern's slot is copied as it was written (a name, a number).
export function uiTranslator(catalog: UiCatalog, patterns: UiPatterns = {}): UiTranslator {
  const compiled = Object.entries(patterns)
    .map(([english, translated]) => compilePattern(english, translated))
    .filter((pattern): pattern is CompiledPattern => pattern !== null);
  // The same few texts come back on every render: each is looked up once.
  const seen = new Map<string, string | undefined>();
  const lookUp = (core: string): string | undefined => {
    if (seen.has(core)) {
      return seen.get(core);
    }
    const found = Object.hasOwn(catalog, core) ? catalog[core] : fromPattern(core);
    if (seen.size > 20000) {
      seen.clear();
    }
    seen.set(core, found);
    return found;
  };
  const fromPattern = (core: string): string | undefined => {
    for (const pattern of compiled) {
      if (!core.includes(pattern.longest)) {
        continue;
      }
      const parts = pattern.match.exec(core);
      if (parts) {
        const values = new Map(pattern.slots.map((slot, index) => [slot, parts[index + 1]]));
        return pattern.into.replace(SLOT, (whole, slot: string) => values.get(slot) ?? whole);
      }
    }
    return undefined;
  };
  return (text) => {
    const core = text.trim();
    if (!core) {
      return null;
    }
    const found = lookUp(core);
    if (found === undefined || found === core) {
      return null;
    }
    const start = text.length - text.trimStart().length;
    return text.slice(0, start) + found + text.slice(start + core.length);
  };
}

export type UiLanguageChoice = "auto" | "english" | "italian";
export const UI_LANGUAGE_CHOICES: readonly UiLanguageChoice[] = ["auto", "english", "italian"];

export function isUiLanguageChoice(value: unknown): value is UiLanguageChoice {
  return typeof value === "string" && (UI_LANGUAGE_CHOICES as readonly string[]).includes(value);
}

// "auto" follows the browser's first preferred language.
export function resolveUiLanguage(choice: UiLanguageChoice, browserLanguages: readonly string[]): "english" | "italian" {
  if (choice !== "auto") {
    return choice;
  }
  return browserLanguages[0]?.toLowerCase().startsWith("it") ? "italian" : "english";
}
