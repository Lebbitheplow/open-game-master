import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getSheetForUser, ownLivingSheet, patchSheet } from "@/lib/db/sheets";
import { tableAuthors } from "@/lib/db/homebrew";
import { subclassExtrasFor } from "@/lib/db/subclass-extras";
import { publishPersisted } from "@/lib/events";
import { featChoicesSchema } from "@/lib/schemas/sheet";
import { applyOwedPicks } from "@/lib/srd/owed-picks-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: a pick the character's levels earned and no level-up offered, made
// from the sheet (issue #833): a dragon ancestor for a sorcerer saved before
// the pick existed, a favored enemy, a fighting style, the language a
// ranger's Favored Enemy teaches. Only what the sheet owes, judged as the
// level-up judges its picks (src/lib/srd/owed-picks-logic.ts), on the
// player's own character; whoever runs the table changes anything else
// through their own tools.
const owedSchema = z.object({
  characterId: z.string().min(1).max(80).optional(),
  // Each an owed option by its feature name ("Dragon Ancestor: Red").
  features: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  // An owed training pick, keyed by the grant's name.
  featChoices: featChoicesSchema.optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = owedSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Say which owed pick to make." }, { status: 400 });
  }
  // A living character of the player's own, as the level-up reads it: the
  // dead make no picks.
  const named = parsed.data.characterId;
  const seated = named ? null : getSheetForUser(campaignId, context.user.id);
  const sheet = named
    ? ownLivingSheet(campaignId, context.user.id, named)
    : seated && !seated.isCompanion && seated.deathSaves?.dead !== true
      ? seated
      : null;
  if (!sheet) {
    return Response.json({ error: "That is not one of your living characters." }, { status: 404 });
  }
  // The table's workshop and pack subclasses and its workshop feats, so the
  // regrant keeps what they grant (owed-picks-logic.ts OwedContext).
  const applied = applyOwedPicks(
    sheet,
    { features: parsed.data.features, featChoices: parsed.data.featChoices },
    { extras: subclassExtrasFor(tableAuthors(campaignId)), campaignId },
  );
  if (!applied.ok) {
    return Response.json({ error: applied.error }, { status: 400 });
  }
  const updated = patchSheet(sheet.id, {
    features: applied.features,
    ...(applied.proficiencies ? { proficiencies: applied.proficiencies } : {}),
    ...(applied.featChoices ? { featChoices: applied.featChoices } : {}),
  });
  if (!updated) {
    return Response.json({ error: "Could not save the pick." }, { status: 500 });
  }
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  return Response.json({ sheet: updated, made: applied.made });
}
