// A first-tier mind's own model and reasoning effort (ticket 09,
// docs/tickets/ogm-npc-isolation-design/09-modello-per-personaggio.md): what
// the table's agent program offers to choose from, and the choice checked
// against it. A table whose minds do not run on an agent program offers
// nothing, and its minds run as the table's (src/lib/dm/model.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { mindServerRoute, utilityOnAgent } from "@/lib/dm/model";
import { backendKeyFor } from "@/lib/model-client";
import { listCustomModels, listOllamaModels } from "@/lib/model-registry/discovery";
import type { StorySettings } from "@/lib/types";
import { harnessConfig, probeHarness } from "@/lib/harness/status";
import { isHarnessId } from "@/lib/harness/types";
import { mindModelProblem, type MindModelChoice } from "@/lib/dm/npc-mind-logic";

export type MindModelOffer = {
  models: Array<{ id: string; label: string; efforts: string[] }>;
  // What a blank choice runs on: the table's mind model and effort.
  tableModel: string;
  tableEffort: string;
};

export async function mindModelOffer(campaign: Campaign): Promise<MindModelOffer | null> {
  if (!campaign.gameSettings.npcMinds) {
    return null;
  }
  return utilityOnAgent(campaign.settings) ? agentOffer() : serverOffer(campaign.settings);
}

// A local (Ollama) or custom server's offer: the models it lists, without
// efforts, a blank choice thinking with the table's own mind model.
async function serverOffer(settings: StorySettings): Promise<MindModelOffer | null> {
  const route = await mindServerRoute(settings);
  if (route.provider === "harness") {
    return null;
  }
  const listing =
    route.provider === "local"
      ? await listOllamaModels(route.baseUrl || undefined)
      : await listCustomModels(route.baseUrl, backendKeyFor(route.baseUrl, route.apiKey));
  if (!listing.ok || !listing.models.length) {
    return null;
  }
  return {
    models: listing.models.map((model) => ({ id: model.id, label: model.label || model.id, efforts: [] })),
    tableModel: route.model,
    tableEffort: "",
  };
}

async function agentOffer(): Promise<MindModelOffer | null> {
  const config = harnessConfig();
  if (!isHarnessId(config.id)) {
    return null;
  }
  const status = await probeHarness(config.id).catch(() => null);
  const models = (status?.models ?? [])
    .filter((model) => !model.deprecated)
    .map((model) => ({ id: model.id, label: model.label, efforts: [...(model.efforts ?? [])] }));
  if (!models.length) {
    return null;
  }
  return {
    models,
    tableModel: config.mindModel || config.utilityModel || config.model,
    tableEffort: config.mindEffort || config.utilityEffort || config.effort,
  };
}

// What one mind's call asks for: its own choice, field by field over the
// characters' model and effort the admin set beside the story's. Null runs
// on the bookkeeping route as before. The program's own list is checked as
// the run starts (src/lib/harness/bridge.ts chosenRun).
export function mindCallChoice(settings: StorySettings, own: MindModelChoice | null): MindModelChoice | null {
  // The admin's characters' model is an agent program's; a table on its own
  // server keeps only the companion's own choice.
  const config = utilityOnAgent(settings) ? harnessConfig() : { mindModel: "", mindEffort: "" };
  const model = own?.model || config.mindModel;
  const effort = own?.effort || config.mindEffort;
  return model || effort ? { model, effort } : null;
}

// The refusal for a choice the program does not offer, or null.
export function mindChoiceProblem(offer: MindModelOffer, choice: MindModelChoice): string | null {
  return mindModelProblem(choice, offer.models, offer.tableModel);
}
