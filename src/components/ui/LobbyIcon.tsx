import { BookOpen, CalendarDays, Link, Settings, Users } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";

const fittings = {
  "tab-party": Users,
  "tab-friends": Link,
  "tab-session": CalendarDays,
  "tab-story": BookOpen,
  "tab-settings": Settings,
};

// Painted themes put the labelled heading's symbol on their own metal fitting.
// A palette-only theme keeps the original painted glyph.
export function LobbyIcon({ glyph }: { glyph: string }) {
  const Symbol = fittings[glyph as keyof typeof fittings] ?? Settings;
  return (
    <>
      <span className="lobby-painted-icon"><GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" /></span>
      <span className="theme-heading-icon" aria-hidden="true"><Symbol size={16} strokeWidth={1.6} /></span>
    </>
  );
}
