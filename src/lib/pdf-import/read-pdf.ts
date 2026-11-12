"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportCanvas, blobToDataUrl } from "@/lib/image-encode";
import {
  fontStyle,
  IMPORT_IMAGE_MAX_EDGE,
  MAX_IMPORT_IMAGE_BYTES,
  MAX_IMPORT_PAGES,
  MAX_OUTLINE,
  type OutlineItem,
  type Picture,
  type ReadFont,
  type ReadingHead,
  type ReadPage,
} from "@/lib/pdf-import/reading";
import { averageHash, detectGrid, mapPagesOf, pixelSpread, type GridGuess } from "@/lib/pdf-import/picture-logic";
import { readPageFrom, type TextItem } from "@/lib/pdf-import/page-read-logic";

// Reading an adventure PDF in the page with pdf.js. The page, not the
// server, reads the book: the same code then runs on the website and in the
// desktop and Android apps (whose screens are the server's pages compiled
// natively), the phone's own world needs no image codec or addon, and the
// PDF itself never leaves the device. What comes out is reading.ts's pages
// and, one at a time, the pictures worth keeping.
//
// pdf.js and its worker are loaded only when an import starts. The worker
// and its data files are copied into public/pdfjs at install
// (scripts/copy-dice-assets.mjs), and the apps carry that folder. The
// worker script is fetched and started from a blob URL, because the apps'
// page origin is not the host's: a fetch of "/pdfjs/..." is answered from
// the app's own copy or the host, where a Worker URL would only look at the
// app's origin. Failing that, pdf.js runs on the page's own thread, slower
// but complete. The data files go through the page's fetch for the same
// reason (useWorkerFetch: false).

// pdf.js's legacy build, polyfilled: the modern one needs built-ins only the
// newest engines have, and a phone's WebView or a Safari a few versions back
// would fail on every book (scripts/copy-dice-assets.mjs ships its worker).
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

export const PDFJS_ROOT = "/pdfjs/";

let loading: Promise<PdfJs> | null = null;

async function startWorker(lib: PdfJs): Promise<void> {
  try {
    const response = await fetch(`${PDFJS_ROOT}pdf.worker.min.mjs`);
    if (!response.ok) throw new Error(`worker ${response.status}`);
    const source = await response.text();
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    lib.GlobalWorkerOptions.workerPort = new Worker(url, { type: "module" });
    return;
  } catch {
    // No worker here: pdf.js reads on the main thread from the module
    // itself (it looks for globalThis.pdfjsWorker before asking for one).
  }
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
}

export function loadPdfJs(): Promise<PdfJs> {
  loading ??= (async () => {
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    await startWorker(lib);
    return lib;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export class PdfRefusal extends Error {}

// A picture ready to send: its data URL, its size as sent, and the grid
// found on it (in the sent picture's pixels), if one was looked for.
export type EncodedPicture = { dataUrl: string; width: number; height: number; grid: GridGuess | null };

// One open book: its pages are read in order, then the pictures kept are
// drawn again, one by one, for upload.
export type OpenedBook = {
  doc: PDFDocumentProxy;
  head: ReadingHead;
  fonts: ReadFont[];
  readPage: (pageNumber: number) => Promise<ReadPage>;
  // `of`: the scanned page picture a cut-out part (picture.of) comes from.
  encodePicture: (pageNumber: number, picture: Picture, findGrid: boolean, of?: Picture) => Promise<EncodedPicture | null>;
  close: () => Promise<void>;
};

// pdf.js reads its character maps, standard fonts and image decoders
// through this. Its own reader uses XMLHttpRequest for any page that is not
// http(s), such as the desktop app's file:// screens, and the apps answer
// only fetch from their copy of /pdfjs; this always fetches.
type DataKind = "cMapUrl" | "standardFontDataUrl" | "wasmUrl";
class FetchBinaryData {
  private readonly bases: Partial<Record<DataKind, string>>;
  constructor(bases: Partial<Record<DataKind, string | null>>) {
    this.bases = Object.fromEntries(Object.entries(bases).filter(([, base]) => base)) as Partial<Record<DataKind, string>>;
  }
  async fetch({ kind, filename }: { kind: DataKind; filename: string }): Promise<Uint8Array> {
    const base = this.bases[kind];
    if (!base) throw new Error(`No ${kind} for pdf.js`);
    const response = await fetch(`${base}${filename}`);
    if (!response.ok) throw new Error(`pdf.js data ${filename}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export async function openBook(file: File): Promise<OpenedBook> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({
    data,
    useWorkerFetch: false,
    BinaryDataFactory: FetchBinaryData,
    cMapUrl: `${PDFJS_ROOT}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ROOT}standard_fonts/`,
    wasmUrl: `${PDFJS_ROOT}wasm/`,
    enableXfa: false,
    fontExtraProperties: true,
    verbosity: 0,
  });
  // A password is asked once and refused: an import never guesses one, and
  // a locked file is its owner's to unlock.
  task.onPassword = () => {
    void task.destroy();
  };
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "PasswordException" || /password/i.test(String((error as Error)?.message))) {
      throw new PdfRefusal("That PDF is password protected. Open it without the password lock and try again.");
    }
    if (name === "InvalidPDFException") throw new PdfRefusal("That file is not a PDF this reader can open.");
    // What pdf.js said, for whoever looks at the console; the GM is told
    // plainly.
    console.warn("[pdf-import] pdf.js could not open the book", error);
    throw new PdfRefusal("That PDF could not be read.");
  }
  // A publisher that switched copying off has said its text is not to be
  // lifted out; that is respected, never worked around.
  const permissions = await doc.getPermissions().catch(() => null);
  if (permissions && !permissions.has(lib.PermissionFlag.COPY)) {
    await task.destroy();
    throw new PdfRefusal("This PDF's publisher switched off copying its text, so it cannot be imported.");
  }
  if (doc.numPages > MAX_IMPORT_PAGES) {
    await task.destroy();
    throw new PdfRefusal(`That PDF has ${doc.numPages} pages; an import takes up to ${MAX_IMPORT_PAGES}.`);
  }

  const fonts: ReadFont[] = [];
  const fontIndex = new Map<string, number>();
  const fontOf = (name: string): number => {
    const known = fontIndex.get(name);
    if (known !== undefined) return known;
    const index = fonts.length;
    fonts.push(fontStyle(name));
    fontIndex.set(name, index);
    return index;
  };
  // Which pdf.js object each picture id stands for, from the first read to
  // the drawing that follows.
  const pictureObjects = new Map<string, { objId: string; common: boolean; paint: number }>();

  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: unknown };
  const head: ReadingHead = {
    fileName: file.name.slice(0, 200) || "adventure.pdf",
    title: typeof info.Title === "string" ? info.Title.trim().slice(0, 200) : "",
    pageCount: doc.numPages,
    outline: await readOutline(doc),
  };

  const mapPages = mapPagesOf(head.outline);
  return {
    doc,
    head,
    fonts,
    readPage: (pageNumber) => readOnePage(lib, doc, pageNumber, fontOf, pictureObjects, mapPages.has(pageNumber)),
    encodePicture: (pageNumber, picture, findGrid, of) => encodeOnePicture(lib, doc, pageNumber, picture, pictureObjects, findGrid, of),
    close: async () => {
      await task.destroy().catch(() => undefined);
    },
  };
}

async function readOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  const outline = await doc.getOutline().catch(() => null);
  const out: OutlineItem[] = [];
  type Node = { title: string; dest: unknown; items?: Node[] };
  const walk = async (nodes: Node[], depth: number) => {
    for (const node of nodes) {
      if (out.length >= MAX_OUTLINE) return;
      const page = await destinationPage(doc, node.dest);
      const title = String(node.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (page && title) out.push({ title, page, depth: Math.min(depth, 12) });
      if (node.items?.length) await walk(node.items, depth + 1);
    }
  };
  if (outline) await walk(outline as Node[], 0);
  return out;
}

async function destinationPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const target = explicit[0];
    const index = typeof target === "number" ? target : await doc.getPageIndex(target as never);
    return index + 1;
  } catch {
    return null;
  }
}

async function readOnePage(
  lib: PdfJs,
  doc: PDFDocumentProxy,
  pageNumber: number,
  fontOf: (name: string) => number,
  pictureObjects: Map<string, { objId: string; common: boolean; paint: number }>,
  mapPage = false,
): Promise<ReadPage> {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    await picturesReady(page, ops, lib.OPS.paintImageXObject);
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }>;
    await fontsReady(page, content.items.flatMap((item) => ("fontName" in item && typeof item.fontName === "string" ? [item.fontName] : [])));
    return readPageFrom({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      toPage: (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
      ops,
      codes: lib.OPS,
      textItems: content.items.filter((item) => "str" in item) as unknown as TextItem[],
      fontName: (id) => fontNameOf(page, id, styles),
      fontIndex: fontOf,
      image: (objId) => imageObject(page, objId),
      inlineImage: (args) => (args && typeof args === "object" ? (args as PdfImage) : null),
      hash: (objId) => {
        const image = imageObject(page, objId);
        return image ? averageHash(pixelsOf(drawImage(image, 8, 8))) : "";
      },
      remember: (pictureId, objId, paint) => pictureObjects.set(pictureId, { objId, common: objId.startsWith("g_"), paint }),
      mapPage,
    });
  } finally {
    page.cleanup();
  }
}

// A large picture is decoded after the operator list comes back, so its
// object is not there to read yet; each one the page paints is waited for
// (briefly: one that never arrives is simply not kept).
export async function picturesReady(page: PDFPageProxy, ops: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }, paintImage: number): Promise<void> {
  const ids = new Set<string>();
  for (let index = 0; index < ops.fnArray.length; index += 1) {
    if (ops.fnArray[index] === paintImage) ids.add(String((ops.argsArray[index] as unknown[])[0]));
  }
  await Promise.all(
    [...ids].map(
      (objId) =>
        new Promise<void>((resolve) => {
          const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
          const timer = setTimeout(resolve, 15_000);
          try {
            store.get(objId, () => {
              clearTimeout(timer);
              resolve();
            });
          } catch {
            clearTimeout(timer);
            resolve();
          }
        }),
    ),
  );
}

// The object id of the page's nth picture paint in this reading of it.
function paintedId(ops: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }, paintImage: number, nth: number): string | null {
  let seen = -1;
  for (let index = 0; index < ops.fnArray.length; index += 1) {
    if (ops.fnArray[index] !== paintImage) continue;
    seen += 1;
    if (seen === nth) return String((ops.argsArray[index] as unknown[])[0]);
  }
  return null;
}

// pdf.js loads a page's fonts as it goes, so a font's real name ("Helvetica-
// Bold") may not be there yet when the text is: read too soon, a bold
// heading comes through as plain "sans-serif" and a stat block's name is
// lost in the text under it. A slow phone loses that race more often than a
// desktop; each font the text uses is waited for (a few seconds at most).
async function fontsReady(page: PDFPageProxy, ids: string[]): Promise<void> {
  await Promise.all(
    [...new Set(ids)].map(
      (id) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3_000);
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          try {
            if (page.commonObjs.has(id)) done();
            else page.commonObjs.get(id, done);
          } catch {
            done();
          }
        }),
    ),
  );
}

function fontNameOf(page: PDFPageProxy, fontName: string, styles: Record<string, { fontFamily?: string }>): string {
  try {
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as { name?: string } | null;
      if (font?.name) return font.name;
    }
  } catch {
    // Not loaded: the family pdf.js reported is the best there is.
  }
  return styles[fontName]?.fontFamily ?? fontName;
}

type PdfImage = { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: ImageBitmap };

function imageObject(page: PDFPageProxy, objId: string): PdfImage | null {
  try {
    const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
    if (!store.has(objId)) return null;
    return store.get(objId) as PdfImage;
  } catch {
    return null;
  }
}

// Draws a pdf.js picture onto a fresh canvas of the given size, from its
// decoded bitmap or its raw pixels (grey bits, RGB or RGBA).
function drawImage(image: PdfImage, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingQuality = "high";
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  const pixels = rgbaOf(image);
  if (!pixels) return canvas;
  const full = document.createElement("canvas");
  full.width = image.width;
  full.height = image.height;
  full.getContext("2d")?.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  context.drawImage(full, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function rgbaOf(image: PdfImage): Uint8ClampedArray<ArrayBuffer> | null {
  const { width, height, data, kind } = image;
  if (!data) return null;
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 3) {
    out.set(data.subarray(0, out.length));
    return out;
  }
  if (kind === 2) {
    for (let source = 0, target = 0; target < out.length; source += 3, target += 4) {
      out[target] = data[source];
      out[target + 1] = data[source + 1];
      out[target + 2] = data[source + 2];
      out[target + 3] = 255;
    }
    return out;
  }
  if (kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0;
        const target = (y * width + x) * 4;
        out[target] = value;
        out[target + 1] = value;
        out[target + 2] = value;
        out[target + 3] = 255;
      }
    }
    return out;
  }
  return null;
}

function fitted(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// A canvas as a data URL under the upload cap: WebP first, smaller and
// softer until it fits. The canvas it settled on comes back with it.
async function canvasDataUrl(canvas: HTMLCanvasElement): Promise<{ dataUrl: string; canvas: HTMLCanvasElement } | null> {
  let current = canvas;
  for (const quality of [0.85, 0.75, 0.6]) {
    const { blob } = await exportCanvas(current, { quality, keepAlpha: true });
    if (blob.size <= MAX_IMPORT_IMAGE_BYTES * 0.7) return { dataUrl: await blobToDataUrl(blob), canvas: current };
    const smaller = document.createElement("canvas");
    smaller.width = Math.round(current.width * 0.75);
    smaller.height = Math.round(current.height * 0.75);
    smaller.getContext("2d")?.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  return null;
}

// The grid on a picture, looked for at no more than 1,024 pixels a side (a
// grid line survives that) and given back in the picture's own pixels.
function gridOf(canvas: HTMLCanvasElement): GridGuess | null {
  const scale = Math.min(1, 1_024 / Math.max(canvas.width, canvas.height));
  const probe = document.createElement("canvas");
  probe.width = Math.max(1, Math.round(canvas.width * scale));
  probe.height = Math.max(1, Math.round(canvas.height * scale));
  probe.getContext("2d")?.drawImage(canvas, 0, 0, probe.width, probe.height);
  const found = detectGrid(pixelsOf(probe), probe.width, probe.height);
  if (!found) return null;
  return { cell: found.cell / scale, offsetX: found.offsetX / scale, offsetY: found.offsetY / scale, confidence: found.confidence };
}

async function encodeOnePicture(
  lib: PdfJs,
  doc: PDFDocumentProxy,
  pageNumber: number,
  picture: Picture,
  pictureObjects: Map<string, { objId: string; common: boolean; paint: number }>,
  findGrid: boolean,
  of?: Picture,
): Promise<EncodedPicture | null> {
  const page = await doc.getPage(pageNumber);
  try {
    let canvas: HTMLCanvasElement | null = null;
    if (picture.of && of) {
      // A part of a scanned page: that page's picture, cut to the part.
      const known = pictureObjects.get(of.id);
      const ops = await page.getOperatorList();
      await picturesReady(page, ops, lib.OPS.paintImageXObject);
      const image = known ? imageObject(page, paintedId(ops, lib.OPS.paintImageXObject, known.paint) ?? known.objId) : null;
      if (!image || !of.w || !of.h) return null;
      const sx = ((picture.x - of.x) / of.w) * image.width;
      const sy = ((picture.y - of.y) / of.h) * image.height;
      const sw = (picture.w / of.w) * image.width;
      const sh = (picture.h / of.h) * image.height;
      const whole = drawImage(image, image.width, image.height);
      const size = fitted(sw, sh, IMPORT_IMAGE_MAX_EDGE);
      canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")?.drawImage(whole, sx, sy, sw, sh, 0, 0, size.width, size.height);
    } else if (picture.drawn) {
      const base = page.getViewport({ scale: 1 });
      const scale = IMPORT_IMAGE_MAX_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      await page.render({ canvasContext: context, canvas, viewport, annotationMode: lib.AnnotationMode.DISABLE }).promise;
    } else {
      const known = pictureObjects.get(picture.id);
      const ops = await page.getOperatorList();
      await picturesReady(page, ops, lib.OPS.paintImageXObject);
      const image = known ? imageObject(page, paintedId(ops, lib.OPS.paintImageXObject, known.paint) ?? known.objId) : null;
      if (!image) return null;
      const size = fitted(image.width, image.height, IMPORT_IMAGE_MAX_EDGE);
      canvas = drawImage(image, size.width, size.height);
    }
    // Blank paper (a scan's empty column, a page left white) is no picture.
    if (picture.scan || picture.of) {
      const probe = document.createElement("canvas");
      probe.width = 32;
      probe.height = 32;
      probe.getContext("2d")?.drawImage(canvas, 0, 0, 32, 32);
      if (pixelSpread(pixelsOf(probe)) < 14) return null;
    }
    const encoded = await canvasDataUrl(canvas);
    if (!encoded) return null;
    return { dataUrl: encoded.dataUrl, width: encoded.canvas.width, height: encoded.canvas.height, grid: findGrid ? gridOf(encoded.canvas) : null };
  } finally {
    page.cleanup();
  }
}

function pixelsOf(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = canvas.getContext("2d");
  return context ? context.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8ClampedArray();
}
