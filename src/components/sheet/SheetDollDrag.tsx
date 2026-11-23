"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { GameIcon } from "@/components/ui/GameIcon";
import type { DollPlaceId } from "@/components/sheet/paperdoll-logic";
import type { IconRef } from "@/lib/icons";

// Dragging a carried item's chip onto its place on the paperdoll puts it on:
// the same change the place's own row makes with a press, which stays the
// way a keyboard, a screen reader and a finger do it. Built on pointer
// events, as the Party panel's handles are (PartyOrder.tsx), and not on the
// browser's drag and drop, which never fires for a finger: a phone can be
// let in later by lifting the one check below, with a long press to start
// and the sheet's scrolling held while it lasts.

// What is being dragged and where it may land.
export type DollDrag = {
  name: string;
  place: DollPlaceId;
  // The pointer is over that place now, so letting go puts the item on.
  over: boolean;
};

type Held = { name: string; place: DollPlaceId; pointerId: number; x: number; y: number; moved: boolean };

// A press that moves less than this is a press, not a drag.
const SLOP = 6;

function placeAt(x: number, y: number): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const tile = (element as HTMLElement).closest?.("[data-doll-place]") as HTMLElement | null;
    if (tile) {
      return tile.dataset.dollPlace ?? null;
    }
  }
  return null;
}

export function useDollDrag({
  placeOf,
  onDrop,
}: {
  // The place a chip's item may be dropped on, or null for one that cannot
  // be dragged (paperdoll-logic.ts dollDropPlace).
  placeOf: (name: string) => DollPlaceId | null;
  onDrop: (name: string) => void;
}) {
  const held = useRef<Held | null>(null);
  const [drag, setDrag] = useState<(DollDrag & { x: number; y: number }) | null>(null);
  const dragging = drag !== null;

  // Escape puts the item back, and must not also shut the sheet under it.
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        held.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging]);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    // A mouse or a pen only: a finger on the chips is scrolling the sheet.
    if (event.pointerType === "touch" || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    // The chip's own ⓘ stays a button.
    if (target.closest("button, a")) {
      return;
    }
    const name = (target.closest("[data-chip]") as HTMLElement | null)?.dataset.chip;
    const place = name ? placeOf(name) : null;
    if (!name || !place) {
      return;
    }
    // No text is selected as the pointer leaves the chip.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    held.current = { name, place, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const now = held.current;
    if (!now || now.pointerId !== event.pointerId) {
      return;
    }
    if (!now.moved && Math.hypot(event.clientX - now.x, event.clientY - now.y) < SLOP) {
      return;
    }
    now.moved = true;
    setDrag({ name: now.name, place: now.place, x: event.clientX, y: event.clientY, over: placeAt(event.clientX, event.clientY) === now.place });
  }

  function end(event: PointerEvent<HTMLElement>, drop: boolean) {
    const now = held.current;
    if (!now || now.pointerId !== event.pointerId) {
      return;
    }
    held.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
    if (drop && now.moved && placeAt(event.clientX, event.clientY) === now.place) {
      onDrop(now.name);
    }
  }

  return {
    drag,
    // Spread on the element that holds the chips.
    source: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, true),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, false),
      // Capture can be lost with no pointerup (the window loses focus mid
      // drag): the item would stay stuck to the pointer until Escape. After a
      // real pointerup `end` has already cleared the drag, so this does nothing.
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => end(event, false),
    },
  };
}

// The item under the pointer while it is carried. On the page's own body, so
// the sheet's scrolling and its opening motion cannot move or clip it, and
// never in the pointer's way: the place under it is what the drag reads.
export function DollDragGhost({ x, y, label, icon, over }: { x: number; y: number; label: string; icon: IconRef; over: boolean }) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      aria-hidden="true"
      data-doll-ghost
      data-over={over ? "" : undefined}
      style={{ left: x + 10, top: y + 10 }}
      className={
        "pointer-events-none fixed z-[1000] flex max-w-[14rem] items-center gap-1.5 rounded border bg-stone-900 px-2 py-1 text-xs text-stone-100 shadow-lg " +
        (over ? "border-amber-400" : "border-stone-500")
      }
    >
      <GameIcon icon={icon} size="size-6" />
      <span className="truncate">{label}</span>
    </div>,
    document.body,
  );
}
