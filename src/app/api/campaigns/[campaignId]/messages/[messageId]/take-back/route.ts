import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { takeBackMove } from "@/lib/dm/take-back";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ confirm: z.boolean().optional() }).strict();

// Take back and rewrite: the newest player move leaves the transcript with
// the GM's answer to it, that answer's turns are reverted, and the words
// come back to be corrected (src/lib/dm/take-back.ts). Lead only, like
// "Revert this turn", because it changes what the whole table reads. A
// revert that would clash with newer changes answers 409 with its warnings
// until it is sent again with `confirm`.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId, messageId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || messageId.length > 80) {
    return Response.json({ error: "Invalid take-back request." }, { status: 400 });
  }
  const result = await takeBackMove(context, messageId, parsed.data);
  if (!result.ok) {
    return Response.json(
      { error: result.error, ...(result.warnings ? { warnings: result.warnings } : {}) },
      { status: result.status },
    );
  }
  return Response.json(result);
}
