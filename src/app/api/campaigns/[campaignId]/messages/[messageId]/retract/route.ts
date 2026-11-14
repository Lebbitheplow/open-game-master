import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { retractMove } from "@/lib/dm/retract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Take back and rewrite: the newest move leaves the transcript with the GM's
// answer to it, that answer's turns are reverted, and the words come back to
// be corrected (src/lib/dm/retract.ts). Lead only, like "Revert this turn",
// because it changes what the whole table reads.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const result = await retractMove(context, messageId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, text: result.text, reverted: result.reverted });
}
