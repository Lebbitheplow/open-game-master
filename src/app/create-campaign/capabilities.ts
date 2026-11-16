import type { CampaignDraft } from "@/app/create-campaign/draft";
import type { TableLanguage } from "@/lib/schemas/game-settings-options";

// The slice of /api/capabilities this dialog gates on. null means the
// endpoint never answered, and the dialog assumes everything is available:
// a flaky capability check must never block creating a campaign.
export type ServerCapabilities = {
  story: { configured: boolean; reachable: boolean };
  images: { configured: boolean };
  tts: { configured: boolean; provider?: string };
  // The server's language; absent on an older host.
  language?: TableLanguage;
};

// What the server cannot do right now, laid over a draft: a missing or
// silent storyteller puts a person in the seat, and a server with no speech
// service reads nothing aloud. Maps are the exception: they wait for a
// picture backend instead of being switched off for good, since a server set
// up in the usual order (storyteller first, pictures later) would otherwise
// make every early campaign map-less and keep it so after pictures arrive
// (src/lib/image-backend-rescue.ts). What the person wanted is returned
// beside it, so saving defaults during an outage saves their choice, not the
// outage.
export function withCapabilities(draft: CampaignDraft, data: ServerCapabilities) {
  const wanted: Partial<Pick<CampaignDraft, "dmMode" | "ttsEnabled">> = {};
  let next = draft;
  if ((!data.story.configured || !data.story.reachable) && draft.dmMode !== "human") {
    wanted.dmMode = draft.dmMode;
    next = { ...next, dmMode: "human" };
  }
  if (!data.tts?.configured && draft.ttsEnabled) {
    wanted.ttsEnabled = true;
    next = { ...next, ttsEnabled: false };
  }
  return { draft: next, wanted };
}
