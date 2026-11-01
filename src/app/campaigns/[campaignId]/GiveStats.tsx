"use client";

import { Hammer } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { kitButtonClass } from "./PanelKit";
import { textKey } from "@/lib/language/text-logic";
import { navigateTo } from "@/lib/navigation";
import { shellHost } from "@/lib/shell-host";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// Loot the model named that no list holds carries no stats: a "Ring of
// Whispers" is a name and nothing more. A workshop item of the same name,
// written by whoever runs the table, gives it its stats on the next read
// (hydrateHomebrewGear), the copies already carried included. The lead's
// Adjust dialog marks such items and opens that editor with the name in it,
// in a new tab, so the table stays where it was. Inside the apps the page is
// the app's own (src/lib/navigation.ts): a new tab there opened the app's
// own address, which the desktop app refuses and Android loads in place of
// its screens, so there the workshop opens in place and Back returns.

export type UnknownGear = { names: string[]; canAuthor: boolean; workshopId: string | null };

export function useUnknownGear(campaignId: string, sheetId: string): UnknownGear | null {
  const [found, setFound] = useState<UnknownGear | null>(null);
  // The apps' screens can open an older host, which has no such route: it
  // is not asked, and no item is marked there.
  const offered = hostOffers(useCapabilities(), "unknownGear");
  useEffect(() => {
    if (!offered) return;
    let live = true;
    void fetch(`/api/campaigns/${campaignId}/sheets/${sheetId}/unknown-gear`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: UnknownGear | null) => {
        if (live && body && Array.isArray(body.names)) setFound(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [campaignId, sheetId, offered]);
  return offered ? found : null;
}

export function GiveStats({ name, gear, unsaved = false }: { name: string; gear: UnknownGear | null; unsaved?: boolean }) {
  // Asked to leave with changes in the dialog not saved yet (in the apps,
  // where the workshop takes the table's place): the changes stay, and the
  // line says to save or cancel them first.
  const [heldBack, setHeldBack] = useState(false);
  if (!gear || !gear.names.some((entry) => textKey(entry) === textKey(name))) {
    return null;
  }
  const inApp = Boolean(shellHost()?.navigation);
  const linkTo = (href: string) => ({
    href,
    ...(inApp
      ? {
          onClick: (event: MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            if (unsaved) {
              setHeldBack(true);
              return;
            }
            navigateTo(href);
          },
        }
      : { target: "_blank", rel: "noopener" }),
  });
  return (
    <p className="reveal flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-[11px] text-stone-400">
      <span>No stats at this table yet.</span>
      {!gear.canAuthor ? (
        <span>The table&apos;s host or GM can give it some in their workshop.</span>
      ) : gear.workshopId ? (
        <a
          {...linkTo(`/workshop/${gear.workshopId}?system=homebrew&item=${encodeURIComponent(name)}`)}
          className={kitButtonClass("small", "gap-1 py-0.5")}
        >
          <Hammer className="size-3.5" aria-hidden="true" />
          Give it stats
          <span className="sr-only">{inApp ? " (opens the workshop)" : " (opens the workshop in a new tab)"}</span>
        </a>
      ) : (
        <a {...linkTo("/workshop")} className={kitButtonClass("link")}>
          Make a workshop to give it stats
        </a>
      )}
      {inApp && gear.canAuthor ? (
        <span role="status" className={heldBack && unsaved ? "basis-full text-amber-200" : "sr-only"}>
          {heldBack && unsaved ? "Save or cancel your changes first: the workshop opens in place of the table." : ""}
        </span>
      ) : null}
    </p>
  );
}
