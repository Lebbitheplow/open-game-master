// The rulebook on the server: the SRD 5.1 pages (srd-5.1.json, built by
// scripts/import-srd-rulebook.mjs) and, for a request that reads French, the
// same book as the official French print (srd-5.1-fr.json, built by
// scripts/import-srd-rulebook-fr.mjs from SRD_CC_v5.1_FR.pdf). The two books
// bind the same pages under the same ids in the same order, so bookmarks,
// links and folios hold in both; the three pages the French print lost (the
// magic items chapter's three rules pages) fall back to the English page in
// the same binding position.
//
// The contents, one page with its neighbours, and search are answered per
// locale; the search index is built on the first search of that locale, in
// the book's own language (src/lib/rulebook/search.ts). Everything here is
// read once per process and never changes while it runs.
import data from "./srd-5.1.json";
import frData from "./srd-5.1-fr.json";
import { buildIndex, buildIndexInSlices, searchRulebook, type RulebookIndex } from "./search";
import type { TableLanguage } from "../schemas/game-settings-options.ts";
import type {
  ContentsChapter,
  QuickLink,
  RulebookContents,
  RulebookData,
  RulebookPage,
  RulebookPageResponse,
  SearchResponse,
} from "./types";

// The request's language itself now lives beside the refusal words that use
// it (src/lib/request-locale.ts), so the campaign API can resolve a
// request's language without loading the two books with it.
export type BookLocale = "en" | "fr";

// The book language an Accept-Language header asks for: the first tag that
// names French or English wins; a header that names neither reads English.
export function localeFromAcceptLanguage(header: string | null): BookLocale {
  if (!header) return "en";
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag === "fr" || tag.startsWith("fr-")) return "fr";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}

export function bookLocaleOf(request: Request): BookLocale {
  const own = request.headers.get("x-odm-locale");
  if (own === "fr" || own === "en") {
    return own;
  }
  return localeFromAcceptLanguage(request.headers.get("accept-language"));
}

const enBook = data as RulebookData;

// The French book's pages, with the English page substituted where the
// French print has none — so its folio count and page order match the
// English book's exactly.
function mergedFrBook(): RulebookData {
  const frPages = new Map((frData as RulebookData).pages.map((page) => [page.id, page]));
  return { ...(frData as RulebookData), pages: enBook.pages.map((page) => frPages.get(page.id) ?? page) };
}

const books: Record<BookLocale, RulebookData> = { en: enBook, fr: mergedFrBook() };

// A book's search stems as the language the book is written in.
const INDEX_LANGUAGE: Record<BookLocale, TableLanguage> = { en: "english", fr: "french" };

// The rules a table reaches for in the middle of a session. Every anchor is
// asserted to exist by scripts/test-rulebook.mjs. The labels are the
// reader's to translate (RulebookContents keys them by this English label).
export const QUICK_LINKS: QuickLink[] = [
  { label: "Conditions", page: "conditions" },
  { label: "Actions in combat", page: "combat", at: "actions-in-combat" },
  { label: "Opportunity attacks", page: "combat", at: "opportunity-attacks" },
  { label: "Grappling", page: "combat", at: "grappling" },
  { label: "Cover", page: "combat", at: "cover" },
  { label: "Death saves", page: "combat", at: "death-saving-throws" },
  { label: "Advantage", page: "using-ability-scores", at: "advantage-and-disadvantage" },
  { label: "Hiding", page: "using-ability-scores", at: "hiding" },
  { label: "Concentration", page: "spellcasting", at: "concentration" },
  { label: "Resting", page: "adventuring", at: "resting" },
  { label: "Exhaustion", page: "conditions", at: "exhaustion" },
  { label: "Travel pace", page: "adventuring", at: "travel-pace" },
];

type LocaleState = {
  byId: Map<string, { page: RulebookPage; index: number }>;
  chapterById: Map<string, RulebookData["chapters"][number]>;
  contents: RulebookContents | null;
  index: RulebookIndex | null;
  building: Promise<RulebookIndex> | null;
};

const states = new Map<BookLocale, LocaleState>();

function stateFor(locale: BookLocale): LocaleState {
  let state = states.get(locale);
  if (!state) {
    const book = books[locale];
    state = {
      byId: new Map(book.pages.map((page, index) => [page.id, { page, index }])),
      chapterById: new Map(book.chapters.map((chapter) => [chapter.id, chapter])),
      contents: null,
      index: null,
      building: null,
    };
    states.set(locale, state);
  }
  return state;
}

export function rulebookContents(locale: BookLocale = "en"): RulebookContents {
  const state = stateFor(locale);
  if (state.contents) return state.contents;
  const book = books[locale];
  const chapters: ContentsChapter[] = book.chapters.map((chapter) => ({
    id: chapter.id,
    numeral: chapter.numeral,
    title: chapter.title,
    blurb: chapter.blurb,
    entries: chapter.pages.map((id) => {
      const { page, index: at } = state.byId.get(id)!;
      return {
        id: page.id,
        title: page.title,
        kind: page.kind,
        ...(page.meta ? { meta: page.meta } : {}),
        ...(page.group ? { group: page.group } : {}),
        ...(page.family ? { family: page.family } : {}),
        folio: at + 1,
      };
    }),
  }));
  state.contents = { source: book.source, parts: book.parts, chapters, quick: QUICK_LINKS, pageCount: book.pages.length };
  return state.contents;
}

export function rulebookPage(id: string, locale: BookLocale = "en"): RulebookPageResponse | null {
  const state = stateFor(locale);
  const book = books[locale];
  const found = state.byId.get(id);
  if (!found) return null;
  const { chapter: chapterId, ...page } = found.page;
  const chapter = state.chapterById.get(chapterId)!;
  const link = (at: number) => {
    const neighbour = book.pages[at];
    return neighbour ? { id: neighbour.id, title: neighbour.title } : null;
  };
  return {
    page: { ...page, folio: found.index + 1 },
    chapter: { id: chapter.id, numeral: chapter.numeral, title: chapter.title },
    prev: link(found.index - 1),
    next: link(found.index + 1),
  };
}

export function rulebookSearch(query: string, limit?: number, locale: BookLocale = "en"): SearchResponse {
  const state = stateFor(locale);
  state.index ??= buildIndex(books[locale].pages, books[locale].chapters, INDEX_LANGUAGE[locale]);
  return { hits: searchRulebook(state.index, query, limit) };
}

// What the search route calls: the first search builds the index in slices
// (buildIndexInSlices) and every search that arrives meanwhile waits on the
// same build.
export async function rulebookSearchAsync(query: string, limit?: number, locale: BookLocale = "en"): Promise<SearchResponse> {
  const state = stateFor(locale);
  if (!state.index) {
    state.building ??= buildIndexInSlices(books[locale].pages, books[locale].chapters, 24, INDEX_LANGUAGE[locale]).finally(() => {
      state.building = null;
    });
    state.index = await state.building;
  }
  return { hits: searchRulebook(state.index, query, limit) };
}

// Every page of one locale's book — the crosswalk reads the English book's
// titles and kinds, which the catalogs and the workshop copy under.
export function rulebookPages(locale: BookLocale = "en"): RulebookPage[] {
  return books[locale].pages;
}
