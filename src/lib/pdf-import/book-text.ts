"use client";

import { layoutBlocks } from "@/lib/pdf-import/layout-logic";
import { BOOK_TEXT_MAX as PDF_TEXT_MAX, type ReadPage } from "@/lib/pdf-import/reading";

// A PDF's words in reading order, read in the page with pdf.js: what a
// rules PDF on a lore entry feeds the rules search with. The server's own
// reader (src/lib/pdf/text.ts) cannot read a book whose fonts are subset
// with their own codes, which is most published books; pdf.js reads their
// ToUnicode maps. Columns, running heads and page numbers are handled as
// the adventure import handles them (layout-logic.ts).

export async function readBookText(file: File | Blob, onPage?: (done: number, total: number) => void): Promise<string> {
  const { openBook } = await import("@/lib/pdf-import/read-pdf");
  const named = file instanceof File ? file : new File([file], "book.pdf", { type: "application/pdf" });
  const book = await openBook(named);
  try {
    const pages: ReadPage[] = [];
    let chars = 0;
    for (let n = 1; n <= book.head.pageCount && chars < PDF_TEXT_MAX; n += 1) {
      // Only the words are needed here; pictures and panels are let go.
      const page = await book.readPage(n);
      pages.push({ ...page, pictures: [] });
      chars += page.runs.reduce((sum, run) => sum + run.s.length + 1, 0);
      onPage?.(n, book.head.pageCount);
    }
    const blocks = layoutBlocks(pages, book.fonts);
    return blocks
      .map((block) => (block.kind === "heading" ? `\n${block.text.replace(/\*\*/g, "")}` : block.text.replace(/\*\*/g, "")))
      .join("\n\n")
      .slice(0, PDF_TEXT_MAX);
  } finally {
    await book.close();
  }
}
