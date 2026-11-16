import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { publicCampaign } from "@/lib/db/campaigns";
import { campaignCreationRefusal, canCreateCampaigns } from "@/lib/shared-host";
import { createStarterCampaign, starterSeedFor } from "@/lib/starter/one-shot";
import { narrationAvailable, NO_STORYTELLER_MESSAGE, storytellerConfigured } from "@/lib/capabilities";
import { pregenSummaries } from "@/lib/starter/pregens";
import { bookLocaleOf } from "@/lib/rulebook/book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The starter one-shot (src/lib/starter/one-shot.ts): what it is, and the
// heroes that come with it — in the request's language, so the card a
// French reader sees is the table they will get.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const locale = bookLocaleOf(request);
  const seed = starterSeedFor(locale);
  return Response.json({
    oneShot: {
      id: seed.id,
      title: seed.title,
      tagline: seed.tagline,
      description: seed.description,
    },
    pregens: pregenSummaries(locale),
  });
}

const startSchema = z.object({ solo: z.boolean().default(false) });

// One click: the campaign exists, the premise and the DM's outline are
// written, and the lobby offers the heroes.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  if (!canCreateCampaigns(user)) {
    return campaignCreationRefusal();
  }
  const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  // The one-shot is the AI's to run: without a storyteller there is nothing
  // to start (the shells hide Quick start on the same answer, offersStory).
  if (!(await storytellerConfigured())) {
    return Response.json({ error: NO_STORYTELLER_MESSAGE, reason: "no_storyteller" }, { status: 409 });
  }
  // Narration starts on only where the server can read aloud (issue 275).
  // The premise and the DM's spine are written in the creator's language.
  const campaign = createStarterCampaign(user.id, {
    solo: parsed.data.solo,
    narration: await narrationAvailable(),
    locale: bookLocaleOf(request),
  });
  return Response.json({ campaign: publicCampaign(campaign) }, { status: 201 });
}
