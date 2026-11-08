import { readFileSync } from "node:fs";
import { currentUser, unauthorized } from "@/lib/auth";
import { getPdfImportForUser } from "@/lib/db/pdf-imports";
import { pictureFile } from "@/lib/pdf-import/land";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A kept picture for the review's thumbnails, to the import's own person
// only: the pictures are a published book's art, not the server's to show.

export async function GET(_request: Request, { params }: { params: Promise<{ importId: string; pictureId: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { importId, pictureId } = await params;
  const item = getPdfImportForUser(importId, user.id);
  const found = item ? pictureFile(item.id, pictureId) : null;
  if (!found) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(readFileSync(found.file), {
    // The type is the one its bytes were sniffed as when it arrived; a
    // browser is told not to guess another, and nothing in it may run.
    headers: { "Content-Type": found.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
