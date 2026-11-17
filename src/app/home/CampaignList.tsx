"use client";

import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useLocale, useT } from "@/lib/locale";
import { CampaignCover } from "@/components/CampaignCover";
import { Tooltip } from "@/components/ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { ExportMenu } from "@/app/campaigns/[campaignId]/ExportMenu";
import { slotLine, statusLabel, steersStory, type HomeCampaign } from "@/app/home/types";

// "Your tables": every campaign this account sits at, laid out as save
// slots along the bottom edge, with the same three actions the old tiles
// carried. Export is for anyone at the table, Duplicate follows story
// authority, Delete is the owner's alone. The one on the title screen is
// listed too, or it could never be exported, copied or deleted from home;
// its status badge tells it apart. A dashed slot at the end forges a new
// world.
export function YourTables({
  campaigns,
  loading,
  userId,
  cloningId,
  actionError,
  onClone,
  onDelete,
  onNewCampaign,
}: {
  campaigns: HomeCampaign[];
  loading: boolean;
  userId: string;
  cloningId: string;
  actionError: string;
  onClone: (id: string) => void;
  onDelete: (campaign: HomeCampaign) => void;
  onNewCampaign: () => void;
}) {
  const t = useT();
  if (!loading && campaigns.length === 0 && !actionError) {
    return null;
  }
  return (
    <section className="ts-slots ts-reveal" style={{ animationDelay: "900ms" }} aria-label={t("Your tables")}>
      <h2 className="ts-slots-eyebrow">{campaigns.length === 1 ? t("Your table") : t("Your tables")}</h2>
      {actionError ? <p className="motion-shake ts-error">{actionError}</p> : null}
      {loading ? (
        <div className="ts-slot-row" aria-busy="true">
          <div className="skeleton-block ts-slot-skeleton" />
          <div className="skeleton-block ts-slot-skeleton" />
        </div>
      ) : (
        <ul className="ts-slot-row">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="ts-slot-cell">
              <SaveSlot
                campaign={campaign}
                userId={userId}
                cloning={cloningId === campaign.id}
                onClone={() => onClone(campaign.id)}
                onDelete={() => onDelete(campaign)}
              />
            </li>
          ))}
          <li className="ts-slot-cell">
            <button type="button" onClick={onNewCampaign} className="ts-slot ts-slot-new motion-card">
              <span className="ts-slot-new-plus" aria-hidden="true">
                <Plus className="size-5" />
              </span>
              <span className="ts-slot-title">{t("Forge a new world")}</span>
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}

function SaveSlot({
  campaign,
  userId,
  cloning,
  onClone,
  onDelete,
}: {
  campaign: HomeCampaign;
  userId: string;
  cloning: boolean;
  onClone: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const ended = campaign.status === "ended";
  const router = useRouter();
  // The same doors as the slot and its three buttons, under a right-click or
  // a long press. The buttons stay: the menu is a second way, not the only one.
  const menu: ContextMenuItem[] = [
    { id: "open", label: t("Open", { context: "action.open" }), glyph: "tab-campaigns", onSelect: () => router.push(`/campaigns/${campaign.id}`) },
    // A running campaign's prep (issue 530), for whoever steers its story:
    // the second door, the slot itself still opening the table.
    ...(campaign.status === "active" && steersStory(campaign, userId)
      ? [{ id: "prep", label: t("Open prep"), glyph: "tab-journal", onSelect: () => router.push(`/campaigns/${campaign.id}?view=prep`) }]
      : []),
    { id: "export-html", label: t("Export story: HTML page"), glyph: "ui-export", separated: true, onSelect: () => downloadStory(campaign.id, "html") },
    { id: "export-odt", label: t("Export story: OpenDocument (.odt)"), glyph: "ui-export", onSelect: () => downloadStory(campaign.id, "odt") },
    { id: "export-docx", label: t("Export story: Word (.docx)"), glyph: "ui-export", onSelect: () => downloadStory(campaign.id, "docx") },
    ...(steersStory(campaign, userId)
      ? [{ id: "duplicate", label: t("Duplicate"), glyph: "ui-duplicate", separated: true, disabled: cloning, onSelect: onClone }]
      : []),
    ...(campaign.role === "owner"
      ? [{ id: "delete", label: t("Delete"), glyph: "ui-delete", tone: "danger" as const, separated: !steersStory(campaign, userId), onSelect: onDelete }]
      : []),
  ];
  return (
    <ContextMenu items={menu} label={campaign.title} className="h-full">
      <div className={cn("ts-slot motion-card group", ended && "ts-slot-ended")}>
        <Link href={`/campaigns/${campaign.id}`} className="ts-slot-door" data-no-motion>
          <span className="ts-slot-art">
            <CampaignCover
              cover={campaign.cover}
              title={campaign.title}
              genre={campaign.genre}
              seed={campaign.id}
              width={1024}
              className="h-full rounded-none border-0 shadow-none aspect-auto"
            />
            <span
              className={cn(
                "ts-slot-badge",
                campaign.status === "lobby" && "ts-slot-badge-lobby",
                campaign.status === "active" && "ts-slot-badge-active",
                ended && "ts-slot-badge-ended",
              )}
            >
              {statusLabel(t, campaign)}
            </span>
          </span>
          <span className="ts-slot-title">{campaign.title}</span>
          <span className="ts-slot-line">{slotLine(t, campaign, userId, locale)}</span>
          <span className="ts-slot-meta">
            {t("Level {level} start · {difficulty}", { level: campaign.startingLevel, difficulty: campaign.difficulty })}
            {campaign.maxPlayers === 1 ? t(" · solo") : ""}
          </span>
        </Link>
        <span className="ts-slot-actions">
          <ExportMenu campaignId={campaign.id} variant="tile-icon" />
          {steersStory(campaign, userId) ? (
            <Tooltip content={t("Copy the world into a new campaign, without the transcript")}>
              <button
                type="button"
                aria-label={t("Duplicate this campaign")}
                disabled={cloning}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClone();
                }}
                className={cn(ui.iconAction, "hover:text-amber-300")}
              >
                {cloning ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
              </button>
            </Tooltip>
          ) : null}
          {campaign.role === "owner" ? (
            <Tooltip content={t("Delete this campaign")}>
              <button
                type="button"
                aria-label={t("Delete this campaign")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete();
                }}
                className={cn(ui.iconAction, "hover:text-red-400")}
              >
                <Trash2 className="size-4" />
              </button>
            </Tooltip>
          ) : null}
        </span>
      </div>
    </ContextMenu>
  );
}

// The download ExportMenu performs for the same three formats: the server
// sets Content-Disposition, so a bare anchor click saves the file.
function downloadStory(campaignId: string, format: "html" | "odt" | "docx") {
  const anchor = document.createElement("a");
  anchor.href = `/api/campaigns/${campaignId}/export?format=${format}`;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
