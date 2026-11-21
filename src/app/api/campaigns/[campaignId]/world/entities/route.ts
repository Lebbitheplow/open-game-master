import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { createWorldEntity } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged, worldEntryChanged } from "@/lib/workshop/record-events";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An entry's fields, by name. Each is read through world-forge's own
// readers (clean, cleanList, readEntry), which drop what this build does
// not hold; typing them a second time here would let the two drift.
const entryFieldsSchema = z.record(z.string(), z.unknown());

// A new entry: the record on its type's shelf (a Cast member, a place, a
// faction, a lore entry) and its WorldForge half.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = entryFieldsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Expected the new entry's fields." }, { status: 400 });
  }
  const result = createWorldEntity(campaignId, parsed.data);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status ?? 400 });
  }
  publishEphemeral(campaignId, result.entity.shelf === "faction" ? "factions_updated" : "world_updated", { at: Date.now() });
  recordsChanged(campaignId, result.entity.shelf, "world");
  worldEntryChanged(campaignId, result.entity.ref);
  return Response.json(result);
}
