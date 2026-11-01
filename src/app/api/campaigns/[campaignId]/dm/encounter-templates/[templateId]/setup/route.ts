import { isErrorResponse, requirePrepAuthority } from "@/lib/campaign-api";
import { getEncounterTemplate, getTemplateSetup, setTemplateSetup } from "@/lib/db/encounter-templates";
import { describeFightSetup } from "@/lib/workshop/fight-setup-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A prepared fight's set-up (issue 685, src/lib/workshop/fight-setup-logic.ts):
// read in words and as data (an agent or #570's scorer reads the data), or
// removed, so the fight opens as its roster and plan make it again. A
// set-up is written only by saving a test's moment
// (src/app/api/campaigns/[campaignId]/fight-setup/route.ts).

async function resolve(campaignId: string, templateId: string) {
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return { error: context };
  }
  const template = getEncounterTemplate(templateId);
  // The id comes from the URL: the campaign check stops one campaign's id
  // reaching another's fight.
  if (!template || template.campaignId !== campaignId) {
    return { error: Response.json({ error: "No such prepared encounter." }, { status: 404 }) };
  }
  return { template };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const resolved = await resolve(campaignId, templateId);
  if ("error" in resolved) {
    return resolved.error;
  }
  const setup = getTemplateSetup(resolved.template.id);
  return Response.json({ setup, lines: setup ? describeFightSetup(setup) : [] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const resolved = await resolve(campaignId, templateId);
  if ("error" in resolved) {
    return resolved.error;
  }
  setTemplateSetup(resolved.template.id, null);
  return Response.json({ ok: true });
}
