"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { offerCorrectionReason } from "@/lib/correction-offer";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { HaltedTurnBanner } from "@/app/campaigns/[campaignId]/HaltedTurnBanner";
import { stagedHaltedTurn } from "@/lib/chronicle-logic";
import { ReportDialog, type ReportTarget } from "@/app/campaigns/[campaignId]/ReportDialog";
import { ItemProposalBar } from "@/app/campaigns/[campaignId]/ItemProposalBar";
import { RulingBar } from "@/app/campaigns/[campaignId]/RulingBar";
import { DisputeDialog } from "@/app/campaigns/[campaignId]/DisputeDialog";
import { UtilityCallStrip } from "@/app/campaigns/[campaignId]/UtilityCallStrip";
import { FightSummaryCard } from "@/app/campaigns/[campaignId]/FightSummaryCard";
import { AskDock } from "@/app/campaigns/[campaignId]/AskPanel";
import { DmCoverNotice } from "@/app/campaigns/[campaignId]/DmDelegationPanel";
import { useT } from "@/lib/locale";
import type { CampaignState, NarrationStatus } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMessage } from "@/lib/db/messages";

// The story column: the transcript with every message action wired to its
// route, then the strips that sit directly above the composer (item
// proposals, the Ask dock, in-flight utility calls, the assisted-mode
// notice), and finally whatever the caller puts in the composer slot. The
// message handlers live here rather than in SessionView because they are
// nothing but fetches against the message routes, and SessionView is about
// what the whole table is doing.
export function SessionChatColumn({
  state,
  campaignId,
  meUserId,
  steersStory,
  narrationStatus,
  onReplayAudio,
  visible,
  askOpen,
  onAskOpenChange,
  refreshAsks,
  refreshFacts,
  onError,
  onLoreCheck,
  onRenarrate,
  onBrowseShop,
  onPinned,
  onConfirm,
  onTakenBack,
  stage,
  keepTranscript = false,
  showTranscript = false,
  children,
}: {
  state: CampaignState;
  campaignId: string;
  meUserId: string;
  steersStory: boolean;
  // Which passages were not read aloud and why, and the way to ask again
  // (NarrationFailureBanner.tsx).
  narrationStatus: Record<string, NarrationStatus> | undefined;
  onReplayAudio: (messageId: string) => Promise<string | null>;
  // Below lg only one column shows at a time; from lg up both always do.
  visible: boolean;
  askOpen: boolean;
  onAskOpenChange: (open: boolean) => void;
  refreshAsks: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  onError: (message: string) => void;
  onLoreCheck: (message: CampaignMessage, selection: string) => void;
  onRenarrate: (message: CampaignMessage) => void;
  // A shop's "is open" line opens the Market on that shop.
  onBrowseShop: (shopId: string) => void;
  // A memory pin landed, so the pins panel should refetch.
  onPinned: () => void;
  // A save that leaves nothing on screen (a pin, a fact into a closed
  // panel) says it took, or players think the button did nothing.
  onConfirm: (confirmation: { glyph: string; text: string }) => void;
  // A move taken back: its words go back into the composer to correct.
  onTakenBack: (text: string) => void;
  // The fight stage (the board and the chronicle scroll) in place of the
  // transcript while a board is on the table and the columns are docked.
  stage?: ReactNode;
  keepTranscript?: boolean;
  showTranscript?: boolean;
  children: ReactNode;
}) {
  const { campaign, messages, rolls, sheets, locations, dmStatus, utilityCalls } = state;
  // An older host has no take-back route (SERVER_FEATURES takeBackMove).
  const offersTakeBack = hostOffers(useCapabilities(), "takeBackMove");
  const t = useT();
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // The passage a player is objecting to (DisputeDialog.tsx); only a table
  // the AI narrates has rulings to dispute this way.
  const [disputeMessageId, setDisputeMessageId] = useState<string | null>(null);
  const narratedByAi = (state.campaign?.gameSettings?.dmMode ?? "ai") !== "human";
  // Blocks made from this table, hidden at once; the snapshot carries them
  // on the next load.
  const [justBlocked, setJustBlocked] = useState<string[]>([]);
  // The summary dismissed, not a flag: the next fight's card shows again
  // (FightSummaryCard: "the next fight replaces it"). A flag hid every card
  // after the first one closed.
  const [dismissedSummary, setDismissedSummary] = useState<typeof state.fightSummary>(null);
  const blockedUserIds = useMemo(
    () => [...new Set([...state.blockedUserIds, ...justBlocked])],
    [state.blockedUserIds, justBlocked],
  );
  const ttsEnabled = Boolean(campaign?.gameSettings?.ttsEnabled);
  // Ask already reports its own progress inside the strip, naming the
  // question being answered, so repeating it in the strip is the same news
  // twice.
  const visibleUtilityCalls = utilityCalls.filter((call) => call.kind !== "ask");
  // While the board holds the stage the transcript is out of sight, and the
  // chronicle leaves a halted turn out, so its notice and Retry sit here.
  const transcriptShown = !stage || showTranscript;
  const halted = useMemo(() => (transcriptShown ? null : stagedHaltedTurn(messages)), [transcriptShown, messages]);

  return (
    <div className={cn("cine-chat min-w-0 flex-1 flex-col", visible ? "flex" : "hidden lg:flex", stage && "cine-chat-staged")}>
      <ReportDialog
        campaignId={campaignId}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onBlocked={(userId) => setJustBlocked((current) => [...current, userId])}
      />
      {stage}
      {!stage || keepTranscript ? (
      <MessageList
        hidden={Boolean(stage) && !showTranscript}
        messages={messages}
        campaignId={campaignId}
        canRetryTurn={steersStory}
        canIllustrate={steersStory}
        rolls={rolls}
        sheets={sheets}
        departing={state.departingSheets}
        goneRefreshKey={state.relationshipsVersion}
        members={state.members}
        cast={state.cast}
        meUserId={meUserId}
        blockedUserIds={blockedUserIds}
        onDispute={narratedByAi && !steersStory ? (message) => setDisputeMessageId(message.id) : undefined}
        onReport={(message) => {
          if (message.authorType === "dm") {
            setReportTarget({ messageId: message.id, authorType: "dm", label: t("the Game Master") });
            return;
          }
          const sheet =
            sheets.find((entry) => entry.id === message.characterId) ??
            sheets.find((entry) => entry.userId === message.userId);
          const member = state.members.find((entry) => entry.userId === message.userId);
          setReportTarget({
            messageId: message.id,
            userId: message.userId ?? undefined,
            authorType: "player",
            label: sheet?.name ?? member?.username ?? t("this player"),
          });
        }}
        locations={locations}
        dmStatus={dmStatus}
        mediaStatus={state.mediaStatus}
        narrationStatus={narrationStatus}
        onReplayAudio={ttsEnabled ? onReplayAudio : undefined}
        onLoreCheck={(message) => {
          // Whatever text was selected when the flag was raised, captured at
          // click, before the dialog steals focus.
          const selection = window.getSelection()?.toString().trim() ?? "";
          onLoreCheck(message, selection.length > 3 ? selection : "");
        }}
        onRenarrate={steersStory ? onRenarrate : undefined}
        onBrowseShop={onBrowseShop}
        onTakeBack={
          steersStory && offersTakeBack
            ? async (message) => {
                const sure = await appConfirm(
                  t("The GM's answer to this move is taken back with it: the lines leave the chronicle, and the sheets, the clock and the fight go back to before the answer. The move's words come back to you to correct and send again."),
                  { title: t("Take back and rewrite?"), actionLabel: t("Take it back"), tone: "danger" },
                );
                if (!sure) {
                  return;
                }
                const url = `/api/campaigns/${campaignId}/messages/${message.id}/take-back`;
                const send = async (confirm: boolean) => {
                  const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(confirm ? { confirm: true } : {}),
                  }).catch(() => null);
                  const data = response ? ((await response.json().catch(() => ({}))) as Record<string, unknown>) : {};
                  return { response, data };
                };
                let { response, data } = await send(false);
                // 409 with warnings: newer changes stack on the answer, and
                // the lead reads them before saying yes a second time.
                if (response?.status === 409 && Array.isArray(data.warnings) && data.warnings.length) {
                  const again = await appConfirm((data.warnings as string[]).join(" "), {
                    title: t("Take it back anyway?"),
                    actionLabel: t("Take it back"),
                    tone: "danger",
                  });
                  if (!again) {
                    return;
                  }
                  ({ response, data } = await send(true));
                }
                if (!response?.ok) {
                  onError(
                    !response
                      ? t("Could not reach the table to take that move back.")
                      : typeof data.error === "string" && data.error
                        ? data.error
                        : t("Could not take that move back."),
                  );
                  return;
                }
                onTakenBack(typeof data.text === "string" ? data.text : message.content);
                offerCorrectionReason(campaignId, data);
              }
            : undefined
        }
        onContinueScene={
          steersStory
            ? async (message) => {
                // No dialog: a continue takes no options, so the button is
                // the whole interaction. The server publishes
                // message_updated with the extended prose.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${message.id}/continue`,
                  { method: "POST" },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  onError(data.error || t("Could not continue the scene."));
                }
              }
            : undefined
        }
        onSelectVariant={
          steersStory
            ? async (message, index) => {
                // The server publishes message_updated, so every player's
                // chat swaps to the picked take.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${message.id}/renarrate`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "select", index }),
                  },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  onError(data.error || t("Could not switch takes."));
                }
              }
            : undefined
        }
        onEditSave={
          steersStory
            ? async (message, content) => {
                // Returns the server's refusal so the editor can show it
                // inline; the roll-marker rule lives server-side.
                const response = await fetch(
                  `/api/campaigns/${campaignId}/messages/${message.id}/edit`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content }),
                  },
                );
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  return data.error || t("Could not save that edit.");
                }
                offerCorrectionReason(campaignId, await response.json().catch(() => null));
                return null;
              }
            : undefined
        }
        onPinMemory={async (message) => {
          // NE-P's isFullMessage distinction: a selection is an excerpt, no
          // selection pins the whole narration. Any member may pin, unlike
          // onPinCanon (facts), which is lead-only canon.
          const selection = window.getSelection()?.toString().trim() ?? "";
          const isFullMessage = selection.length <= 3;
          const response = await fetch(`/api/campaigns/${campaignId}/pins`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId: message.id,
              text: isFullMessage ? message.content : selection,
              isFullMessage,
            }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            onError(data.error || t("Could not pin that."));
            return;
          }
          onPinned();
          onConfirm({
            glyph: "ui-pin",
            text: isFullMessage
              ? t("Pinned: the GM keeps this message in mind every turn.")
              : t("Pinned: the GM keeps this passage in mind every turn."),
          });
        }}
        onPinCanon={
          steersStory
            ? async (message) => {
                // The lead's selected text inside the message wins;
                // otherwise the passage's opening is pinned.
                const selection = window.getSelection()?.toString().trim() ?? "";
                const excerpt = (selection.length > 3 ? selection : message.content)
                  .trim()
                  .slice(0, 300);
                if (!excerpt) {
                  return;
                }
                // A refusal used to pass in silence, so the lead never knew
                // whether the passage was saved (issue 668).
                try {
                  const response = await fetch(`/api/campaigns/${campaignId}/facts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      category: "lore",
                      subject: "",
                      fact: excerpt,
                      sourceSeq: message.seq,
                    }),
                  });
                  if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    onError(data.error || t("Could not add that to Facts."));
                    return;
                  }
                } catch {
                  onError(t("Could not reach the table to add that to Facts."));
                  return;
                }
                await refreshFacts();
                onConfirm({ glyph: "tab-facts", text: t("Added to Facts as established canon.") });
              }
            : undefined
        }
      />
      ) : null}

      {/* Everything under the transcript, in one box: beside a staged board
          it is the column under the board, next to the full-height scroll
          (world.css, issue 213); otherwise the box steps aside
          (display: contents) and the strips sit in the column as they
          always did. Always drawn, so switching the stage never remounts
          the Ask draft or the Hand. */}
      <div className="cine-fight-controls">
      <div className="session-compose-support">
      {halted?.dmTurnId ? (
        <div className="mx-3 mb-2" data-staged-halt="">
          <HaltedTurnBanner campaignId={campaignId} turnId={halted.dmTurnId} content={halted.content} canRetry={steersStory} />
        </div>
      ) : null}
      <RulingBar
        campaignId={campaignId}
        disputes={state.disputes}
        members={state.members}
        meUserId={meUserId}
        steersStory={steersStory}
      />
      <DisputeDialog campaignId={campaignId} messageId={disputeMessageId} onClose={() => setDisputeMessageId(null)} />

      <ItemProposalBar
        campaignId={campaignId}
        proposals={state.itemProposals}
        sheets={sheets}
        meUserId={meUserId}
        steersStory={steersStory}
      />

      <AskDock
        campaignId={campaignId}
        asks={state.asks}
        meUserId={meUserId}
        loaded={state.asksLoaded}
        open={askOpen}
        onOpenChange={onAskOpenChange}
        onAsked={refreshAsks}
        sheets={sheets}
        cast={state.cast}
        places={locations}
      />

      {/* Directly above the composer, so the answer to "why is nothing
          happening" sits where the player is already looking. */}
      {state.fightSummary && state.fightSummary !== dismissedSummary ? (
        <FightSummaryCard summary={state.fightSummary} onDismiss={() => setDismissedSummary(state.fightSummary)} className="mx-3 mb-2" />
      ) : null}
      <UtilityCallStrip calls={visibleUtilityCalls} />

      {/* Assisted mode: the DM stepped away and the AI is answering for
          them. Shown to every seat, because a player owed an answer is owed
          the knowledge of who is giving it. */}
      <DmCoverNotice cover={campaign?.dmCover ?? null} />
      </div>

      {children}
      </div>
    </div>
  );
}
