import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { PRIVATE_SOURCE_REFUSAL } from "@/lib/db/private-sources";
import { workshopPrivateSource } from "@/lib/db/workshop-bundle-export";
import { exportWorkshopBundle } from "@/lib/db/workshop-bundle";
import { compileToPack } from "@/lib/workshop/to-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/campaigns/[campaignId]/dm/bundle/pack
//
// The world pack draft. It goes through the bundle rather than reading the
// workshop again, so the pack can only ever contain what the bundle would
// have carried: one export path, one set of rules about what travels.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // A workshop imported from a published book never becomes a pack.
  if (workshopPrivateSource(campaignId)) {
    return Response.json({ error: PRIVATE_SOURCE_REFUSAL }, { status: 403 });
  }
  const raw = await request.json().catch(() => ({}));
  const exported = exportWorkshopBundle(campaignId, (raw as { manifest?: unknown }).manifest);
  if ("error" in exported) {
    return Response.json({ error: exported.error }, { status: 400 });
  }
  return Response.json(compileToPack(exported.bundle));
}
