"use client";

import { useState } from "react";
import { iconCandidates, iconPath, type IconRef } from "@/lib/icons";
import { cn } from "@/lib/cn";
import { equipmentArtwork } from "@/lib/equipment-art-logic";
import { useEquipmentGenre } from "@/components/ui/EquipmentArtProvider";

// Action illustrations are wide paintings (256x128): they fill the box the
// caller gives them, uncropped and unzoomed. Every other icon sits on the lit
// round plate with its thin gold rim, scaled so the painting meets the rim.
// The chain tries the requested painting, then its family's (a round one,
// behind an action painting too), then renders nothing, so a homebrew thing
// never shows a broken image (src/lib/icons.ts).
const SNUG_KINDS = new Set<IconRef["kind"]>(["glyph", "condition"]);

export function GameIcon({ icon, size = "size-6", className }: { icon: IconRef; size?: string; className?: string }) {
  const genre = useEquipmentGenre();
  const artwork = equipmentArtwork(icon, genre, icon.kind === "action" ? "card" : "inventory");
  const candidates = artwork === icon ? iconCandidates(icon) : [iconPath(artwork.kind, artwork.key), ...iconCandidates(icon)];
  const [attempt, setAttempt] = useState(0);
  const [shownFor, setShownFor] = useState(candidates[0]);
  // A list row can be reused for another thing; start its chain again.
  if (shownFor !== candidates[0]) {
    setShownFor(candidates[0]);
    setAttempt(0);
  }
  if (attempt >= candidates.length) {
    return null;
  }
  // A base card after a failed genre variant is still a wide painting;
  // only the family fallback belongs inside the circular frame.
  const actionArt = icon.kind === "action" && candidates[attempt]?.startsWith("/assets/icons/action/");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden",
        actionArt
          ? "rounded-md"
          : "rounded-full border border-amber-700/50 bg-[radial-gradient(circle_at_50%_36%,#5b4c3a,#1d1712_80%)] p-px shadow-inner",
        size,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={candidates[attempt]}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          "size-full object-contain",
          !actionArt && "[filter:drop-shadow(0_0_1px_rgba(255,224,160,0.75))_brightness(1.06)]",
          !actionArt && (SNUG_KINDS.has(icon.kind) ? "scale-[1.25]" : "scale-[1.7]"),
        )}
        onError={() => setAttempt((n) => n + 1)}
      />
    </span>
  );
}
