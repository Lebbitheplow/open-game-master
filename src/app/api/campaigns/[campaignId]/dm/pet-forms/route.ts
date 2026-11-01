import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { listHomebrewMonsters } from "@/lib/bestiary/homebrew-monsters";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { hasPactOfTheChain, petFormCatalogue } from "@/lib/dm/pet-build";
import { getSheetById } from "@/lib/db/sheets";
import { z } from "zod";
import { compareNames } from "@/lib/language/text-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/campaigns/[id]/dm/pet-forms
//
// What Summon a pet's Creature picks from in the GM console (issue 685,
// src/lib/dm/pet-form-logic.ts): by kind, the creatures the engine takes
// (pet-build.ts buildPet), and for a story pet this table's own monsters
// (every author whose workshop monsters the table reads, as buildPet finds
// them) before the SRD's. Nothing here is typed: a story pet not in the list
// is the console's "Not in the list", with its hit points and AC. With the
// pet's owner (`characterId`), the familiar list holds Pact of the Chain's
// four only for an owner with the pact; asked with none (an older console),
// they stay listed and the engine refuses them for an owner without it.

const ownerSchema = z.string().trim().min(1).max(80).optional();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const owner = ownerSchema.safeParse(new URL(request.url).searchParams.get("characterId") ?? undefined);
  if (!owner.success) {
    return Response.json({ error: "Name the pet's owner by characterId." }, { status: 400 });
  }
  const sheet = owner.data ? getSheetById(owner.data) : null;
  if (owner.data && sheet?.campaignId !== campaignId) {
    return Response.json({ error: "That character is not at this table." }, { status: 404 });
  }
  const names = new Set<string>();
  for (const userId of spellAuthorsFor(context.campaign)) {
    for (const monster of listHomebrewMonsters(userId)) {
      names.add(monster.draft.name);
    }
  }
  const catalogue = petFormCatalogue([...names].sort(compareNames));
  return Response.json({
    catalogue: sheet && !hasPactOfTheChain(sheet) ? { ...catalogue, familiar: catalogue.familiar.filter((form) => !form.chainOnly) } : catalogue,
  });
}
