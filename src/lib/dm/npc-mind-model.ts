// A first-tier mind's own model and reasoning effort (ticket 09,
// docs/tickets/ogm-npc-isolation-design/09-modello-per-personaggio.md): what
// the table's agent program offers to choose from, and the choice checked
// against it. A table whose minds do not run on an agent program offers
// nothing, and its minds run as the table's (src/lib/dm/model.ts).
import type { Campaign } from "@/lib/db/campaigns";
import { utilityOnAgent } from "@/lib/dm/model";
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
  const config = harnessConfig();
  if (!campaign.gameSettings.npcMinds || !utilityOnAgent(campaign.settings) || !isHarnessId(config.id)) {
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
    tableModel: config.utilityModel || config.model,
    tableEffort: config.utilityEffort || config.effort,
  };
}

// The refusal for a choice the program does not offer, or null.
export function mindChoiceProblem(offer: MindModelOffer, choice: MindModelChoice): string | null {
  return mindModelProblem(choice, offer.models, offer.tableModel);
}
