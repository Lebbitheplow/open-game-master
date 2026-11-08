import { z } from "zod";

// What reading an adventure PDF in the page produces, and what the server
// accepts of it. The page reads the book with pdf.js (read-pdf.ts) so the
// same code runs on the website, the desktop app and the Android app,
// including the phone's own world, where the server has no image codec and
// no addons. The server never sees the PDF itself: it gets these pages, a
// batch at a time, and the pictures one at a time.
//
// Coordinates are page points with the origin at the TOP left (y grows
// down), already through the page's rotation, so the layout pass never has
// to think about PDF user space.
//
// Pure, no "@/" imports beyond zod: the page, the routes and the tests all
// read it.

// The size of one book the server takes. A long hardcover adventure is
// about 250 pages; the cap leaves room for a big compendium and still keeps
// one import's reading a few megabytes of JSON.
export const MAX_IMPORT_PAGES = 800;
export const MAX_RUNS_PER_PAGE = 6_000;
// The text runs a whole book may send. A 250-page illustrated hardcover
// sends about 56,000; this is ten times that, and bounds the work a crafted
// book can ask of the server's layout pass (slices-logic.ts).
export const MAX_IMPORT_RUNS = 600_000;
export const MAX_RUN_CHARS = 2_000;
export const MAX_BOXES_PER_PAGE = 400;
export const MAX_IMAGES_PER_PAGE = 60;
export const MAX_FONTS = 2_000;
export const MAX_OUTLINE = 2_000;
// The pictures kept from one book (portraits, maps, scenes), after
// ornaments and page furniture are dropped in the page.
export const MAX_IMPORT_IMAGES = 400;
// One picture as it arrives: the long edge the page scales to, and the
// bytes the route takes (the upload route's own 8 MB).
export const IMPORT_IMAGE_MAX_EDGE = 2_048;
export const MAX_IMPORT_IMAGE_BYTES = 8 * 1024 * 1024;
// A rules PDF's words the page reads for the binder, at most (the server's
// own reader's cap, src/lib/pdf/text.ts PDF_TEXT_MAX).
export const BOOK_TEXT_MAX = 1_000_000;
// Pages sent per request. A dense page is about 20 KB of runs.
export const PAGES_PER_BATCH = 20;

const coord = z.number().finite().min(-10_000).max(10_000);
const size = z.number().finite().min(0).max(10_000);

// One piece of text as pdf.js drew it: its string, where its baseline
// starts, how wide it is, its font size and which font (an index into the
// reading's fonts).
export const runSchema = z.object({
  s: z.string().max(MAX_RUN_CHARS),
  x: coord,
  y: coord,
  w: size,
  z: size,
  f: z.number().int().min(0).max(MAX_FONTS),
});
export type Run = z.infer<typeof runSchema>;

// A filled rectangle (a read-aloud box's tint, a sidebar's panel) and its
// colour as "#rrggbb".
export const boxSchema = z.object({
  x: coord,
  y: coord,
  w: size,
  h: size,
  c: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type Box = z.infer<typeof boxSchema>;

// A picture on the page: where it sits, its own pixel size, and a small
// fingerprint (an average hash of it shrunk to 8 x 8) that finds the same
// ornament on every page. `id` names it for the upload that follows.
export const pictureSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  x: coord,
  y: coord,
  w: size,
  h: size,
  pw: z.number().int().min(0).max(100_000),
  ph: z.number().int().min(0).max(100_000),
  hash: z.string().regex(/^[0-9a-f]{0,32}$/),
  // A page drawn as lines rather than pasted in as a picture (a vector
  // map): the page itself was rendered to make it.
  drawn: z.boolean().default(false),
  // A scanned page: one picture of the whole page, the words a hidden text
  // layer over it. `of` names that page picture when this one is a part of
  // it cut out where no words are (the art and maps a scan holds).
  scan: z.boolean().default(false),
  of: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
});
export type Picture = z.infer<typeof pictureSchema>;

export const pageSchema = z.object({
  n: z.number().int().min(1).max(MAX_IMPORT_PAGES),
  w: size,
  h: size,
  runs: z.array(runSchema).max(MAX_RUNS_PER_PAGE),
  boxes: z.array(boxSchema).max(MAX_BOXES_PER_PAGE).default([]),
  pictures: z.array(pictureSchema).max(MAX_IMAGES_PER_PAGE).default([]),
});
export type ReadPage = z.infer<typeof pageSchema>;

export const fontSchema = z.object({
  name: z.string().max(120),
  bold: z.boolean(),
  italic: z.boolean(),
});
export type ReadFont = z.infer<typeof fontSchema>;

// The book's bookmarks, flattened: a title, the page it opens on, and how
// deep it sits.
export const outlineSchema = z.object({
  title: z.string().max(300),
  page: z.number().int().min(1).max(MAX_IMPORT_PAGES),
  depth: z.number().int().min(0).max(12),
});
export type OutlineItem = z.infer<typeof outlineSchema>;

// What the page knows before the first page is sent: the opening request.
export const readingHeadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).default(""),
  pageCount: z.number().int().min(1).max(MAX_IMPORT_PAGES),
  outline: z.array(outlineSchema).max(MAX_OUTLINE).default([]),
});
export type ReadingHead = z.infer<typeof readingHeadSchema>;

// A batch of pages and the fonts named so far. Fonts are sent whole each
// time (a book has tens of them), so a batch never refers to one the server
// has not heard of.
export const pageBatchSchema = z.object({
  fonts: z.array(fontSchema).max(MAX_FONTS),
  pages: z.array(pageSchema).min(1).max(PAGES_PER_BATCH),
});
export type PageBatch = z.infer<typeof pageBatchSchema>;

export type Reading = ReadingHead & { fonts: ReadFont[]; pages: ReadPage[] };

// Bold and italic from the font's own name, since pdf.js reports only a
// generic family for text and most books carry the weight in the name
// ("ABCDEF+ScalySans-BoldItalic", "Cambria,Bold").
export function fontStyle(name: string): ReadFont {
  const plain = name.replace(/^[A-Z]{6}\+/, "");
  return {
    name: plain.slice(0, 120),
    bold: /bold|black|heavy|semibold|demi/i.test(plain),
    italic: /italic|oblique|-it\b|,it\b/i.test(plain),
  };
}
