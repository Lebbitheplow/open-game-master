import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq, setPartyLead } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getUserById } from "@/lib/db/users";
import { storyNameOf } from "@/lib/characters/story-name";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { requestT } from "@/lib/request-locale";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const leadSchema = z.object({ userId: z.string().optional() });

// Transfer the party lead. The current lead can hand it off; the owner can
// always reclaim or reassign it (their safety valve if a lead goes AWOL).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  // The refusal reads the asker's language; the settings page shows it raw.
  const t = requestT(request);
  const context = await requireMember(campaignId, request);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (user.id !== campaign.leadUserId && user.id !== campaign.ownerUserId) {
    return Response.json(
      { error: t("Only the party lead or the owner can transfer the lead.") },
      { status: 403 },
    );
  }

  const parsed = leadSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That user is not in this campaign." }, { status: 400 });
  }
  const targetUserId = parsed.data.userId ?? "";
  const target = targetUserId ? getUserById(targetUserId) : null;
  if (!target || !setPartyLead(campaignId, target.id)) {
    return Response.json({ error: "That user is not in this campaign." }, { status: 400 });
  }

  publishPersisted(campaignId, "campaign_updated", { leadUserId: target.id });
  if (target.id !== campaign.leadUserId) {
    // The GM reads this line as a table note: it names the new lead's hero,
    // not their account (#658), and no one when they have none.
    const hero = storyNameOf(campaignId, target.id);
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      glyph: "system-party",
      content: hero ? `${hero}'s player is now the party lead.` : "The party has a new lead.",
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }

  return Response.json({ leadUserId: target.id });
}
