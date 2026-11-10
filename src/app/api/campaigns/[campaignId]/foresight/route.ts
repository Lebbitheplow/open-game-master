import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, setSheetWatching } from "@/lib/db/sheets";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ on: z.boolean(), characterId: z.string() });

// The player turns watching on or off for this fight, for Portent, Chronal
// Shift, Flash of Genius or Favored by the Gods (src/lib/dm/foresight.ts). It is kept by the fight's id, so it ends with the
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
  // The stops come before any d20 the GM's calls throw, the console's as the
  // AI's (src/lib/dm/held-call.ts), so a person's table is watched too.
  const power = foretoldLeft(sheet).length
    ? "Portent"
    : holdsFeature(sheet, "chronal shift")
      ? "Chronal Shift"
      : holdsFeature(sheet, "flash of genius")
        ? "Flash of Genius"
        : holdsFeature(sheet, "favored by the gods")
          ? "Favored by the Gods"
          : null;
  // Portent wants a number left; the others are watched for while the
  // character holds them, and a stop is only made while a use (and the
  // reaction, where it costs one) is there to spend (foresight.ts).
  if (parsed.data.on && !power) {
    return Response.json({ error: `${sheet.name} holds no foretold number, Chronal Shift, Flash of Genius or Favored by the Gods.` }, { status: 409 });
  }
  const updated = setSheetWatching(sheet.id, parsed.data.on && encounter ? encounter.id : null);
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return Response.json({ sheet: updated });
}
