"use client";

import { cn } from "@/lib/cn";
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

// The line each End Turn control shows, the same words everywhere.
export function turnHeldLine(held: TurnHeld, mine: boolean): string {
  const who = held.watcher || "a watching player";
  return mine ? `Your turn is ending: it passes once ${who} has answered the roll it brings.` : `The turn is ending: it passes once ${who} has answered the roll it brings.`;
}

// Said politely to a screen reader, and faded in as the banner's other lines.
export function TurnHoldNote({ held, mine, className }: { held: TurnHeld; mine: boolean; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("block animate-fade-up text-xs text-amber-200", className)}>
      {turnHeldLine(held, mine)}
    </span>
  );
}
