import { memo } from "react";
import type { TableTabId } from "@/lib/dm/table-tabs";
import { preloadable } from "@/lib/preloadable";

// The side panels as separate downloads (SidePanelRouter.tsx), and the one
// call that fetches them all ahead of need: SessionView makes it once the
// table is up and the browser is idle, so opening a tab later finds its
// panel already here and draws it at once (src/lib/preloadable.tsx).

export const panels = {
  FactionsPanel: preloadable(() => import("@/app/campaigns/[campaignId]/FactionsPanel").then((module) => module.FactionsPanel)),
  MarketPanel: preloadable(() => import("@/app/campaigns/[campaignId]/MarketPanel").then((module) => module.MarketPanel)),
  DmConsolePanel: preloadable(() => import("@/app/campaigns/[campaignId]/DmConsolePanel").then((module) => module.DmConsolePanel)),
  LeadPanel: preloadable(() => import("@/app/campaigns/[campaignId]/LeadPanel").then((module) => module.LeadPanel)),
  // Memoized: the board is the heaviest thing on the table, and the table
  // renders again on every stream event. With the same view, sheets and
  // handlers it has nothing new to draw.
  BattleMapPanel: preloadable(() => import("@/app/campaigns/[campaignId]/BattleMapPanel").then((module) => memo(module.BattleMapPanel))),
  DmWhisperPanel: preloadable(() => import("@/app/campaigns/[campaignId]/DmWhisperPanel").then((module) => module.DmWhisperPanel)),
  DmInboxPanel: preloadable(() => import("@/app/campaigns/[campaignId]/DmInboxPanel").then((module) => module.DmInboxPanel)),
  EventLog: preloadable(() => import("@/app/campaigns/[campaignId]/EventLog").then((module) => module.EventLog)),
  BondsPanel: preloadable(() => import("@/app/campaigns/[campaignId]/BondsPanel").then((module) => module.BondsPanel)),
  FactsPanel: preloadable(() => import("@/app/campaigns/[campaignId]/FactsPanel").then((module) => module.FactsPanel)),
  LorePanel: preloadable(() => import("@/app/campaigns/[campaignId]/LorePanel").then((module) => module.LorePanel)),
  MapPanel: preloadable(() => import("@/app/campaigns/[campaignId]/MapPanel").then((module) => module.MapPanel)),
  PartyAtlasPanel: preloadable(() => import("@/app/workshop/world/AtlasParty").then((module) => module.PartyAtlasPanel)),
  NotesPanel: preloadable(() => import("@/app/campaigns/[campaignId]/NotesPanel").then((module) => module.NotesPanel)),
  OverworldPanel: preloadable(() => import("@/app/campaigns/[campaignId]/OverworldPanel").then((module) => module.OverworldPanel)),
  ContextPanel: preloadable(() => import("@/app/campaigns/[campaignId]/ContextPanel").then((module) => module.ContextPanel)),
  PinsPanel: preloadable(() => import("@/app/campaigns/[campaignId]/PinsPanel").then((module) => module.PinsPanel)),
  SessionSettings: preloadable(() => import("@/app/campaigns/[campaignId]/SessionSettings").then((module) => module.SessionSettings)),
  SideChatPanel: preloadable(() => import("@/app/campaigns/[campaignId]/SideChatPanel").then((module) => module.SideChatPanel)),
  StoryPanel: preloadable(() => import("@/app/campaigns/[campaignId]/StoryPanel").then((module) => module.StoryPanel)),
  QuestsPanel: preloadable(() => import("@/app/campaigns/[campaignId]/QuestsPanel").then((module) => module.QuestsPanel)),
  TimelinePanel: preloadable(() => import("@/app/campaigns/[campaignId]/TimelinePanel").then((module) => module.TimelinePanel)),
  // The campaign's world, the workshop's WorldForge at the table (World tab).
  WorldForgePanel: preloadable(() => import("@/app/workshop/world/WorldForgePanel").then((module) => module.WorldForgePanel)),
};

// The panels only one kind of seat can open, by the tab that opens them
// (SidePanelRouter.tsx): the GM's console and inbox, the lead's desk, the
// world and the context of whoever holds the story's secrets. A player's
// phone used to fetch and compile all of them after every load, about a
// megabyte of script for tabs that seat is never shown. Everything else is
// fetched ahead for every seat, the board included: a fight can start at any
// moment and its stage should already be here.
const SEAT_TAB: Partial<Record<keyof typeof panels, TableTabId>> = {
  DmConsolePanel: "dm",
  DmInboxPanel: "dm",
  LeadPanel: "lead",
  WorldForgePanel: "world",
  ContextPanel: "context",
};

// `tabs` is what this seat's rail holds (SessionTabs.tsx buildPanelTabs);
// without it every panel is fetched.
export function preloadSidePanels(tabs?: ReadonlyArray<TableTabId>): void {
  const shown = tabs ? new Set(tabs) : null;
  for (const [name, panel] of Object.entries(panels) as Array<[keyof typeof panels, (typeof panels)[keyof typeof panels]]>) {
    const seatTab = SEAT_TAB[name];
    if (shown && seatTab && !shown.has(seatTab)) {
      continue;
    }
    // A failed preload is retried by the panel's own render when it opens.
    void panel.preload().catch(() => undefined);
  }
}

// Shown in a panel's place for the moment its download is still on the way.
export function PanelLoading() {
  return <div className="skeleton-block h-28 rounded-xl" aria-label="Loading" role="status" />;
}
