import { z } from "zod";
import { answerQuestion } from "@/lib/dm/mind-seat-relay";
import { requireSeatHolder } from "@/lib/mind-seat-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  requestId: z.string().trim().min(1).max(100),
  speech: z.string().max(2000).default(""),
  intent: z.string().max(2000).default(""),
  conclusion: z.string().max(2000).default(""),
  lie: z.boolean().default(false),
});

// A mind's answer from its seat. The story's checks (names the character
// never learned, and the rules) apply to it as to any mind's.
export async function POST(request: Request) {
  const user = await requireSeatHolder();
  if (user instanceof Response) {
    return user;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Send requestId with speech and/or intent." }, { status: 400 });
  }
  const { requestId, ...answer } = parsed.data;
  if (!answer.speech.trim() && !answer.intent.trim()) {
    return Response.json({ error: "Say something (speech) or do something (intent).", retry: true }, { status: 400 });
  }
  if (!answerQuestion(user.id, requestId, answer)) {
    return Response.json({ error: "That question is no longer waiting: it was answered, or the server's mind answered it after the wait ran out.", refused: "rules" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
