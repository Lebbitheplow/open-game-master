import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getLoreEntry } from "@/lib/db/lore";
import { feedsRules, ingestLoreAttachment } from "@/lib/dm/lore-attachments";
import { BOOK_TEXT_MAX } from "@/lib/pdf-import/reading";
import { readUploadedPdfText, writeUploadedPdfText } from "@/lib/uploads-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The words of a lore entry's rules PDF as the page read them with pdf.js.
// A rules PDF attached before the page read them was read only by the
// server's own reader, which returns glyph codes for most published books;
// GET says whether the page's reading is there, and PUT gives it, after
// which the entry's passages are read again for the rules search.

async function entryFor(campaignId: string, entryId: string) {
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) return context;
  const entry = getLoreEntry(entryId);
  if (!entry || entry.campaignId !== campaignId || !entry.attachmentPath) {
    return Response.json({ error: "That lore entry has no PDF." }, { status: 404 });
  }
  return entry;
}

type Params = { params: Promise<{ campaignId: string; entryId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { campaignId, entryId } = await params;
  const entry = await entryFor(campaignId, entryId);
  if (entry instanceof Response) return entry;
  const text = await readUploadedPdfText(entry.attachmentPath, campaignId);
  return Response.json({ read: Boolean(text?.trim()), feedsRules: feedsRules(entry) });
}

const bodySchema = z.object({ text: z.string().min(1).max(BOOK_TEXT_MAX) });

export async function PUT(request: Request, { params }: Params) {
  const { campaignId, entryId } = await params;
  const entry = await entryFor(campaignId, entryId);
  if (entry instanceof Response) return entry;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "That text could not be read." }, { status: 400 });
  // This campaign's reading only: another campaign that attached the same
  // PDF keeps its own (uploads-store.ts).
  if (!(await writeUploadedPdfText(entry.attachmentPath, parsed.data.text, campaignId))) {
    return Response.json({ error: "That PDF is not one of this server's uploads." }, { status: 400 });
  }
  const chunks = await ingestLoreAttachment(entry);
  return Response.json({ read: true, chunks });
}
