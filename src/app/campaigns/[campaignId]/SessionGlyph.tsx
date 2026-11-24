"use client";

import type { LucideIcon } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";

// A painted glyph that can stand wherever the rail expects a line icon. The
// shared IconRail and the panels' SubTabs take a LucideIcon; this gives them
// a component of that shape which paints instead, so the travelling mark,
// the badges and the tour anchors in IconRail stay exactly as they are. The
// caller's size class is dropped: a painting needs more room than a 16 px
// line icon, and .rail-glyph sets it (src/app/styles/session.css).
export function paintedRailIcon(glyph: string): LucideIcon {
  function PaintedRailIcon({ className }: { className?: string }) {
    const rest = (className ?? "").replace(/\bsize-\S+/g, "").trim();
    return <GameIcon icon={{ kind: "glyph", key: glyph }} size="" className={cn("rail-glyph", rest)} />;
  }
  PaintedRailIcon.displayName = `PaintedRailIcon(${glyph})`;
  return PaintedRailIcon as unknown as LucideIcon;
}

// A header control's painting. `off` dims it and strikes it through, which
// is how the header says muted without a second icon. The wrapper is a flex
// box, never an inline span: inline, the painting stood on a text line whose
// descender room sat under it, so every header button carried its icon 2 px
// above its middle (and a muted one, already a flex box, did not).
export function HeaderGlyph({ glyph, off = false, className }: { glyph: string; off?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex", off && "session-glyph-off", className)}>
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" className="session-glyph" />
    </span>
  );
}
