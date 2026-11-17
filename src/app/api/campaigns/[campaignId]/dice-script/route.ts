import { hasPrepAuthority, isErrorResponse, requireMember, type MemberContext } from "@/lib/campaign-api";
import { clearDiceScript, getDiceScript, setDiceScript } from "@/lib/db/dice-scripts";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { describeDiceScript, describeUsed, diceScriptSchema } from "@/lib/dice-script-logic";
import { fieldedSheets } from "@/lib/dm/roster";
import { isPlaytest } from "@/lib/workshop/kind";
import { requestT } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ campaignId: string }> };

// A test table's dice script (issue 685, src/lib/db/dice-scripts.ts): read,
// replace or clear the seed and the forced faces. Only a test fight's table
// has one, and only its author (who holds every seat there) or whoever runs
// it may touch it: at every other table the server's dice stay honest, and
// this route says so. The refusals answer in the request's language (the
// sheet shows them raw), so the translator rides with the request.
async function requireTestTable(campaignId: string, t: (key: string, vars?: Record<string, string | number>) => string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isPlaytest(context.campaign)) {
    return Response.json(
      { error: t("Only a test fight's table can script its dice. Every other table rolls them honestly.") },
      { status: 403 },
    );
  }
  if (context.user.id !== context.campaign.ownerUserId && !hasPrepAuthority(context)) {
    return Response.json({ error: t("Only the person testing this fight can script its dice.") }, { status: 403 });
  }
  return context;
}

// What the Dice sheet reads: the script, what it spent, and who is at the
// table to aim a face at.
function view(context: MemberContext) {
  const { campaign } = context;
  const state = getDiceScript(campaign.id);
  const script = { seed: state?.seed ?? null, queue: state?.queue ?? [] };
  const encounter = getActiveEncounter(campaign.id);
  const enemies = encounter ? listEnemies(encounter.id).filter((enemy) => enemy.status === "alive") : [];
  return {
    script,
    summary: describeDiceScript(script),
    used: (state?.used ?? []).map((entry) => ({ ...entry, line: describeUsed(entry) })),
    seededRolls: state?.seededRolls ?? 0,
    combatants: [
      ...fieldedSheets(campaign).map((sheet) => ({ name: sheet.name, roller: "hero" as const })),
      ...enemies.map((enemy) => ({ name: enemy.displayName, roller: "enemy" as const })),
    ],
  };
}

export async function GET(request: Request, { params }: Params) {
  const { campaignId } = await params;
  const t = requestT(request);
  const context = await requireTestTable(campaignId, t);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(view(context));
}

export async function PUT(request: Request, { params }: Params) {
  const { campaignId } = await params;
  const t = requestT(request);
  const context = await requireTestTable(campaignId, t);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = diceScriptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      { error: issue?.message && issue.code === "custom" ? issue.message : t("That dice script could not be read. Check the seed and each forced face.") },
      { status: 400 },
    );
  }
  if (!setDiceScript(campaignId, parsed.data)) {
    return Response.json({ error: t("The dice script could not be saved on this table.") }, { status: 409 });
  }
  return Response.json(view(context));
}

export async function DELETE(request: Request, { params }: Params) {
  const { campaignId } = await params;
  const t = requestT(request);
  const context = await requireTestTable(campaignId, t);
  if (isErrorResponse(context)) {
    return context;
  }
  clearDiceScript(campaignId);
  return Response.json(view(context));
}
