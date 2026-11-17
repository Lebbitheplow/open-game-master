"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/locale";
import { translate } from "@/lib/messages-logic";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// A turn whose End Turn is in while the move waits on a watcher's stop
// (src/lib/dm/turn-hold.ts): the End Turn controls read it from the
// encounter, which an older host never sends (SERVER_FEATURES turnHold).
export type TurnHeld = NonNullable<PublicEncounter["turnHeld"]>;

export function useTurnHeld(encounter: PublicEncounter | null | undefined): TurnHeld | null {
  const offered = hostOffers(useCapabilities(), "turnHold");
  return offered ? (encounter?.turnHeld ?? null) : null;
}

// The sentence's own keying is the Hand/board's batch; this file owns only
// the fallback word for a hold with no watcher named, which the note reads
// in the reader's language when the renderer passes its translator.
type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// The line each End Turn control shows, the same words everywhere.
export function turnHeldLine(held: TurnHeld, mine: boolean, t: T = enT): string {
  const who = held.watcher || t("a watching player");
  return mine ? `Your turn is ending: it passes once ${who} has answered the roll it brings.` : `The turn is ending: it passes once ${who} has answered the roll it brings.`;
}

// Said politely to a screen reader, and faded in as the banner's other lines.
export function TurnHoldNote({ held, mine, className }: { held: TurnHeld; mine: boolean; className?: string }) {
  const t = useT();
  return (
    <span role="status" aria-live="polite" className={cn("block animate-fade-up text-xs text-amber-200", className)}>
      {turnHeldLine(held, mine, t)}
    </span>
  );
}
