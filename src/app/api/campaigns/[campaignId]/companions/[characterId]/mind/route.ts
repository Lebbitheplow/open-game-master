import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getSheetById } from "@/lib/db/sheets";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { getNpcMindModel, setNpcMindModel } from "@/lib/db/npc-minds";
import { commandable } from "@/lib/dm/companion-command";
import { mindChoiceProblem, mindModelOffer } from "@/lib/dm/npc-mind-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A companion's own mind: the model and reasoning effort it thinks with
// (ticket 09, src/lib/dm/npc-mind-model.ts). Whoever runs the story reads and
// picks it, from what the table's agent program or model server offers;
// blank is the table's.
// It holds from the mind's next call.

async function companionMind(campaignId: string, characterId: string) {
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetById(characterId);
  const npc = sheet && sheet.campaignId === campaignId && commandable(sheet) ? companionNpcFor(sheet) : null;
  if (!npc) {
    return Response.json({ error: "That is not a companion at this table." }, { status: 404 });
  }
  return { context, npc };
}

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string; characterId: string }> }) {
  const { campaignId, characterId } = await params;
  const found = await companionMind(campaignId, characterId);
  if (found instanceof Response) {
    return found;
  }
  return Response.json({ choice: getNpcMindModel(found.npc.id), offer: await mindModelOffer(found.context.campaign) });
}

const choiceSchema = z.object({
  model: z.string().trim().max(120),
  effort: z.string().trim().max(20),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string; characterId: string }> }) {
  const { campaignId, characterId } = await params;
  const found = await companionMind(campaignId, characterId);
  if (found instanceof Response) {
    return found;
  }
  const parsed = choiceSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say the model and the effort, or leave them blank for the table's." }, { status: 400 });
  }
  const choice = parsed.data;
  if (choice.model || choice.effort) {
    const offer = await mindModelOffer(found.context.campaign);
    if (!offer) {
      return Response.json({ error: "This table's model server lists no models to choose from, so its minds think with the table's model." }, { status: 409 });
    }
    const problem = mindChoiceProblem(offer, choice);
    if (problem) {
      return Response.json({ error: problem }, { status: 400 });
    }
  }
  setNpcMindModel(found.npc.id, choice);
  return Response.json({ choice: getNpcMindModel(found.npc.id) });
}
