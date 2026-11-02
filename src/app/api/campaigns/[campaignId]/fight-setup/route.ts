import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { describeFightSetup } from "@/lib/workshop/fight-setup-logic";
import { saveTestAsSetup } from "@/lib/workshop/fight-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Save as this fight's set-up" on a test table (issue 685,
// src/lib/workshop/fight-setup.ts): the moment on the table goes onto the
// workshop's prepared fight it tests, and every test of that fight opens on
// it from then on. Only the test's author, at a test table.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const saved = saveTestAsSetup(context.campaign, context.user.id);
  if (!saved.ok) {
    return Response.json({ error: saved.error }, { status: 409 });
  }
  return Response.json({
    ok: true,
    templateId: saved.templateId,
    workshopId: saved.workshopId,
    keptMap: saved.keptMap,
    lines: describeFightSetup(saved.setup),
  });
}
