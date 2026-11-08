"use client";

import { PAGES_PER_BATCH, type ReadPage } from "@/lib/pdf-import/reading";
import { furnitureIds, mapPagesOf } from "@/lib/pdf-import/picture-logic";
import type { ImportView } from "@/lib/pdf-import/view";

// Reading a book in the page and sending it to its import: open the PDF,
// open (or continue) the import, send the pages a batch at a time, then
// the pictures worth keeping one at a time, then start the server's job.
// Everything here runs in the page, so it is the same on the website and
// in the apps' screens (the apps patch fetch to their host).

export type SendProgress = { phase: "opening" | "pages" | "pictures" | "starting"; done: number; total: number };

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new Error("Could not reach the server. Your progress is kept; pick the PDF again to carry on.");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "The server would not take that. Try again.");
  return data;
}

// A batch the connection dropped is sent again a few times before giving
// up: a phone on the move loses a request now and then, and every request
// here can safely be repeated.
async function withRetries<T>(work: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (!(error instanceof Error) || !/reach the server/.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw last;
}

export async function sendBook(
  file: File,
  options: { campaignId?: string; continueId?: string; onProgress: (progress: SendProgress) => void; signal: { cancelled: boolean } },
): Promise<ImportView> {
  const { openBook } = await import("@/lib/pdf-import/read-pdf");
  options.onProgress({ phase: "opening", done: 0, total: 0 });
  const book = await openBook(file);
  try {
    const opened = options.continueId
      ? { import: { id: options.continueId } as ImportView }
      : await call<{ import: ImportView }>("/api/pdf-imports", {
          method: "POST",
          body: JSON.stringify({ ...book.head, ...(options.campaignId ? { campaignId: options.campaignId } : {}) }),
        });
    const id = opened.import.id;
    const pages: ReadPage[] = [];
    let batch: ReadPage[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const sending = batch;
      batch = [];
      await withRetries(() => call(`/api/pdf-imports/${id}/pages`, { method: "POST", body: JSON.stringify({ fonts: book.fonts, pages: sending }) }));
    };
    for (let n = 1; n <= book.head.pageCount; n += 1) {
      if (options.signal.cancelled) throw new Error("Stopped.");
      const page = await book.readPage(n);
      // Only what the picture pass needs stays in memory past its batch: the
      // pictures, and how many words the page has (a scan under many words
      // is the page itself, not a picture).
      pages.push({ ...page, runs: page.runs.slice(0, 60) });
      batch.push(page);
      if (batch.length >= PAGES_PER_BATCH) await flush();
      options.onProgress({ phase: "pages", done: n, total: book.head.pageCount });
    }
    await flush();

    // Ornaments repeated on every page and specks are left behind here, so
    // a book's borders never cross the network.
    const furniture = furnitureIds(pages, mapPagesOf(book.head.outline));
    const kept = pages.flatMap((page) => page.pictures.filter((picture) => !furniture.has(picture.id)).map((picture) => ({ page, picture })));
    let sent = 0;
    for (const { page, picture } of kept) {
      if (options.signal.cancelled) throw new Error("Stopped.");
      options.onProgress({ phase: "pictures", done: sent, total: kept.length });
      // Any picture might be a battle map (a book prints small ones too):
      // its grid is looked for while the pixels are at hand. Which ones are
      // maps the server decides from the words around them.
      const big = true;
      const of = picture.of ? page.pictures.find((candidate) => candidate.id === picture.of) : undefined;
      const encoded = await book.encodePicture(page.n, picture, big, of);
      sent += 1;
      if (!encoded) continue;
      try {
        await withRetries(() =>
          call(`/api/pdf-imports/${id}/pictures`, {
            method: "POST",
            body: JSON.stringify({ picture, page: page.n, width: encoded.width, height: encoded.height, grid: encoded.grid, dataUrl: encoded.dataUrl }),
          }),
        );
      } catch (error) {
        // Past the picture cap the rest are left out; the review says how
        // many came. Any other refusal stops the import.
        if (error instanceof Error && /keeps up to/.test(error.message)) break;
        throw error;
      }
    }
    options.onProgress({ phase: "starting", done: 0, total: 0 });
    const started = await call<{ import: ImportView }>(`/api/pdf-imports/${id}`, { method: "POST", body: JSON.stringify({ action: "start" }) });
    return started.import;
  } finally {
    await book.close();
  }
}
