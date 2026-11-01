import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { spellEngineName, spellFactsFor } from "@/lib/content";
import { tableAuthors } from "@/lib/db/homebrew";
import { getSheetById } from "@/lib/db/sheets";
import { ritualProblem } from "@/lib/dm/cast-rules";
import { hasPactOfTheChain } from "@/lib/dm/pet-build";
import { familiarCatalogue, isFindFamiliar } from "@/lib/srd/familiar-forms";
import { summonCatalogue, summonSpellFor, type SummonCatalogue } from "@/lib/srd/summon-spells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/campaigns/[id]/summons?spell=Conjure%20Animals&spell=Shield&characterId=...
//
// The creatures each summoning spell asked about can call, for the summon
// pickers (issue 685, src/lib/battlemap/hand-summon.ts: the Hand's card and
// the sheet's summoning door): the stat blocks the cast spawns and the
// numbers each slot may bring, from the engine's own catalogue
// (src/lib/srd/summon-spells.ts summonCatalogue, familiar-forms.ts for Find
// Familiar). Keyed by the name asked, so a table's workshop copy ("Call the
// Wild", running as Conjure Animals) is answered as the spell it runs as. A
// spell that makes no creatures is left out. With a character of this
// table, the answer is that caster's: Pact of the Chain's familiar forms
// only with the pact, and whether they may cast it as a ritual. The browser
// never loads the SRD's creature table itself.

const MAX_SPELLS = 60;

const querySchema = z.object({
  spells: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_SPELLS),
  characterId: z.string().trim().min(1).max(80).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ spells: url.searchParams.getAll("spell"), characterId: url.searchParams.get("characterId") ?? undefined });
  if (!parsed.success) {
    return Response.json({ error: `Ask about 1 to ${MAX_SPELLS} spells by name: ?spell=Conjure%20Animals.` }, { status: 400 });
  }
  const caster = parsed.data.characterId ? getSheetById(parsed.data.characterId) : null;
  if (parsed.data.characterId && caster?.campaignId !== campaignId) {
    return Response.json({ error: "That character is not at this table." }, { status: 404 });
  }
  const authors = tableAuthors(campaignId);
  const summons: Record<string, SummonCatalogue> = {};
  for (const name of parsed.data.spells) {
    const engine = spellEngineName(name, authors);
    const summoning = summonSpellFor(engine);
    const catalogue = summoning ? summonCatalogue(summoning) : isFindFamiliar(engine) ? familiarCatalogue() : null;
    if (!catalogue) {
      continue;
    }
    const facts = spellFactsFor(name, authors);
    const long = typeof facts?.castingTime === "number" ? { long: true } : {};
    if (!caster) {
      summons[name] = { ...catalogue, ...long };
      continue;
    }
    const chain = hasPactOfTheChain(caster);
    summons[name] = {
      ...catalogue,
      ...long,
      forms: catalogue.forms.filter((form) => chain || !form.chainOnly),
      ...(facts?.ritual && !ritualProblem(caster, name, facts) ? { ritual: true } : {}),
    };
  }
  return Response.json({ summons });
}
