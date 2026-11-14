import { BookOpen, CalendarDays, Leaf, Link, Settings, Users } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";

const fittings = {
  "tab-party": Users,
  "tab-friends": Link,
  "tab-session": CalendarDays,
  "tab-story": BookOpen,
  "tab-settings": Settings,
};

// The same labelled heading keeps its painted glyph in other themes.
// Woodland uses an engraved symbol on its shared silver leaf fitting.
export function LobbyIcon({ glyph }: { glyph: string }) {
  const Symbol = fittings[glyph as keyof typeof fittings] ?? Leaf;
  return (
    <>
      <span className="lobby-painted-icon"><GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" /></span>
      <span className="theme-heading-icon" aria-hidden="true"><Symbol size={16} strokeWidth={1.6} /></span>
    </>
  );
}
