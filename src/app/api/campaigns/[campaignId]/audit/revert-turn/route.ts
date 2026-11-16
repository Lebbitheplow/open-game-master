import { z } from "zod";
import { isErrorResponse, requireStoryAuthority, seesStorytellerSecrets } from "@/lib/campaign-api";
import { runTurnRevert } from "@/lib/dm/turn-revert-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  turnId: z.string().min(1).max(80),
  confirm: z.boolean().optional(),
});

// Party lead reverts every live sheet change from one DM turn, newest
// first, so each field lands back on its pre-turn value, and puts back what
// the turn changed on the clock (issue #622). It takes back what else the
// turn kept for it (issue 685, src/lib/db/turn-changes.ts): the fight and the
// board as the turn found them (hit points, conditions, creatures it brought
// in, tokens, areas, effects, the order of turns), the creatures it called
// up, a prepared fight's event it fired (armed again), the test dice it
// spent, a card the GM resolved in it, and every other row the turn wrote
// (src/lib/db/turn-journal.ts): the floor and the scene, the party's place,
// an NPC, a bond, a quest, a whisper, a companion who joined or left, a
// disease, the weather. A fight the turn ended is opened again; a turn that
// ended a fight with another on since is refused, saying why (WAVE1
// maintainer decisions on LC-REV-11, LC-REV-12 and LC-REV-13: "a revert takes
// back afflictions, scene trackers, location and party moves, and a turn
// that ended a fight reopens it (or refuses with a sentence saying why it
// cannot, if reopening is unsafe)"). The transcript stays: what was said was
// said.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid revert request." }, { status: 400 });
  }
  const { turnId, confirm } = parsed.data;

  const result = runTurnRevert(context.campaign, context.user.id, turnId, {
    confirm,
    seesSecrets: seesStorytellerSecrets(context),
  });
  if (result.ok) {
    return Response.json(result);
  }
  return "warnings" in result
    ? Response.json({ warnings: result.warnings }, { status: result.status })
    : Response.json({ error: result.error }, { status: result.status });
}
