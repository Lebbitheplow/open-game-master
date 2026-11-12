import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { campaignCreationRefusal, canCreateCampaigns } from "@/lib/shared-host";
import { createPdfImport, listPdfImports, MAX_OPEN_IMPORTS, openImportCount } from "@/lib/db/pdf-imports";
import { readingHeadSchema } from "@/lib/pdf-import/reading";
import { resumeIfStranded } from "@/lib/pdf-import/job";
import { importView } from "@/lib/pdf-import/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Adventure PDF imports (src/lib/pdf-import/*). The page reads the book and
// opens an import here with what it knows up front (the file's name, its
// title and bookmarks, its page count), then sends the pages and pictures
// to the import's own routes and starts the job. GET lists the caller's
// imports still open, so one left half-way (a closed tab, a phone asleep)
// is picked up again from the workshop.

const bodySchema = readingHeadSchema.extend({
  // Begun inside a workshop's WorldForge: the world it lands in.
  campaignId: z.string().trim().min(1).max(80).optional(),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  const imports = listPdfImports(user.id);
  for (const item of imports) resumeIfStranded(item);
  return Response.json({ imports: imports.map(importView) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That book's details could not be read. Pick the PDF again." }, { status: 400 });
  }
  const { campaignId, ...head } = parsed.data;
  if (campaignId) {
    const context = await requireStoryAuthority(campaignId);
    if (isErrorResponse(context)) return context;
  } else if (!canCreateCampaigns(user)) {
    return campaignCreationRefusal();
  }
  if (openImportCount(user.id) >= MAX_OPEN_IMPORTS) {
    return Response.json(
      { error: `You have ${MAX_OPEN_IMPORTS} imports open already. Finish or discard one where you began it (the Workshop page, or the WorldForge you began it in), then try again.` },
      { status: 409 },
    );
  }
  const created = createPdfImport({ userId: user.id, campaignId: campaignId ?? null, ...head });
  return Response.json({ import: importView(created) });
}
