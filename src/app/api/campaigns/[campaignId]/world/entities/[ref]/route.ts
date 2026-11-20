import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { deleteWorldEntity, updateWorldEntity } from "@/lib/db/world-forge";
import { forgetPaintJobs } from "@/lib/db/world-paint-jobs";
import { publishEphemeral } from "@/lib/events";
import { parseRef } from "@/lib/worldforge/model";
import { recordsChanged, worldEntryChanged } from "@/lib/workshop/record-events";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An entry's fields, by name. Each is read through world-forge's own
// readers (clean, cleanList, readEntry), which drop what this build does
// not hold; typing them a second time here would let the two drift.
const entryFieldsSchema = z.record(z.string(), z.unknown());

// One entry by its ref ("npc:<id>", "location:<id>", "faction:<id>",
// "lore:<id>"). The record must belong to this campaign; world-forge.ts
// checks before it writes anything.
function refFrom(value: string): string | null {
  const ref = value.includes("%") ? decodeURIComponent(value) : value;
  return parseRef(ref) ? ref : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = refFrom(rawRef);
  if (!ref) {
    return Response.json({ error: "No such entry." }, { status: 404 });
  }
  const parsed = entryFieldsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Expected the entry's fields to change." }, { status: 400 });
  }
  const result = updateWorldEntity(campaignId, ref, parsed.data);
  if ("error" in result) {
    // A conflict carries the fields and the entry as it is now, so the
    // editor can show what changed and keep the author's draft.
    return Response.json(
      result.conflicts ? { error: result.error, conflicts: result.conflicts, entity: result.entity } : { error: result.error },
      { status: result.status ?? 400 },
    );
  }
  publishEphemeral(campaignId, result.entity.shelf === "faction" ? "factions_updated" : "world_updated", { at: Date.now() });
  recordsChanged(campaignId, result.entity.shelf, "world");
  worldEntryChanged(campaignId, ref);
  return Response.json(result);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = refFrom(rawRef);
  if (!ref || !deleteWorldEntity(campaignId, ref)) {
    return Response.json({ error: "No such entry." }, { status: 404 });
  }
  forgetPaintJobs(campaignId, ref);
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, parseRef(ref)!.shelf, "world");
  worldEntryChanged(campaignId, ref, true);
  return Response.json({ ok: true });
}
