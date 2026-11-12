import { currentUser, unauthorized } from "@/lib/auth";
import { getPdfImportForUser, importRuns, pendingImportRefusal, savePages } from "@/lib/db/pdf-imports";
import { MAX_IMPORT_RUNS, pageBatchSchema } from "@/lib/pdf-import/reading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A batch of the book's pages as the page read them (reading.ts), and the
// fonts named so far. Sending a page again replaces it, so a batch that
// failed on a weak connection is simply sent again.

export async function POST(request: Request, { params }: { params: Promise<{ importId: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { importId } = await params;
  const item = getPdfImportForUser(importId, user.id);
  if (!item) return Response.json({ error: "That import is gone. Pick the PDF again." }, { status: 404 });
  if (item.state !== "reading" && item.state !== "failed") {
    return Response.json({ error: "This import has all its pages already." }, { status: 409 });
  }
  const parsed = pageBatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Those pages could not be read. Try the PDF again." }, { status: 400 });
  if (parsed.data.pages.some((page) => page.n > item.pageCount)) {
    return Response.json({ error: "A page past the end of the book arrived." }, { status: 400 });
  }
  // A book's text is held to a total (reading.ts): ten times a big
  // hardcover's, and the bound on the work the layout pass can be asked.
  const runs = parsed.data.pages.reduce((sum, page) => sum + page.runs.length, 0);
  if (importRuns(item.id, parsed.data.pages.map((page) => page.n)) + runs > MAX_IMPORT_RUNS) {
    return Response.json({ error: "This book has more text than an import can read. Split the PDF and import it in parts." }, { status: 413 });
  }
  // Pages wait in the database until the import lands: held to the
  // account's room for unfinished imports and the disk's floor.
  const refusal = pendingImportRefusal(user.id, Buffer.byteLength(JSON.stringify(parsed.data.pages)));
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
  savePages(item.id, parsed.data.fonts, parsed.data.pages);
  return Response.json({ received: item.pagesReceived + parsed.data.pages.length });
}
