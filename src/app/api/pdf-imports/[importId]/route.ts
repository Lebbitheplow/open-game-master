import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getCampaignById } from "@/lib/db/campaigns";
import { deletePdfImport, getPdfImportForUser, readDraft, saveDraft, setImportState } from "@/lib/db/pdf-imports";
import { publishEphemeral } from "@/lib/events";
import { storytellerConfigured } from "@/lib/capabilities";
import { campaignCreationRefusal, canCreateCampaigns } from "@/lib/shared-host";
import { uploadRefusalResponse } from "@/lib/upload-budget";
import { recordsChanged } from "@/lib/workshop/record-events";
import { getDatabase } from "@/lib/db/core";
import { resumeIfStranded, startImportJob } from "@/lib/pdf-import/job";
import { landImport } from "@/lib/pdf-import/land";
import { importView, reviewView } from "@/lib/pdf-import/view";
import { applyMatches } from "@/lib/pdf-import/matches";
import { chooseMatches, optionDetail } from "@/lib/pdf-import/match-logic";
import { isSrdCreature, srdCreatures } from "@/lib/pdf-import/srd-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One import: its progress (GET), the GM's review choices (PATCH: what to
// take, the workshop's name, each creature's SRD 5.1 match; renaming is the
// workshop editors' afterwards, where every link follows), starting
// the job or bringing the result in (POST), and discarding it (DELETE).
// Only the person who opened an import sees or touches it.

type Params = { params: Promise<{ importId: string }> };

async function mine(params: Params["params"]) {
  const user = await currentUser();
  if (!user) return { response: unauthorized() } as const;
  const { importId } = await params;
  const item = getPdfImportForUser(importId, user.id);
  if (!item) return { response: Response.json({ error: "That import is gone. Pick the PDF again." }, { status: 404 }) } as const;
  return { user, item } as const;
}

export async function GET(_request: Request, { params }: Params) {
  const found = await mine(params);
  if ("response" in found) return found.response;
  resumeIfStranded(found.item);
  const draft = found.item.state === "review" ? readDraft(found.item.id) : null;
  // The whole SRD bestiary rides along when there is a match to make, for
  // the review's search; a few hundred names and their size, type and CR.
  const srd = draft?.matches?.length ? srdCreatures().map((entry) => ({ name: entry.name, detail: optionDetail(entry) })) : undefined;
  return Response.json({ import: importView(found.item), ...(draft ? { review: reviewView(draft) } : {}), ...(srd ? { srd } : {}) });
}

const patchSchema = z.object({
  // Records ticked in or out, by key.
  include: z.record(z.string().max(120), z.boolean()).default({}),
  // The workshop's name.
  title: z.string().trim().min(1).max(70).optional(),
  // A creature's SRD 5.1 match, by its ask's key: an SRD creature's name,
  // or null for the book's own numbers; confirmed or not yet.
  matches: z.record(z.string().max(160), z.object({ srd: z.string().max(120).nullable(), confirmed: z.boolean() })).default({}),
});

export async function PATCH(request: Request, { params }: Params) {
  const found = await mine(params);
  if ("response" in found) return found.response;
  if (found.item.state !== "review") return Response.json({ error: "This import is not waiting for review." }, { status: 409 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Those choices could not be read." }, { status: 400 });
  const draft = readDraft(found.item.id);
  if (!draft) return Response.json({ error: "This import lost its draft. Read the book again." }, { status: 409 });
  for (const record of draft.records) {
    const include = parsed.data.include[record.key];
    if (include !== undefined) record.include = include;
  }
  if (parsed.data.title) draft.title = parsed.data.title;
  const choices = parsed.data.matches;
  if (Object.keys(choices).length) {
    // Only an SRD 5.1 creature's own name is a match.
    const stranger = Object.values(choices).find((choice) => choice.srd !== null && !isSrdCreature(choice.srd));
    if (stranger) return Response.json({ error: `"${stranger.srd}" is not an SRD 5.1 creature. Pick one from the list.` }, { status: 400 });
    draft.matches = chooseMatches(draft.matches ?? [], choices);
    applyMatches(draft);
  }
  saveDraft(found.item.id, draft);
  return Response.json({ import: importView(found.item), review: reviewView(draft) });
}

const postSchema = z.discriminatedUnion("action", [
  // Every page has arrived: read the book. Asked again from review or after
  // a failure, it reads again (keeping the model's answers it already has).
  z.object({ action: z.literal("start") }),
  // Bring the reviewed result in: a new workshop, or the WorldForge the
  // import was begun in. "workshop" from WorldForge makes a new workshop
  // with everything instead.
  z.object({ action: z.literal("import"), destination: z.enum(["workshop", "world"]).default("workshop") }),
]);

export async function POST(request: Request, { params }: Params) {
  const found = await mine(params);
  if ("response" in found) return found.response;
  const { user, item } = found;
  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "That is not something an import can do." }, { status: 400 });

  if (parsed.data.action === "start") {
    if (item.state === "working") return Response.json({ import: importView(item) });
    if (!["reading", "ready", "failed", "review"].includes(item.state)) return Response.json({ error: "This import cannot be read again." }, { status: 409 });
    if (item.pagesReceived < item.pageCount) {
      return Response.json({ error: `Only ${item.pagesReceived} of the book's ${item.pageCount} pages arrived. Pick the PDF again to send the rest.` }, { status: 409 });
    }
    // Reading again starts from the layout; the model's answers so far are
    // kept, so a second run asks only for what is missing.
    getDatabase().prepare(`UPDATE pdf_imports SET draft_blob = NULL WHERE id = ?`).run(item.id);
    setImportState(item.id, { state: "ready", useModel: await storytellerConfigured(), done: 0, total: 0 });
    startImportJob(item.id);
    const fresh = getPdfImportForUser(item.id, user.id);
    return Response.json({ import: fresh ? importView(fresh) : importView(item) });
  }

  const destination = parsed.data.destination;
  if (destination === "workshop" && !canCreateCampaigns(user)) return campaignCreationRefusal();
  if (destination === "world") {
    const target = item.campaignId ? getCampaignById(item.campaignId) : null;
    if (!target) return Response.json({ error: "The WorldForge this import was begun in is gone. Bring it in as a new workshop instead." }, { status: 409 });
    // Still theirs to write in: an author taken off the workshop since the
    // import began cannot land a book in it.
    const authority = await requireStoryAuthority(target.id);
    if (isErrorResponse(authority)) return authority;
  }
  const landed = landImport(item, { id: user.id, isAdmin: user.isAdmin }, destination);
  if ("error" in landed) {
    return landed.refusal ? uploadRefusalResponse(landed.refusal) : Response.json({ error: landed.error }, { status: landed.status });
  }
  if (destination === "world") {
    publishEphemeral(landed.workshopId, "world_updated", { at: Date.now() });
    recordsChanged(landed.workshopId, "npc", "lore", "location", "faction", "world");
  }
  return Response.json({ workshopId: landed.workshopId, ...(landed.shelf ? { shelf: landed.shelf } : {}) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const found = await mine(params);
  if ("response" in found) return found.response;
  // A running job sees its row gone and stops at its next piece.
  deletePdfImport(found.item.id);
  return Response.json({ ok: true });
}
