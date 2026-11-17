"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  REROLL_LOW_DEFAULT,
  describeRerollT,
  rerollBelowFor,
  rerollChoiceOf,
  type RerollChoice,
} from "@/lib/srd/ability-rerolls";
import { useServerRerollBelow } from "@/app/characters/builder/useTableRules";
import {
  CAMPAIGN_DIFFICULTIES,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  HP_METHOD_LABELS,
  HP_METHODS,
  STARTING_WEALTH,
  STARTING_WEALTH_LABELS,
  type CampaignLengthSetting,
  type HpMethodSetting,
  type StartingWealthSetting,
} from "@/lib/schemas/game-settings-options";
import { FieldLabel, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useT } from "@/lib/locale";

// How many, how strong, how hard. A solo table has no player count
// (maxPlayers is pinned to 1 in the payload, from the solo entry point, never
// from the count chosen here).
export function PartyBasics({ draft, patch, gates }: StepProps) {
  const t = useT();
  const { solo } = gates;
  return (
    <div className={cn("grid gap-3", solo ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {!solo ? (
        <div className="block">
          <FieldLabel>{t("Players")}</FieldLabel>
          <NumberStepper min={1} max={8} value={draft.maxPlayers} onChange={(maxPlayers) => patch({ maxPlayers })} label={t("Players")} />
        </div>
      ) : null}
      <div className="block">
        <FieldLabel>{t("Start level")}</FieldLabel>
        <NumberStepper min={1} max={20} value={draft.startingLevel} onChange={(startingLevel) => patch({ startingLevel })} label={t("Start level")} />
      </div>
      <label className={cn("block", !solo && "col-span-2 sm:col-span-1")}>
        <FieldLabel>
          <span className="flex items-center gap-1">
            {t("Difficulty")}
            <InfoButton label={t("Difficulty")} text={t("Difficulty is guidance to the Game Master, not a damage multiplier: every rule underneath stays 5e. It steers how hard encounters are built and how often a bad roll is allowed to really cost you.\n\n{list}\n\nThe party lead can change it later from the table's settings.", { list: difficultyList(t) })} />
          </span>
        </FieldLabel>
        <Select<CampaignDifficulty>
          value={draft.difficulty}
          onChange={(difficulty) => patch({ difficulty })}
          label={t("Difficulty")}
          className="w-full"
          options={CAMPAIGN_DIFFICULTIES.map((value) => ({ value, label: ({ "easy": t("easy"), "normal": t("normal"), "hard": t("hard"), "deadly": t("deadly"), "info": t("Difficulty is guidance to the Game Master, not a damage multiplier: every rule underneath stays 5e. It steers how hard encounters are built and how often a bad roll is allowed to really cost you.\n\n{list}\n\nThe party lead can change it later from the table's settings.") } as Record<string, string>)[value] ?? String(value) }))}
        />
        {/* The chosen tier says what it means without opening anything. */}
        <p className="mt-1 text-xs text-stone-500">{({ "easy": t("Fights lean easy and the story forgives mistakes. Good for a first table."), "normal": t("Encounters built to the book. A careless party can still lose someone."), "hard": t("Bigger fights, fewer second chances, resources that actually run out."), "deadly": t("Assumes you want to lose characters. Plan retreats and bring spares.") } as Record<string, string>)[draft.difficulty] ?? String(draft.difficulty)}</p>
      </label>
    </div>
  );
}

// The difficulty dialog's middle block: one line per tier, from the data
// file's own hints (the tiers' words stay the data's).
const difficultyList = (t: (key: string) => string) =>
  CAMPAIGN_DIFFICULTIES.map((value) => `**${({ "easy": t("easy"), "normal": t("normal"), "hard": t("hard"), "deadly": t("deadly"), "info": t("Difficulty is guidance to the Game Master, not a damage multiplier: every rule underneath stays 5e. It steers how hard encounters are built and how often a bad roll is allowed to really cost you.\n\n{list}\n\nThe party lead can change it later from the table's settings.") } as Record<string, string>)[value] ?? String(value)}**: ${({ "easy": t("Fights lean easy and the story forgives mistakes. Good for a first table."), "normal": t("Encounters built to the book. A careless party can still lose someone."), "hard": t("Bigger fights, fewer second chances, resources that actually run out."), "deadly": t("Assumes you want to lose characters. Plan retreats and bring spares.") } as Record<string, string>)[value] ?? String(value)}`).join("\n\n");

// How heroes are built here. Asked at creation because the first characters
// are built before anyone opens the lobby's settings.
export function CharacterRulesFields({ draft, patch, gates }: StepProps) {
  const t = useT();
  // Named in the "follow the server" choice, so it says what it means.
  const serverRerollBelow = useServerRerollBelow();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>{t("Hit points per level")}</FieldLabel>
          <Select<HpMethodSetting>
            value={draft.hpMethod}
            onChange={(hpMethod) => patch({ hpMethod })}
            label={t("Hit points per level")}
            className="w-full"
            options={HP_METHODS.map((value) => ({ value, label: t(HP_METHOD_LABELS[value]) }))}
          />
          <p className="mt-1 text-xs text-stone-500">{t("1st level is always the hit die's highest face plus Constitution.")}</p>
        </label>
        <label className="block">
          <FieldLabel>{t("Starting wealth")}</FieldLabel>
          <Select<StartingWealthSetting>
            value={draft.startingWealth}
            onChange={(startingWealth) => patch({ startingWealth })}
            label={t("Starting wealth")}
            className="w-full"
            options={STARTING_WEALTH.map((value) => ({ value, label: t(STARTING_WEALTH_LABELS[value]) }))}
          />
          <p className="mt-1 text-xs text-stone-500">{t("What a new hero starts with; rolled gold is thrown by the server.")}</p>
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>{t("Rolled stats")}</FieldLabel>
          <Select<"server" | RerollChoice>
            value={draft.abilityRerollBelow === null ? "server" : rerollChoiceOf(draft.abilityRerollBelow)}
            onChange={(choice) =>
              patch({
                abilityRerollBelow:
                  choice === "server" ? null : rerollBelowFor(choice, draft.abilityRerollBelow ?? REROLL_LOW_DEFAULT),
              })
            }
            label={t("Rolled stats")}
            className="w-full"
            options={[
              {
                value: "server",
                label:
                  serverRerollBelow === null
                    ? t("Follow the server's reroll rule")
                    : t("Follow the server's reroll rule ({rule})", { rule: describeRerollT(t, serverRerollBelow).toLowerCase() }),
              },
              { value: "keep", label: t("The first roll stands", { context: "creator.reroll.keep" }) },
              { value: "low", label: t("Reroll a roll totalling under {total}", { total: REROLL_LOW_DEFAULT }) },
              { value: "free", label: t("Reroll as often as you like") },
            ]}
          />
          <p className="mt-1 text-xs text-stone-500">{t("For 4d6 ability scores rolled here: whether a player may throw the six again. The server rolls them either way. Following the server, a player's six here are the ones from their library; a rule of the table's own gives each player a separate six here.")}</p>
        </label>
      </div>
      <DicePolicyField draft={draft} patch={patch} gates={gates} />
    </div>
  );
}

export function DicePolicyField({ draft, patch, gates }: StepProps) {
  const t = useT();
  return (
    <div>
      <FieldLabel className="mb-1.5">{t("Dice")}</FieldLabel>
      <div className="flex gap-2">
        <ToggleCard
          active={draft.dicePolicy === "digital_only"}
          onClick={() => patch({ dicePolicy: "digital_only" })}
          label={t("Digital only")}
          hint={t("The server rolls everything")}
        />
        <ToggleCard
          active={draft.dicePolicy === "real_allowed"}
          onClick={() => patch({ dicePolicy: "real_allowed" })}
          label={t("Real dice allowed")}
          hint={gates.solo ? t("Roll at your desk and enter the numbers") : t("Players may opt in to rolling at the table")}
        />
      </div>
    </div>
  );
}

// Only an AI narrator plans a story arc, so only then is its length asked.
export function CampaignLengthField({ draft, patch, gates }: StepProps) {
  const t = useT();
  if (!gates.aiNarrates) {
    return null;
  }
  return (
    <label className="block">
      <FieldLabel>
        <span className="flex items-center gap-1">
          {t("Campaign length")}
          <InfoButton label={t("Campaign length")} text={t("How far ahead the GM plans the secret story: how many acts the arc spans, and how many villains and threads it seeds at the start.\n\n**Short**: three acts, one focused adventure. A handful of sessions.\n\n**Standard**: four or five acts. The default shape of a campaign.\n\n**Epic**: six to eight acts, several threads running at once.\n\nNo length ever cuts you off. Play past the finale and a sequel saga picks up where the last one ended")} />
        </span>
      </FieldLabel>
      <Select<CampaignLengthSetting>
        value={draft.campaignLength}
        onChange={(campaignLength) => patch({ campaignLength })}
        label={t("Campaign length")}
        className="w-full"
        options={CAMPAIGN_LENGTHS.map((value) => ({ value, label: t(CAMPAIGN_LENGTH_LABELS[value]) }))}
      />
      <p className="mt-1 text-xs text-stone-500">{t("How far the GM plans the story ahead. Any length keeps going if you play past the finale: a sequel saga picks up where the last one ended.")}</p>
    </label>
  );
}
