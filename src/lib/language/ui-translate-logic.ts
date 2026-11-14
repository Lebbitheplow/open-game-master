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

// More than one lowercase word, or a sentence end: prose, not a name.
function holdsProse(part: string): boolean {
  // "and" and "or" join a list of names ("Bandito 1 and Bandito 2").
  const words = (part.match(/(?:^|\s)\p{Ll}{2,}/gu) ?? []).filter((word) => !/^\s?(and|or)$/.test(word));
  return new RegExp(SENTENCE_END.source, "u").test(part) || words.length > 1;
}

type CompiledPattern = { match: RegExp; slots: string[]; into: string; longest: string; fixed: number };

function compilePattern(english: string, translated: string): CompiledPattern | null {
  const slots: string[] = [];
  let source = "";
  let last = 0;
  for (const found of english.matchAll(SLOT)) {
    const before = english.slice(last, found.index);
    source += escapeRegExp(before);
    // Glued to a word or another slot ("act{s}", "{damage}{crit}"), a slot
    // may be empty.
    const glued = (found.index ?? 0) > 0 && (before === "" ? slots.length > 0 : /\p{L}$/u.test(before));
    source += glued ? "(.*?)" : "(.+?)";
    slots.push(found[1]);
    last = (found.index ?? 0) + found[0].length;
  }
  if (!slots.length) {
    return null;
  }
  source += escapeRegExp(english.slice(last));
  // A pattern open at both ends with only a word or two fixed ("{a} and
  // {b}") would read inside any sentence that holds the word, putting one
  // Italian word in an English line: it is left out.
  const fixedLetters = english.replace(SLOT, "").replace(/[^\p{L}]/gu, "").length;
  if (english.startsWith("{") && /\}$/.test(english) && fixedLetters < 8) {
    return null;
  }
  // Its longest fixed words, which a text must hold before the pattern is tried.
  const longest = english.split(SLOT).filter((_, index) => index % 2 === 0).reduce((a, b) => (b.length > a.length ? b : a), "");
  return { match: new RegExp(`^${source}$`, "s"), slots, into: translated, longest, fixed: fixedLetters };
}

// One translator for a catalog and its patterns. The catalog wins over a
// pattern; a pattern's slot is copied as it was written (a name, a number).
export function uiTranslator(catalog: UiCatalog, patterns: UiPatterns = {}): UiTranslator {
  const compiled = Object.entries(patterns)
    .map(([english, translated]) => compilePattern(english, translated))
    .filter((pattern): pattern is CompiledPattern => pattern !== null)
    // The most specific first: the one with the most fixed words reads the
    // most of a line in place ("{name} attacks {target} with {attack}"
    // before "{name} attacks {value}").
    .sort((a, b) => b.fixed - a.fixed);
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
      // A slot stands for a name, an item or a number, never for another
      // sentence or a piece of one: English words in it ("Brann closes in on
      // Bandito 1 but") would leave an English half inside the Italian.
      // Prose in a slot is read on its own ("18 vs AC 19: miss"), and the
      // match only stands if that reads too. Each part is shorter than the
      // whole, so this ends.
      const values = parts?.slice(1).map((part) => (holdsProse(part) ? proseInSlot(part.trim()) : part));
      if (values && values.every((value) => value !== undefined)) {
        const bySlot = new Map(pattern.slots.map((slot, index) => [slot, values[index]]));
        return pattern.into.replace(SLOT, (whole, slot: string) => bySlot.get(slot) ?? whole);
      }
    }
    return undefined;
  };
  // Whole, or every sentence of it ("21 vs AC 19: HIT for 6").
  const proseInSlot = (part: string): string | undefined => {
    const whole = lookUp(part);
    if (whole !== undefined) {
      return whole;
    }
    const pieces = part.split(new RegExp(`(${SENTENCE_END.source})`, "u"));
    if (pieces.length < 2) {
      return undefined;
    }
    const read = pieces.map((piece, index) => (index % 2 === 1 ? piece : lookUp(piece)));
    return read.every((piece) => piece !== undefined) ? read.join("") : undefined;
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

// Where one sentence ends and the next begins in a line the server builds
// from pieces ("Kara ends their turn. It is now Brann's turn."): the same
// cut scripts/extract-ui-strings.mjs lists them by.
export const SENTENCE_END = /(?<=[.!?:])\s+(?=[\p{Lu}{(«"“])/u;

// A line translated sentence by sentence when it has no entry whole: each
// sentence with an entry is translated, the rest stays as it is, the spaces
// between them kept. Null when no sentence has one.
export function sentenceTranslator(translate: UiTranslator): UiTranslator {
  return (text) => {
    const whole = translate(text);
    if (whole !== null) {
      return whole;
    }
    let changed = false;
    let out = "";
    let last = 0;
    const cut = new RegExp(SENTENCE_END.source, "gu");
    const pieces: Array<[string, string]> = [];
    for (const found of text.matchAll(cut)) {
      // Never inside brackets: "(21 vs AC 19: HIT for 6)" is one aside.
      const sofar = text.slice(last, found.index);
      if ((sofar.match(/\(/g) ?? []).length > (sofar.match(/\)/g) ?? []).length) {
        continue;
      }
      pieces.push([sofar, found[0]]);
      last = (found.index ?? 0) + found[0].length;
    }
    pieces.push([text.slice(last), ""]);
    for (const [piece, gap] of pieces) {
      const translated = translate(piece);
      changed ||= translated !== null;
      out += (translated ?? piece) + gap;
    }
    return changed ? out : null;
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
