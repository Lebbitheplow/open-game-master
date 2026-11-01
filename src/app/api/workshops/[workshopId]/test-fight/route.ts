import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { testFightsOf } from "@/lib/db/test-fights";
import { getWorkshopForUser } from "@/lib/db/workshops";
import { canCreateCampaigns, TEST_FIGHT_REFUSED } from "@/lib/shared-host";
import { TARGET_PARTY_LIMITS } from "@/lib/workshop/kind";
import { standInClasses } from "@/lib/workshop/stand-ins";
import { TEST_ALLY_LIMIT } from "@/lib/workshop/test-seats-logic";
import { endTestFights, openTestFight, testFightReadiness } from "@/lib/workshop/test-fight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A workshop's test fight (issue 553, src/lib/workshop/test-fight.ts): what
// the Test fight sheet reads before it offers the button (whether an AI DM
// is there to run one, the stand-in party, the test already open), starting
// one, by the AI DM or by its author, and ending it.

// Library companions who fight beside either party (issue 685); they count
// against their own cap, not the party's.
const allyIds = z.array(z.string().trim().min(1).max(80)).max(TEST_ALLY_LIMIT).optional();

const startSchema = z.object({
  templateId: z.string().trim().min(1).max(80),
  // Left out: the party the fight's saved set-up was seated with, else the
  // stand-ins (issue 685).
  party: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("stand-ins"), allyIds }),
      z.object({
        kind: z.literal("characters"),
        characterIds: z.array(z.string().trim().min(1).max(80)).min(1).max(TARGET_PARTY_LIMITS.size.max),
        allyIds,
      }),
    ])
    .optional(),
  // Who runs it. Left out: the AI DM where one is set up, else the author.
  runner: z.enum(["ai", "person"]).optional(),
});

async function resolve(workshopId: string) {
  const user = await currentUser();
  if (!user) {
    return { error: unauthorized() };
  }
  const workshop = getWorkshopForUser(workshopId, user.id);
  if (!workshop) {
    return { error: Response.json({ error: "Workshop not found." }, { status: 404 }) };
  }
  return { user, workshop };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const { user, workshop } = resolved;
  const readiness = await testFightReadiness(workshop);
  const party = workshop.gameSettings.targetParty;
  return Response.json({
    ready: readiness.ready,
    reason: readiness.reason,
    // Said before the button, so the sheet never offers a start it refuses.
    refused: canCreateCampaigns(user) ? "" : TEST_FIGHT_REFUSED,
    standIns: { size: party.size, level: party.level, classes: standInClasses(party.size) },
    open: testFightsOf(workshop.id, user.id)[0] ?? null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  if (!canCreateCampaigns(resolved.user)) {
    return Response.json({ error: TEST_FIGHT_REFUSED }, { status: 403 });
  }
  const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick a fight and who fights it." }, { status: 400 });
  }
  const runner = parsed.data.runner ?? ((await testFightReadiness(resolved.workshop)).ready ? "ai" : "person");
  const outcome = await openTestFight({
    workshop: resolved.workshop,
    userId: resolved.user.id,
    templateId: parsed.data.templateId,
    party: parsed.data.party,
    runner,
  });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  // `mapError`: the fight's saved map could not be laid (the table says so too).
  return Response.json({ ok: true, campaignId: outcome.campaignId, ...(outcome.mapError ? { mapError: outcome.mapError } : {}) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  return Response.json({ ok: true, ended: endTestFights(resolved.workshop.id, resolved.user.id) });
}
