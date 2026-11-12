import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { capabilitiesSnapshot } from "@/lib/capabilities";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { hostAvailability } from "@/lib/harness/discover";
import { safeNetworkInterfaces } from "@/lib/network-interfaces";
import { lanOrigins, livePublicUrl } from "@/lib/server-address";
import { isDeviceWorld, serverEnv } from "@/lib/server-env";
import { keyForListing, keyProvider, normalizeBaseUrl } from "@/lib/setup/discovery-logic";
import { listModels, scanLocalServices } from "@/lib/setup/discovery";
import { fitListedModels, recommendListed } from "@/lib/model-registry/catalog";
import { getSetupState, markSetup, setupNudgeWanted } from "@/lib/setup/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The guided setup (src/app/setup). Everything it saves goes through
// PATCH /api/admin/settings like the admin panel; this route only answers
// the questions the panel never asked: what is running on this machine,
// which models an address or a key can reach, where players will find the
// server, and whether the admin has been through the wizard.

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol;
  const config = getGlobalConfig();
  const state = getSetupState();
  const deviceWorld = isDeviceWorld();
  const story = (await capabilitiesSnapshot().catch(() => null))?.story;
  const interfaces = safeNetworkInterfaces();
  return Response.json({
    state,
    deviceWorld,
    inContainer: hostAvailability() === "container",
    // The home screen's "finish setting up" card.
    nudge: setupNudgeWanted({
      isAdmin: true,
      deviceWorld,
      state,
      storyWorking: Boolean(story?.configured && story.reachable),
    }),
    lanUrls: lanOrigins(interfaces, protocol, url.port),
    publicUrl: livePublicUrl(config.publicUrl, interfaces),
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("scan") }),
  z.object({
    action: z.literal("models"),
    // Either a known provider (its address is fixed) or a typed address.
    provider: z.enum(["openai", "openrouter", "other"]).optional(),
    baseUrl: z.string().trim().max(500).optional(),
    apiKey: z.string().trim().max(400).optional(),
  }),
]);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Unknown action." }, { status: 400 });
  }
  if (parsed.data.action === "scan") {
    const scan = await scanLocalServices();
    // Each found server's list, kept to the models that can narrate and
    // led by the catalog's pick; no model is named in code.
    return Response.json({
      ...scan,
      text: scan.text.map((server) => {
        const models = fitListedModels(server.baseUrl, server.models);
        return { ...server, models, recommended: recommendListed(server.baseUrl, models) };
      }),
    });
  }
  const { provider, apiKey = "" } = parsed.data;
  const preset = provider ? keyProvider(provider) : null;
  const baseUrl = normalizeBaseUrl(preset?.baseUrl || parsed.data.baseUrl || "");
  // Running the wizard again: the saved key never reaches the page, so a
  // blank key field asks with the saved one, for its own host only.
  const config = getGlobalConfig();
  const key = keyForListing({
    typed: apiKey,
    savedKey: config.text.customApiKey || serverEnv("OPENAI_COMPAT_API_KEY"),
    savedBaseUrl: config.text.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL"),
    baseUrl,
  });
  const listing = await listModels(baseUrl, key);
  if (!listing.ok) {
    return Response.json(listing);
  }
  // The models that can narrate, with the catalog's window and deprecations
  // beside each, led by the catalog's pick.
  const models = fitListedModels(baseUrl, listing.models);
  return Response.json({ ...listing, models, recommended: recommendListed(baseUrl, models) });
}

const markSchema = z.object({ state: z.enum(["finished", "dismissed", "open"]) });

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = markSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Unknown setup state." }, { status: 400 });
  }
  return Response.json({ state: markSetup(parsed.data.state) });
}
