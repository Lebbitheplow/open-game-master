"use client";

import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import type { Genre } from "@/lib/schemas/game-settings";
import type { FranchiseGroup, WorldPackSummary } from "@/lib/worlds/types";
import { WorldSetupFields } from "@/app/WorldSetupFields";
import { ContentImportPicker } from "@/app/workshop/ContentImportPicker";
import { StorySetupNotice } from "@/components/StorySetupNotice";
import { storySetupWarningComing } from "@/lib/dm/story-setup-logic";
import { DetailGroup } from "@/app/create-campaign/fields";
import { DmModeField, TitleField, WorldPackField } from "@/app/create-campaign/IdentityFields";
import { CampaignLengthField, CharacterRulesFields, PartyBasics } from "@/app/create-campaign/PartyFields";
import { SheetRows } from "@/app/create-campaign/SheetRows";
import { WorldDetailsFields, WorldFields } from "@/app/create-campaign/WorldFields";
import type { StepProps } from "@/app/create-campaign/draft";
import { groupProps, type GroupControl } from "@/app/create-campaign/groups";
import { characterSummary, prepSummary, worldSummary } from "@/app/create-campaign/summaries";
import { useT } from "@/lib/locale";

// Step 1, the essentials: a name, who runs the table, how big and how hard,
// and the world with its theme and premise. What a first campaign can leave
// as it is waits in three named groups (world details, character creation,
// house rules and prep), each saying on its closed face what is set inside.
// All of it is asked before the first character is built, which is why none
// of it moved to the lobby.
export function EssentialsStep(
  props: StepProps & {
    active: boolean;
    titleRef: Ref<HTMLInputElement>;
    defaultsBar: ReactNode;
    groups: GroupControl;
    packs: WorldPackSummary[];
    franchises: FranchiseGroup[];
    selectedPack: WorldPackSummary | null;
    prepSource: string | null;
    onChoosePack: (pack: WorldPackSummary) => void;
    onClearPack: () => void;
    onPickGenre: (genre: Genre) => void;
    onPrepChosen: (chosen: { title: string; arcComing: boolean } | null) => void;
  },
) {
  const { draft, patch, gates, active, groups, selectedPack } = props;
  const t = useT();
  return (
    <div className={cn("space-y-4 text-sm", active && "cc-live")}>
      {props.defaultsBar}
      <TitleField draft={draft} patch={patch} inputRef={props.titleRef} />
      <DmModeField draft={draft} patch={patch} gates={gates} />
      <PartyBasics draft={draft} patch={patch} gates={gates} />
      <WorldFields draft={draft} patch={patch} gates={gates} active={active} onPickGenre={props.onPickGenre} />

      <div className="cc-group-head pt-1">
        <span className="cc-eyebrow">{t("More about this campaign")}</span>
        <span className="cc-group-rule" aria-hidden="true" />
        <span className="cc-note">{t("optional")}</span>
      </div>
      <div className="space-y-2">
        <DetailGroup
          {...groupProps(groups, "world")}
          title={t("World and story")}
          glyph="system-world"
          summary={worldSummary(t, draft, gates, selectedPack?.name ?? null)}
        >
          <WorldPackField
            draft={draft}
            packs={props.packs}
            franchises={props.franchises}
            selectedPack={selectedPack}
            onChoosePack={props.onChoosePack}
            onClearPack={props.onClearPack}
          />
          <CampaignLengthField draft={draft} patch={patch} gates={gates} />
          <WorldDetailsFields draft={draft} patch={patch} selectedPack={selectedPack} />
        </DetailGroup>

        <DetailGroup
          {...groupProps(groups, "character")}
          title={t("Character creation")}
          glyph="tab-characters"
          summary={characterSummary(t, draft)}
        >
          <CharacterRulesFields draft={draft} patch={patch} gates={gates} />
          <SheetRows draft={draft} patch={patch} gates={gates} keys={["multiclassingEnabled"]} />
        </DetailGroup>

        <DetailGroup
          {...groupProps(groups, "prep")}
          title={t("House rules, lore and prep")}
          glyph="system-lore"
          summary={prepSummary(t, draft, props.prepSource)}
        >
          <WorldSetupFields
            collapsible={false}
            houseRules={draft.houseRules}
            setHouseRules={(houseRules) => patch({ houseRules })}
            loreDrafts={draft.loreDrafts}
            setLoreDrafts={(loreDrafts) => patch({ loreDrafts })}
          />
          <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3">
            <span className="mb-1.5 block text-stone-400">{t("Bring in prep", { context: "creator.prep.bringIn" })}</span>
            <ContentImportPicker
              selection={draft.contentImport}
              onChange={(contentImport) => patch({ contentImport })}
              onChosen={props.onPrepChosen}
              // A Storyboard that writes the arc, at a table the AI will set
              // up (issue 249): say so before the campaign is made.
              storyboardNote={(arcComing) =>
                arcComing && gates.aiNarrates && draft.aiStorySetup && !draft.storySetupKept ? (
                  <StorySetupNotice
                    text={storySetupWarningComing(t)}
                    onTurnOff={() => patch({ aiStorySetup: false })}
                    onKeep={() => patch({ storySetupKept: true })}
                  />
                ) : null
              }
            />
          </div>
        </DetailGroup>
      </div>
    </div>
  );
}
