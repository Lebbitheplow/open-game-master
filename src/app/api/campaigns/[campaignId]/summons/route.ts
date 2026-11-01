import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { spellEngineName } from "@/lib/content";
import { tableAuthors } from "@/lib/db/homebrew";
import { summonCatalogue, summonSpellFor, type SummonCatalogue } from "@/lib/srd/summon-spells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/campaigns/[id]/summons?spell=Conjure%20Animals&spell=Shield
//
// The creatures each summoning spell asked about can call, for the Hand's
// creature picker (issue 685, src/lib/battlemap/hand-summon.ts): the stat
// blocks the cast spawns and the numbers each slot may bring, from the
// engine's own catalogue (src/lib/srd/summon-spells.ts summonCatalogue).
// Keyed by the name asked, so a table's workshop copy ("Call the Wild",
// running as Conjure Animals) is answered as the spell it runs as. A spell
// that makes no creatures is left out. The browser never loads the SRD's
// creature table itself.

const MAX_SPELLS = 60;

const spellsSchema = z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_SPELLS);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = spellsSchema.safeParse(new URL(request.url).searchParams.getAll("spell"));
  if (!parsed.success) {
    return Response.json({ error: `Ask about 1 to ${MAX_SPELLS} spells by name: ?spell=Conjure%20Animals.` }, { status: 400 });
  }
  const authors = tableAuthors(campaignId);
  const summons: Record<string, SummonCatalogue> = {};
  for (const name of parsed.data) {
    const summoning = summonSpellFor(spellEngineName(name, authors));
    if (summoning) {
      summons[name] = summonCatalogue(summoning);
    }
  }
  return Response.json({ summons });
}
