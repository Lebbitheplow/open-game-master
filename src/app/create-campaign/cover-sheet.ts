import { genrePreset } from "@/lib/genres";
import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";
import { pluralOf, translate } from "@/lib/messages-logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// The review step's pure half: every line on the cover and in the read-back,
// worked out from the draft. Nothing here is a constant standing in for a
// choice, which is what scripts/test-world-portals.mjs checks.

// An AI narrator plans the arc, so only then is its length a fact worth a
// stamp. The wording matches LENGTH_INFO on the party step.
const LENGTH_SHORT: Record<CampaignDraft["campaignLength"], string> = {
  short: "3 acts",
  standard: "4-5 acts",
  epic: "6-8 acts",
};

const LENGTH_LABEL: Record<CampaignDraft["campaignLength"], string> = {
  short: "short",
  standard: "standard",
  epic: "epic",
};

export type CoverSheet = {
  title: string;
  theme: string;
  meta: string;
  difficulty: string;
  stampSub: string;
  setting: string;
  party: string;
  dice: string;
  chips: string[];
};

export function coverSheet(
  draft: CampaignDraft,
  gates: Pick<WizardGates, "solo" | "aiNarrates">,
  packName: string | null,
  t: T = enT,
): CoverSheet {
  const { solo, aiNarrates } = gates;
  const tp = pluralOf(t);
  const preset = genrePreset(draft.genre);
  const genreName = preset.name ? t(preset.name) : draft.genre;
  const playersWord = solo ? t("Solo") : tp("{count} player", "{count} players", { count: draft.maxPlayers });
  const levelWord = t("level {level}", { level: draft.startingLevel });
  const party = `${playersWord} · ${levelWord}`;
  const dice = draft.dicePolicy === "digital_only" ? t("Digital only") : t("Real dice allowed");
  const chips = [t("{climate} sky", { climate: t(preset.climate) })];
  if (aiNarrates) {
    chips.push(`${t(LENGTH_LABEL[draft.campaignLength])} · ${t(LENGTH_SHORT[draft.campaignLength])}`);
  }
  return {
    // The wizard will not reach this step without a title; the fallback is
    // for the cover that is mounted, off screen, before one is typed.
    title: draft.title.trim() || (solo ? t("Untitled adventure") : t("Untitled campaign")),
    theme: draft.theme.trim() || t("A world of your own description."),
    meta: `${party.toLowerCase()} · ${draft.dicePolicy === "digital_only" ? t("digital dice") : t("real dice allowed")}`,
    difficulty: t(draft.difficulty.charAt(0).toUpperCase() + draft.difficulty.slice(1)),
    stampSub: aiNarrates ? t(LENGTH_SHORT[draft.campaignLength]) : levelWord,
    setting: packName ? `${packName} (${genreName})` : genreName,
    party,
    dice,
    chips,
  };
}
