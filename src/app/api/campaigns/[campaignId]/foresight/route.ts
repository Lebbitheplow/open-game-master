import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, setSheetWatching } from "@/lib/db/sheets";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { narratorIsAi } from "@/lib/dm/viewer";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ on: z.boolean(), characterId: z.string() });

// The wizard's player turns watching on or off for this fight
// (src/lib/dm/foresight.ts). It is kept by the fight's id, so it ends with the
// fight, and reads as off once the numbers run out.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid choice." }, { status: 400 });
  }
  const sheet = getSheetById(parsed.data.characterId);
  if (!sheet || sheet.campaignId !== campaignId || sheet.userId !== context.user.id) {
    return Response.json({ error: "That is not your character." }, { status: 403 });
  }
  const encounter = getActiveEncounter(campaignId);
  if (parsed.data.on && !encounter) {
    return Response.json({ error: "There is no fight to watch." }, { status: 409 });
  }
  // The stops come in the AI GM's turns (src/lib/dm/turn.ts); a person
  // running the table rolls the monsters from the console, which never stops.
  if (parsed.data.on && !narratorIsAi(context.campaign.gameSettings.dmMode)) {
    return Response.json({ error: "A person runs this table: tell them when you use Portent." }, { status: 409 });
  }
  if (parsed.data.on && !foretoldLeft(sheet).length) {
    return Response.json({ error: `${sheet.name} holds no foretold number.` }, { status: 409 });
  }
  const updated = setSheetWatching(sheet.id, parsed.data.on && encounter ? encounter.id : null);
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return Response.json({ sheet: updated });
}
