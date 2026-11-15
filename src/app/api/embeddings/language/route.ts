import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { embeddingVerdict } from "@/lib/embedding-language";
import type { EmbeddingLanguageCheck } from "@/lib/embedding-language-logic";
import { TABLE_LANGUAGES } from "@/lib/schemas/game-settings-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whether this server's embedding model reads a table language, for the
// warnings under Table language, above the composer, in the lobby and on the
// admin page (src/lib/embedding-language.ts). It names a language, never a
// campaign, so it says nothing about anyone's table. English is never asked:
// the warning is for tables playing in another language.
const querySchema = z.object({ language: z.enum(TABLE_LANGUAGES).exclude(["english"]) });

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const parsed = querySchema.safeParse({ language: new URL(request.url).searchParams.get("language") });
  if (!parsed.success) {
    return Response.json({ error: "Unknown table language." }, { status: 400 });
  }
  const { language } = parsed.data;
  const check: EmbeddingLanguageCheck = { language, verdict: await embeddingVerdict(language) };
  return Response.json(check);
}
