import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { listHomebrewMonsters } from "@/lib/bestiary/homebrew-monsters";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { petFormCatalogue } from "@/lib/dm/pet-build";
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
// is the console's "Not in the list", with its hit points and AC.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const names = new Set<string>();
  for (const userId of spellAuthorsFor(context.campaign)) {
    for (const monster of listHomebrewMonsters(userId)) {
      names.add(monster.draft.name);
    }
  }
  return Response.json({ catalogue: petFormCatalogue([...names].sort(compareNames)) });
}
