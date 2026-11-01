import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { consoleAdjudications } from "@/lib/dm/invoke-catalog";
import { invokeEngine } from "@/lib/dm/invoke";
import { agentTurnBegunBefore, agentTurnFor, isAgentRequest, recordAgentCall } from "@/lib/dm/agent-turn";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { enemyCallRefusal } from "@/lib/workshop/test-seats-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human DM's hands on the rules engine. Every action here is one the AI
// DM can also take, dispatched to the same handler by the same façade
// (src/lib/dm/invoke.ts), so the rules are enforced identically no matter
// who is running the table.

// GET returns the catalog the console renders itself from, so a tool added
// to the engine shows up as a form without any UI change.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ groups: consoleAdjudications() });
}

// What the console runs through a break, which holds play and leaves the
// rest open (table-break-logic.ts): correcting the record (as the correction
// route itself does, /sheets/[sheetId]), looking things up, a private word,
// and prep (the world's people, quests, factions, places, shops, pictures and
// music) that moves no turn, rolls no die for anyone and changes no sheet.
// Everything else here is play and waits for Resume.
const BREAK_OPEN = new Set([
  "update_sheet",
  "recall_story",
  "search_lore",
  "read_card",
  "send_whisper",
  "write_campaign_note",
  "faction_note",
  "set_npc",
  "set_quest",
  "generate_settlement",
  "open_shop",
  "generate_image",
  "set_ambience",
  "dismiss_handout",
]);

const invokeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  args: z.record(z.string(), z.unknown()).default({}),
  // A card of the monsters' Hand (MonsterHand.tsx), not the console's form:
  // the same call, which a table the AI runs takes from the form only.
  hand: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const parsed = invokeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick an action to run." }, { status: 400 });
  }

  // A table break holds the DM's hands as it holds the storyteller's turn
  // (table audit 2026-10-26, T05): each adjudication here is one the AI
  // makes on a turn, and that turn waits at the DM queue's gate until
  // Resume. A correction, a lookup, a whisper or prep goes on. An agent
  // program's turn already running when the break began finishes, as the
  // storyteller's does. Asked before agentTurnFor, which would open a turn.
  const agentCall = isAgentRequest(request);
  const paused = BREAK_OPEN.has(parsed.data.name) && !agentCall
    ? null
    : refuseDuringBreak(campaignId, agentCall ? (tableBreak) => agentTurnBegunBefore(campaignId, tableBreak.at) : undefined);
  if (paused) {
    return paused;
  }
  // At a test fight the AI GM runs, the author holds the console beside it
  // (issue 685): set-ups and corrections go through, and an enemy's own
  // attack, action or ability is refused, so the author and the AI never
  // both play the same monster. The monsters' Hand is these same calls. At a
  // live table the AI runs with a person steering, the console's forms stay
  // the steering seat's to correct with, and a monsters' Hand card is
  // refused the same way: the AI's turn plays those creatures.
  const { hand, ...call } = parsed.data;
  const foes = agentCall ? null : enemyCallRefusal(campaign, call.name, call.args, { hand });
  if (foes) {
    return Response.json({ error: foes }, { status: 409 });
  }
  // A connected agent program gets the AI's rails, not the console's
  // correction power (src/lib/dm/agent-turn.ts).
  const agent = agentCall ? agentTurnFor(campaignId) : null;
  const outcome = await invokeEngine(
    campaign,
    agent ? { kind: "ai", turnId: agent.id } : { kind: "human", userId: user.id },
    call,
  );
  if (agent) {
    recordAgentCall(agent.id, parsed.data.name, parsed.data.args, outcome.ok ? outcome.result : { error: outcome.error });
  }
  if (!outcome.ok) {
    // A refusal from the engine is the rules talking, not a broken request:
    // 409 so the console shows it as an answer rather than a failure.
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ result: outcome.result });
}
