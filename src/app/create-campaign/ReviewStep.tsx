"use client";

import type { CSSProperties, ReactNode } from "react";
import { CampaignCover } from "@/components/CampaignCover";
import { StorySetupNotice } from "@/components/StorySetupNotice";
import { useTtsVoices, voiceLabel } from "@/components/VoicePicker";
import { cn } from "@/lib/cn";
import { storySetupWarningComing } from "@/lib/dm/story-setup-logic";
import { DM_MODE_LABELS } from "@/lib/schemas/game-settings-options";
import type { WorldPackSummary } from "@/lib/worlds/types";
import type { StepProps } from "@/app/create-campaign/draft";
import type { GroupId, StepKey } from "@/app/create-campaign/groups";
import { coverSheet } from "@/app/create-campaign/cover-sheet";
import { customRules, narrationSummary, safetySummary } from "@/app/create-campaign/summaries";
import { featuresOn } from "@/app/create-campaign/table-sheet";
import { bringsSomething } from "@/app/workshop/ContentImportPicker";
import { useT } from "@/lib/locale";

export type EditTarget = { step: Exclude<StepKey, "review">; group?: GroupId };

// Step 3: the cover the campaign will wear, assembled from the choices behind
// it, then the read-back. The cover is CampaignCover with no art, the same
// tile the home screen draws until somebody paints one from the lobby. Every
// row has an Edit that opens the place it was set, and the step comes back
// here with nothing lost. The warnings that block creation, and the
// Storyboard one, sit next to the button they concern.
export function ReviewStep({
  draft,
  patch,
  gates,
  active,
  selectedPack,
  prep,
  error,
  followUp = null,
  onEdit,
  defaultsPanel,
}: StepProps & {
  // True while this is the step on screen; the cover assembles on arrival.
  active: boolean;
  selectedPack: WorldPackSummary | null;
  prep: { title: string; arcComing: boolean } | null;
  error: string;
  // The campaign is made and part of what was chosen did not land: what
  // failed, and the way into the campaign as it stands. The wizard's own
  // button says Try again meanwhile and sends only what failed.
  followUp?: { problems: string[]; busy: boolean; onOpen: () => void } | null;
  onEdit: (target: EditTarget) => void;
  defaultsPanel: ReactNode;
}) {
  const { solo, storyKnownMissing } = gates;
  const t = useT();
  const sheet = coverSheet(draft, gates, selectedPack?.name ?? null, t);
  const voices = useTtsVoices();
  const rules = customRules(t, draft);
  const importing = bringsSomething(draft.contentImport);
  const storyboardClash = Boolean(prep?.arcComing && importing && gates.aiNarrates && draft.aiStorySetup && !draft.storySetupKept);
  let index = 0;
  const row = (label: string, value: ReactNode, target: EditTarget, options: { gold?: boolean; wrap?: boolean } = {}) => (
    <Row key={label} label={label} index={index++} gold={options.gold} wrap={options.wrap} onEdit={() => onEdit(target)}>
      {value}
    </Row>
  );

  return (
    <div className={cn("space-y-4 text-sm", active && "cc-live")}>
      <div className="cc-review">
        <div className="cc-cover">
          <div className="cc-cover-art rounded-xl">
            <CampaignCover cover={null} title={sheet.title} genre={draft.genre} />
            <span className="cc-cover-caption">
              <span className="cc-cover-genre">{({ "high_fantasy": t("High fantasy"), "dark_fantasy": t("Dark fantasy"), "mystery": t("Mystery"), "horror": t("Horror"), "cyberpunk": t("Cyberpunk"), "steampunk": t("Steampunk"), "post_apocalyptic": t("Post-apocalyptic"), "custom": t("Custom", { context: "creator.genre.custom" }), "coverAria": t("{name} cover plate"), "humansOnly": t("all-human world") } as Record<string, string>)[draft.genre] ?? String(draft.genre)}</span>
              <span className="cc-cover-title">{sheet.title}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1 px-1 pb-1 pt-2.5">
            <span className="cc-prose text-[12.5px] leading-snug text-stone-300">{sheet.theme}</span>
            <span className="cc-note">{sheet.meta}</span>
          </div>
          <span className="cc-stamp" aria-hidden="true">
            <span className="cc-stamp-top">{sheet.difficulty}</span>
            <span className="cc-stamp-sub">{sheet.stampSub}</span>
          </span>
        </div>

        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-2.5">
          <dl className="cc-readback">
            {row(t("Runs the game"), t(DM_MODE_LABELS[draft.dmMode]), { step: "essentials" }, { gold: true })}
            {row(t("Setting"), sheet.setting, { step: "essentials", group: selectedPack ? "world" : undefined })}
            {row(t("Party"), sheet.party, { step: "essentials" })}
            {row(t("Difficulty"), sheet.difficulty, { step: "essentials" })}
            {row(t("Dice"), sheet.dice, { step: "essentials", group: "character" })}
            {row(
              t("Narration", { context: "creator.review.row.narration" }),
              narrationSummary(t, draft, gates, voiceLabel(voices, draft.ttsVoice)),
              { step: "experience" },
              { wrap: true },
            )}
            {row(t("Safety"), safetySummary(t, draft), { step: "experience", group: "safety" }, { wrap: true })}
            {row(t("Rules"), rules ?? t("The book as written"), { step: "experience", group: "variants" }, { wrap: true })}
            {row(
              t("Prep"),
              importing ? t("From {title}", { title: prep?.title ?? t("a workshop") }) : t("None brought in"),
              { step: "essentials", group: "prep" },
              { wrap: true },
            )}
            {row(t("Table features"), t("{count} on", { count: featuresOn(draft, gates) }), { step: "experience" }, { gold: true })}
          </dl>
          <p className="text-stone-400">{solo ? t("You'll drop into the lobby next to ready up.") : t("You'll drop into the lobby next to share an invite code and ready up.")}</p>
          <div className="flex flex-wrap gap-1.5">
            {[({ "easy": t("Fights lean easy and the story forgives mistakes. Good for a first table."), "normal": t("Encounters built to the book. A careless party can still lose someone."), "hard": t("Bigger fights, fewer second chances, resources that actually run out."), "deadly": t("Assumes you want to lose characters. Plan retreats and bring spares.") } as Record<string, string>)[draft.difficulty] ?? String(draft.difficulty), ...sheet.chips].map((chip, chipIndex) => (
              <span key={chip} className="cc-review-chip" style={{ "--cc-delay": `${420 + chipIndex * 60}ms` } as CSSProperties}>
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>

      {storyboardClash ? (
        <StorySetupNotice
          text={storySetupWarningComing(t)}
          onTurnOff={() => patch({ aiStorySetup: false })}
          onKeep={() => patch({ storySetupKept: true })}
        />
      ) : null}
      {defaultsPanel}
      {solo && storyKnownMissing ? (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-amber-200">{t("A solo adventure needs the AI storyteller, and this server does not have one. Ask the server owner to set up an AI backend first.")}</p>
      ) : null}
      {error ? <p className="motion-shake text-red-400">{error}</p> : null}
      {followUp ? (
        <div role="alert" className="motion-shake space-y-2 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-amber-200">
          <p>{solo ? t("The adventure is made, but part of what you chose for it did not come in:") : t("The campaign is made, but part of what you chose for it did not come in:")}</p>
          <ul className="list-disc space-y-1 pl-5 text-amber-100/90">
            {followUp.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="text-xs text-amber-200/80">{t("Try again sends only what failed. Or open it now and bring the rest in from the lobby: Bring in prep for a workshop, House rules and Lore for what you typed here.")}</p>
          <button type="button" className="cc-link inline-flex min-h-10 items-center" disabled={followUp.busy} onClick={followUp.onOpen}>
            {solo ? t("Open the adventure as it is") : t("Open the campaign as it is")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// The rows cascade in at 70 ms steps once the step is on screen.
function Row({
  label,
  index,
  gold = false,
  wrap = false,
  onEdit,
  children,
}: {
  label: string;
  index: number;
  gold?: boolean;
  wrap?: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="cc-readback-row" data-wrap={wrap || undefined} style={{ "--cc-delay": `${index * 70}ms` } as CSSProperties}>
      <dt>{label}</dt>
      <dd data-ink={gold ? "gold" : undefined}>
        <span className="cc-readback-value">{children}</span>
        <button type="button" className="cc-readback-edit" onClick={onEdit} aria-label={t("Edit {label}", { label: label.toLowerCase() })}>
          {t("Edit")}
        </button>
      </dd>
    </div>
  );
}
