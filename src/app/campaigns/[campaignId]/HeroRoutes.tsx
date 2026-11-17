"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { odmLocaleHeaders, useT } from "@/lib/locale";
import { GameIcon } from "@/components/ui/GameIcon";
import { PregenPicker } from "@/app/campaigns/[campaignId]/PregenPicker";
import { cn } from "@/lib/cn";
import { heroRouteAdvice } from "@/app/campaigns/[campaignId]/hero-routes";

// The three ways to a hero, offered the same way wherever a player still
// needs one: the lobby, a solo table, and the composer's gate for someone
// who joined a game already under way. A ready-made hero is one tap from
// play; a saved one comes from the library adapted to the table; a new one
// is built step by step. The route the player most likely wants is marked,
// and every route stays one tap away.
export function HeroRoutes({ campaignId, className }: { campaignId: string; className?: string }) {
  const t = useT();
  const [heroes, setHeroes] = useState<string[] | null>(null);
  const [pregens, setPregens] = useState<number | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/characters")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { characters?: Array<{ name: string; role?: string }> } | null) => {
        // Allies the DM plays are brought in through the party panel, never
        // as a player's own (the join page leaves them out too).
        if (!cancelled) setHeroes((data?.characters ?? []).filter((character) => character.role !== "companion").map((character) => character.name));
      })
      .catch(() => {
        if (!cancelled) setHeroes([]);
      });
    fetch("/api/starter", { headers: odmLocaleHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { pregens?: unknown[] } | null) => {
        if (!cancelled) setPregens(Array.isArray(data?.pregens) ? data.pregens.length : 0);
      })
      .catch(() => {
        if (!cancelled) setPregens(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const page = `/campaigns/${campaignId}/character`;
  const loading = heroes === null || pregens === null;
  const advice = heroRouteAdvice(t, { library: heroes ?? [], pregens: pregens ?? 0 });
  // An empty library opens the ready-made list at once: it is the quickest
  // way to a seat, and the other two doors stay beside it.
  const showReady = readyOpen || (!loading && advice.suggested === "ready" && advice.openReady);

  return (
    <div className={cn("space-y-2", className)} data-hero-routes aria-busy={loading}>
      {/* One full-width row per route at every width: three narrow columns
          wrapped their titles under the badge. */}
      <div className={cn("stagger-up grid gap-2", loading && "invisible")}>
        {advice.ready ? (
          <RouteCard
            glyph="ui-quickstart"
            title={t("Ready-made hero")}
            blurb={t("A finished character, playing in a minute. It joins your library too.")}
            badge={advice.suggested === "ready" ? t("Fastest") : null}
            pressed={showReady}
            onClick={() => setReadyOpen(!showReady)}
            route="ready"
          />
        ) : null}
        <RouteCard
          glyph="tab-characters"
          title={t("From your library", { context: "table.hero.libraryTitle" })}
          blurb={advice.libraryLine}
          badge={advice.suggested === "library" ? t("Suggested", { context: "table.hero.suggested" }) : null}
          href={advice.library ? page : undefined}
          route="library"
        />
        <RouteCard
          glyph="ui-new"
          title={t("Build your own")}
          blurb={t("Step by step, with a suggestion at every choice and the full rules when you want them.")}
          href={`${page}?start=new`}
          route="build"
        />
      </div>
      {showReady ? (
        <div key="ready" className="reveal-height">
          <PregenPicker campaignId={campaignId} heading={null} />
        </div>
      ) : null}
    </div>
  );
}

function RouteCard({
  glyph,
  title,
  blurb,
  badge = null,
  href,
  onClick,
  pressed,
  route,
}: {
  glyph: string;
  title: string;
  blurb: string;
  badge?: string | null;
  href?: string;
  onClick?: () => void;
  pressed?: boolean;
  route: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-8" className="shrink-0" />
        <span className="min-w-0 flex-1 font-display text-sm tracking-wide text-amber-50">{title}</span>
        {badge ? (
          <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-stone-400">{blurb}</span>
    </>
  );
  const shape = cn(
    "motion-press block w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
    badge ? "border-amber-400/45 bg-amber-400/[0.07]" : "border-stone-800 bg-stone-950/50",
    (href || onClick) && "hover:border-amber-500/50",
    pressed && "border-amber-400/60",
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-expanded={pressed} className={shape} data-hero-route={route}>
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className={shape} data-hero-route={route}>
        {body}
      </Link>
    );
  }
  // Nothing in the library yet: the door is drawn, and says why it is shut.
  return (
    <div aria-disabled="true" className={cn(shape, "opacity-60")} data-hero-route={route}>
      {body}
    </div>
  );
}
