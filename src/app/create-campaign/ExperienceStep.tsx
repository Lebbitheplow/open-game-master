"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { InfoButton } from "@/components/ui/InfoDialog";
import { replayAnimation } from "@/lib/motion/replay";
import { VARIANT_TOGGLES, VariantRulesFields, REST_LABELS } from "@/app/campaigns/[campaignId]/RulesPanel";
import { DetailGroup } from "@/app/create-campaign/fields";
import { AlliesFields, NarrationFields } from "@/app/create-campaign/NarratorFields";
import { SafetyFields } from "@/app/create-campaign/SafetyFields";
import { SheetRows } from "@/app/create-campaign/SheetRows";
import { VoiceChatFields } from "@/app/create-campaign/VoiceChatFields";
import type { StepProps } from "@/app/create-campaign/draft";
import { groupProps, type GroupControl } from "@/app/create-campaign/groups";
import {
  aiSummary,
  boardSummary,
  bondsSummary,
  playersSummary,
  safetySummary,
  variantSummary,
  voiceChatSummary,
} from "@/app/create-campaign/summaries";
import { countableRows, featuresOn } from "@/app/create-campaign/table-sheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { CampaignDraft } from "@/app/create-campaign/draft";
import { useT } from "@/lib/locale";

// The switches only describe themselves on hover, which a finger never
// makes; this is the same text, reachable by tap and keyboard.
const VARIANT_INFO = `${VARIANT_TOGGLES.map((toggle) => `**${toggle.label}**: ${toggle.tip}`).join("\n\n")}\n\n**Rest lengths**: ${Object.values(REST_LABELS).join("; ")}.`;

// Step 2, the experience: first how the table sounds (narration and who
// voices the characters, side by side), then its atmosphere and a safety
// entry nobody has to hunt for. Everything else waits in named groups, each
// saying on its closed face what it holds. The running total is the old
// table sheet's: the same rows, counted the same way.
export function ExperienceStep(props: StepProps & { active: boolean; groups: GroupControl }) {
  const { draft, gates, active, groups } = props;
  const t = useT();
  const counter = useRef<HTMLSpanElement>(null);
  // The total answers every press, including one that does not move it.
  const onFlip = () => replayAnimation(counter.current, "cc-count-pop var(--dur-beat) var(--ease-spring)");
  const rows = { ...props, onFlip };
  return (
    <div className={cn("space-y-4 text-sm", active && "cc-live")}>
      {/* What each group holds leads; the count is a quiet aside, since
          switching more on is not a goal (a gold dot marks a counted one). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="cc-note min-w-0 flex-1 basis-48 leading-relaxed">{t("Every group below is optional and says what is set inside. Leave any of them as they are; all of it can be changed in the lobby or during play.")}</p>
        <span className="cc-note shrink-0" aria-live="polite">
          <span ref={counter} className="inline-block font-semibold text-amber-200">
            {featuresOn(draft, gates)}
          </span>{" "}
          {t("of {total} switches on", { total: countableRows(gates) })}
        </span>
      </div>

      <section className="cc-field" aria-labelledby="cc-voices-head">
        <div className="cc-field-head">
          <span id="cc-voices-head" className="cc-eyebrow">
            {t("Narration and character voices")}
          </span>
          <span className="cc-note">{t("read aloud by this server")}</span>
        </div>
        <NarrationFields {...rows} />
      </section>

      <section>
        <div className="cc-group-head">
          <span className="cc-eyebrow">{t("Atmosphere")}</span>
          <span className="cc-group-rule" aria-hidden="true" />
        </div>
        <SheetRows {...rows} keys={["mapsEnabled", "ambienceEnabled", "ambienceAuto", "presentation"]} />
      </section>

      <DetailGroup {...groupProps(groups, "safety")} title={t("Safety and boundaries")} glyph="ui-lock" summary={safetySummary(t, draft)}>
        <SafetyFields {...props} />
      </DetailGroup>

      <div className="cc-group-head pt-1">
        <span className="cc-eyebrow">{t("More ways to tailor the table")}</span>
        <span className="cc-group-rule" aria-hidden="true" />
        <span className="cc-note">{t("optional")}</span>
      </div>
      <div className="space-y-2">
        {gates.aiNarrates ? (
          <DetailGroup {...groupProps(groups, "ai")} title={t("AI storytelling and allies")} glyph="ui-ai" summary={aiSummary(t, draft)}>
            <SheetRows {...rows} keys={["aiStorySetup", "narrationGuard", "worldSimulation"]} />
            <AlliesFields {...props} />
          </DetailGroup>
        ) : null}
        <DetailGroup {...groupProps(groups, "bonds")} title={t("Bonds and romance")} glyph="tab-bonds" summary={bondsSummary(t, draft)}>
          <SheetRows {...rows} keys={["relationships", "romance"]} />
        </DetailGroup>
        <DetailGroup
          {...groupProps(groups, "players")}
          title={t("Players and permissions")}
          glyph="tab-party"
          summary={playersSummary(t, draft, gates)}
        >
          <MultiCharacterField draft={draft} patch={props.patch} />
          <SheetRows {...rows} keys={["midGameJoinOpen", "holdSubmissions", "inventoryApprovals", "vitalsApprovals"]} />
        </DetailGroup>
        <DetailGroup {...groupProps(groups, "board")} title={t("The battle board")} glyph="tab-battle" summary={boardSummary(t, draft)}>
          <SheetRows {...rows} keys={["boardDrawing", "enemyIntent"]} />
        </DetailGroup>
        <DetailGroup {...groupProps(groups, "variants")} title={t("Variant rules")} glyph="system-rules" summary={variantSummary(t, draft)}>
          <p className="flex items-center gap-1 text-xs text-stone-500">
            {t("Optional rules from the 5e books, each off unless you turn it on.")}
            <InfoButton label={t("Variant rules")} text={VARIANT_INFO} />
          </p>
          <VariantRulesFields value={draft.variantRules} onChange={(variantRules) => props.patch({ variantRules })} />
        </DetailGroup>
        {/* A solo table has nobody to talk to. Live voice chat is people
            talking to each other, not the narration above. */}
        {!gates.solo ? (
          <DetailGroup {...groupProps(groups, "voiceChat")} title={t("Live voice chat", { context: "creator.group.voiceChat" })} glyph="ui-voice" summary={voiceChatSummary(t, draft)}>
            <VoiceChatFields value={draft.voiceChat} onChange={(voiceChat) => props.patch({ voiceChat })} />
          </DetailGroup>
        ) : null}
      </div>
    </div>
  );
}

// Characters per player, as its three answers side by side rather than a
// switch that cycles through them.
const MULTI_HINT_KEYS: Record<CampaignDraft["multiCharacter"], string> = {
  off: "Each player brings one character.",
  one_active: "A player may build several and plays one at a time; the others wait out fights.",
  all_active: "A player fields all of theirs at once, usually one person running a whole party at a solo table.",
};

function MultiCharacterField({ draft, patch }: Pick<StepProps, "draft" | "patch">) {
  const t = useT();
  return (
    <div data-sheet-row="multiCharacter">
      <span className="mb-1 block text-xs text-stone-400">{t("Characters per player")}</span>
      <SegmentedControl<CampaignDraft["multiCharacter"]>
        size="sm"
        label={t("Characters per player")}
        value={draft.multiCharacter}
        onChange={(multiCharacter) => patch({ multiCharacter })}
        options={[
          { value: "off", label: t("One each") },
          { value: "one_active", label: t("Several, one at a time") },
          { value: "all_active", label: t("Several, all at once") },
        ]}
      />
      <p key={draft.multiCharacter} className="live-in mt-1 text-[11px] text-stone-500">
        {t(MULTI_HINT_KEYS[draft.multiCharacter])}
      </p>
    </div>
  );
}
