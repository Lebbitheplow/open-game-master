import { z } from "zod";
import { waitForQuestions } from "@/lib/dm/mind-seat-relay";
import { requireSeatHolder } from "@/lib/mind-seat-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ wait: z.coerce.number().int().min(0).max(25).default(0) });

// The questions waiting on the caller's minds, waiting up to `wait` seconds
// for one to arrive.
export async function GET(request: Request) {
  const user = await requireSeatHolder();
  if (user instanceof Response) {
    return user;
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "wait is a number of seconds from 0 to 25." }, { status: 400 });
  }
  const questions = await waitForQuestions(user.id, parsed.data.wait * 1000);
  return Response.json({ questions });
}
