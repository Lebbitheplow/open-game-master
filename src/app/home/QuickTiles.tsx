"use client";

import Link from "next/link";
import { GameIcon } from "@/components/ui/GameIcon";
import { useT } from "@/lib/locale";

// The title screen's menu, the way a game's main menu lists its doors:
// diamond bullets, Cinzel, the painted glyph rising beside the line you
// hover. Solo adventure disappears rather than greying out when the server
// has no story model: a solo table is nothing without the AI storyteller,
// and a dead line explains nothing. The tour anchors are the ones the
// shells' own home tiles carry, so a guide can point at either.
//
// The four ways into a game say in a few words where each leads, so the
// difference between Quick start and New campaign is not something to find
// out by trying both; someone with no table yet sees Quick start marked as
// the place to begin. The apps' home says the same words.
export function HomeMenu({
  onNewCampaign,
  onStarter,
  showNew = true,
  onSolo,
  showSolo,
  onJoin,
  firstTime = false,
}: {
  onNewCampaign: () => void;
  // The quick start: a one-evening adventure with ready-made heroes.
  onStarter: () => void;
  // False on a server whose admin starts every campaign: the door is not
  // there rather than greyed, like Solo adventure.
  showNew?: boolean;
  onSolo: () => void;
  showSolo: boolean;
  onJoin: () => void;
  // No table yet: Quick start is marked as the place to begin.
  firstTime?: boolean;
}) {
  const t = useT();
  type Item = { id: string; label: string; glyph: string; href?: string; onClick?: () => void; tour: string; sub?: string; tag?: string };
  // Two groups: the ways into a game, each with its line, and the places
  // that are yours. From a laptop up they stand side by side, so the menu
  // stays inside the title screen's frame on a short window.
  const ways: Item[] = [
    ...(showNew && showSolo
      ? [{ id: "starter", label: t("Quick start"), glyph: "ui-quickstart", onClick: onStarter, tour: "tile-quick-start", sub: t("A prepared one-evening adventure, heroes included"), tag: firstTime ? t("Start here") : undefined }]
      : []),
    ...(showNew ? [{ id: "new", label: t("New campaign"), glyph: "ui-new", onClick: onNewCampaign, tour: "tile-new-campaign", sub: t("Your own table: its world, its rules, your friends") }] : []),
    ...(showSolo ? [{ id: "solo", label: t("Solo adventure", { context: "home.menu.solo" }), glyph: "ui-solo", onClick: onSolo, tour: "tile-solo", sub: t("A custom adventure for you alone") }] : []),
    { id: "join", label: t("Join with a code"), glyph: "ui-join", onClick: onJoin, tour: "tile-join", sub: t("Sit at a friend's table with their invite") },
  ];
  const places: Item[] = [
    { id: "characters", label: t("Characters"), glyph: "tab-characters", href: "/characters", tour: "tile-characters" },
    { id: "workshop", label: t("Workshop"), glyph: "system-homebrew", href: "/workshop", tour: "tile-workshop" },
    { id: "rulebook", label: t("Rulebook"), glyph: "system-rules", href: "/rulebook", tour: "tile-rulebook" },
  ];
  return (
    <nav className="ts-menu" aria-label={t("Main menu")}>
      {[ways, places].map((group, groupIndex) => (
        <div key={groupIndex} className="ts-menu-group">
          {group.map((item, itemIndex) => menuItem(item, groupIndex === 0 ? itemIndex : ways.length + itemIndex))}
        </div>
      ))}
    </nav>
  );

  function menuItem(item: Item, index: number) {
    const body = (
      <>
        <span className="ts-menu-diamond" aria-hidden="true" />
        <span className="ts-menu-text">
          <span className="ts-menu-label">
            {item.label}
            {item.tag ? <span className="ts-menu-tag">{item.tag}</span> : null}
          </span>
          {item.sub ? <span className="ts-menu-sub">{item.sub}</span> : null}
        </span>
        <span className="ts-menu-glyph" aria-hidden="true">
          <GameIcon icon={{ kind: "glyph", key: item.glyph }} size="size-9" />
        </span>
      </>
    );
    const style = { animationDelay: `${800 + index * 55}ms` };
    return item.href ? (
      <Link key={item.id} href={item.href} className="ts-menu-item ts-reveal" data-tour={item.tour} style={style} data-no-motion>
        {body}
      </Link>
    ) : (
      <button key={item.id} type="button" onClick={item.onClick} className="ts-menu-item ts-reveal" data-tour={item.tour} style={style} data-no-motion>
        {body}
      </button>
    );
  }
}
