"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ui } from "@/lib/ui";
import { use } from "react";
import { BattleMapPanel } from "@/app/campaigns/[campaignId]/BattleMapPanel";
import { MapPanel } from "@/app/campaigns/[campaignId]/MapPanel";
import { useCampaignStream } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { HandoutStage } from "@/components/HandoutStage";
import { SceneTitle } from "@/components/SceneTitle";
import { useCoversBackdrop } from "@/lib/backdrop-cover";

// The table view (docs/vtt-parity-implementation-plan.md 13.2): the player
// projection of the board, the scene art, the sky and the current title
// card with no chrome at all, for a television at an in-person table. It
// reads the same stream as any member's browser, so it can never show a
// thing the server withheld from a player. The one piece of chrome is a
// faint corner X back to the table, because a screen opened full-screen or
// as an installed app has no other way out.
export default function TablePage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = use(params);
  const { state, refreshBattleMap, markFxPlayed, markCameraDone, markTitleCardShown } = useCampaignStream(campaignId);
  // The view fills the window once it is up, and the layout's backdrop rests
  // behind it (src/lib/backdrop-cover.ts); its loading and error states do not.
  useCoversBackdrop(!state.loading && !state.error && Boolean(state.campaign) && Boolean(state.me));

  if (state.loading) {
    return (
      <PageSkeleton kind="table" />
    );
  }
  if (state.error || !state.campaign || !state.me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950">
        <EmptyState
          art="map"
          title={state.error || "Sign in as a member of this table to show it."}
          action={
            <Link href="/" className={ui.btnSecondary}>
              Back to campaigns
            </Link>
          }
        />
      </main>
    );
  }
  return (
    <main className="fixed inset-0 overflow-hidden bg-stone-950">
      <div className="absolute inset-0 flex items-center justify-center p-2">
        {state.battleMap ? (
          <div className="board-fill h-full w-full [&_*]:!cursor-default">
            <BattleMapPanel
              campaignId={campaignId}
              view={state.battleMap}
              intents={state.battleMap.intents}
              genre={state.campaign.gameSettings?.genre ?? null}
              encounter={state.encounter ?? null}
              sheets={state.sheets}
              refreshBattleMap={refreshBattleMap}
              canDirect={false}
              canFocusPing={false}
              ping={state.mapPing ?? null}
              fx={state.fx}
              onFxPlayed={markFxPlayed}
              camera={state.camera ?? null}
              onCameraDone={markCameraDone}
              sky={state.scene ?? null}
              canDraw={false}
            />
          </div>
        ) : (
          <div className="w-full max-w-5xl">
            <MapPanel campaignId={campaignId} locations={state.locations} steersStory={false} mediaStatus={state.mediaStatus} genre={state.campaign.gameSettings?.genre} scene={state.scene ?? null} />
          </div>
        )}
      </div>
      <Link
        href={`/campaigns/${campaignId}`}
        aria-label="Back to the table"
        className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-md border border-stone-700 bg-stone-950/80 p-2 text-stone-300 opacity-30 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-4" />
      </Link>
      <SceneTitle card={state.titleCard} onShown={markTitleCardShown} />
      <HandoutStage campaignId={campaignId} handout={state.handout} userId={state.me.id} steersStory={false} canTakeDown={false} onDismiss={async () => {}} />
    </main>
  );
}
