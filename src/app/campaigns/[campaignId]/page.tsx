"use client";

import Link from "next/link";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ui } from "@/lib/ui";

import { useSearchParams } from "next/navigation";
import { Suspense, lazy, use, useCallback, useEffect, type ComponentProps } from "react";
import { useCampaignStream, type CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { ContentScopeProvider } from "@/lib/content-scope";
import { useCoversBackdrop } from "@/lib/backdrop-cover";
import { pushView, replaceView } from "@/lib/navigation";
import { installPageErrorRecorder } from "@/lib/page-errors";
import { noteTableLanguage } from "@/lib/dictation-language";

// The lobby and the table are separate downloads: a table in play never
// needs the lobby's character builder, and a lobby never needs the board,
// the composer or the side panels. The table, where nearly every visit
// lands, starts loading the moment this page mounts, alongside the
// snapshot; a lobby loads once the snapshot says that is where the campaign
// is. Either shows behind the same table skeleton as the snapshot.
const loadLobby = () => import("@/app/campaigns/[campaignId]/Lobby");
const loadSessionView = () => import("@/app/campaigns/[campaignId]/SessionView");
const Lobby = lazy(() => loadLobby().then((module) => ({ default: module.Lobby })));
const SessionView = lazy(() => loadSessionView().then((module) => ({ default: module.SessionView })));

export default function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const {
    state,
    refresh,
    refreshNotes,
    refreshSideChat,
    refreshWhispers,
    refreshAsks,
    refreshFacts,
    refreshBattleMap,
    markFxPlayed,
    markCameraDone,
    markTitleCardShown,
    playSting,
  } = useCampaignStream(campaignId);

  useEffect(() => {
    void loadSessionView();
  }, []);
  // A running campaign whose prep this viewer may open (issue 530) has the
  // lobby's panels ready before they are asked for: once the table is drawn
  // and the browser has a moment, not beside the table's own download. The
  // lobby brings the character builder with it, and fetched at once it made
  // whoever steers the story wait on it before their table could be used.
  const mayPrep = state.campaign?.status === "active" && Boolean(state.caps?.steersStory);
  useEffect(() => {
    if (!mayPrep) return;
    const preload = () => void loadLobby();
    const idle = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(preload, { timeout: 5000 })
      : window.setTimeout(preload, 2500);
    return () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle as number);
      window.clearTimeout(idle as number);
    };
  }, [mayPrep]);

  // The admin's browser keeps the game page's own errors for "Report a
  // problem" (issue #459, src/lib/page-errors.ts); nobody else can save a
  // report, so nobody else's browser keeps them.
  const recordErrors = Boolean(state.me?.isAdmin);
  useEffect(() => (recordErrors ? installPageErrorRecorder() : undefined), [recordErrors]);

  // The phone's own recognizer hears a take in the table's language.
  const tableLanguage = state.campaign?.gameSettings.tableLanguage;
  useEffect(() => {
    if (tableLanguage) noteTableLanguage(campaignId, tableLanguage);
  }, [campaignId, tableLanguage]);

  if (state.loading) {
    return (
      <PageSkeleton kind="table" />
    );
  }

  if (state.error || !state.campaign || !state.me) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <EmptyState
          art="map"
          title={state.error || "Campaign not found."}
          hint={state.answeredBy ? `Answered by ${state.answeredBy}` : undefined}
          action={
            <Link href="/" className={ui.btnSecondary}>
              Back to campaigns
            </Link>
          }
        />
      </main>
    );
  }

  // Every content request made at this table is its own (src/lib/content-scope.tsx).
  return (
    <ContentScopeProvider campaignId={campaignId}>
      <Suspense fallback={<PageSkeleton kind="table" />}>
        <CampaignScreen
          state={state}
          refresh={refresh}
          table={{
            refreshNotes,
            refreshFacts,
            refreshSideChat,
            refreshWhispers,
            refreshAsks,
            refreshBattleMap,
            markFxPlayed,
            markCameraDone,
            markTitleCardShown,
            playSting,
          }}
        />
      </Suspense>
    </ContentScopeProvider>
  );
}

type TableHandlers = Omit<ComponentProps<typeof SessionView>, "state" | "prep">;

// The lobby before the adventure opens; the table once it has. A running
// campaign also has its prep (issue 530): whoever steers the story steps out
// of play to the lobby's panels (the party, rules, lore, Bring in prep, the
// schedule) and back, the campaign staying active the whole time. The view
// lives in the address (?view=prep), one viewer's alone, so a reload or the
// browser's back keeps it; status changes reach every seat at once and so
// cannot carry it. The table stays mounted underneath: the call, the board
// and the chat carry on, and Back to the table is instant.
function CampaignScreen({ state, refresh, table }: { state: CampaignState; refresh: () => void; table: TableHandlers }) {
  // The lobby and the table both paint over the whole window: the layout's
  // backdrop rests while either is up (src/lib/backdrop-cover.ts).
  useCoversBackdrop();
  // Under the page's Suspense: Next renders a reader of the address there.
  const query = useSearchParams();
  const campaignId = state.campaign?.id ?? "";
  const mayPrep = state.campaign?.status === "active" && Boolean(state.caps?.steersStory);
  const prepOpen = mayPrep && query.get("view") === "prep";
  const openPrep = useCallback(() => pushView(`/campaigns/${campaignId}?view=prep`), [campaignId]);
  const closePrep = useCallback(() => replaceView(`/campaigns/${campaignId}`), [campaignId]);
  if (state.campaign?.status === "lobby") {
    return <Lobby state={state} refresh={refresh} />;
  }
  return (
    <SessionView
      state={state}
      {...table}
      prep={
        mayPrep
          ? {
              open: prepOpen,
              onToggle: prepOpen ? closePrep : openPrep,
              // Mounted only while shown (and through its exit), SessionView's call.
              screen: <Lobby state={state} refresh={refresh} mode="prep" onResume={closePrep} />,
            }
          : undefined
      }
    />
  );
}
