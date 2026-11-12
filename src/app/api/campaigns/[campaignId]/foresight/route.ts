import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, setSheetWatching } from "@/lib/db/sheets";
import { TABLE_WATCH, watchFeatureOf } from "@/lib/dm/before-roll-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ on: z.boolean(), characterId: z.string() });

// The player turns watching on or off: for this fight, for any feature the
// watch stop answers with (src/lib/dm/foresight.ts); out of one, for a
// before-the-roll feature (Portent, Cosmic Omen, Restore Balance) on an
// ally's check or save (src/lib/dm/foresight-before.ts, issue #908). In a
// fight it is kept by the fight's id, so it ends with the fight; out of one
// by TABLE_WATCH, until the player turns it off. It reads as off once what it
// watches with runs out.
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
  // The stops come before any d20 the GM's calls throw, the console's as the
  // AI's (src/lib/dm/held-call.ts), so a person's table is watched too.
  // Portent wants a number left; the others are watched for while the
  // character holds them, and a stop is only made while a use (and the
  // reaction, where it costs one) is there to spend (foresight.ts).
  const power = watchFeatureOf(sheet, !encounter);
  if (parsed.data.on && !power) {
    return Response.json(
      { error: encounter ? `${sheet.name} holds nothing the watch stop answers with.` : `Out of a fight the table is watched for Portent, Cosmic Omen or Restore Balance, and ${sheet.name} has none of them to use.` },
      { status: 409 },
    );
  }
  const updated = setSheetWatching(sheet.id, parsed.data.on ? (encounter ? encounter.id : TABLE_WATCH) : null);
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return Response.json({ sheet: updated });
}
