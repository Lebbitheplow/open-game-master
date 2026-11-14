"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import type { IconRef } from "@/lib/icons";
import { spellGlyphIcon } from "@/lib/battlemap/spell-glyph-table";
import type { EditorKind } from "@/app/workshop/homebrew/types";

// The painted face of a piece of homebrew. A spell wears the glyph of the
// spell it is named after or runs as, as its card does (issue 845), else the
// unknown glyph. An item named after something in the books gets that
// painting, else its family's (a weapon, armor), and a kind with no family
// at all shows the homebrew glyph underneath, so every row has a face.

export const KIND_GLYPHS: Record<EditorKind, string> = {
  item: "tab-loot",
  spell: "rest-spell-slot",
  feat: "rest-inspiration",
  background: "tab-journal",
  race: "tab-characters",
  class: "tab-party",
  archetype: "rest-level-up",
  hazard: "cue-dread",
};

// A hazard by what it is.
const HAZARD_GLYPHS: Record<string, string> = { trap: "cue-dungeon", poison: "cue-swamp", disease: "rest-exhaustion" };

const ITEM_FAMILIES: Record<string, string> = {
  weapon: "item-weapon",
  armor: "item-armor",
  gear: "item-gear",
  magic_item: "item-magic-item",
};

export function homebrewIcon(kind: string, name: string, data: Record<string, unknown>): IconRef | null {
  if (kind === "item") {
    return { kind: "item", key: name, family: ITEM_FAMILIES[String(data.itemKind ?? "gear")] ?? "item-gear" };
  }
  if (kind === "spell") {
    return spellGlyphIcon(name, typeof data.runsAs === "string" ? data.runsAs : null, data.mech);
  }
  if (kind === "feat") {
    return { kind: "feat", key: name };
  }
  if (kind === "hazard" && HAZARD_GLYPHS[String(data.hazardKind)]) {
    return { kind: "glyph", key: HAZARD_GLYPHS[String(data.hazardKind)] };
  }
  if (kind === "archetype" && data.classSlug) {
    return { kind: "family", key: `class-${String(data.classSlug)}` };
  }
  return null;
}

export function HomebrewPlate({ kind, name, data }: { kind: string; name: string; data: Record<string, unknown> }) {
  const icon = homebrewIcon(kind, name, data);
  return (
    <span className="relative grid size-12 shrink-0 place-items-center rounded-lg border border-amber-500/25 bg-stone-950/70">
      {/* A spell's glyph always ships and is drawn on clear ground, so nothing sits under it. */}
      {icon?.kind === "glyph" && kind === "spell" ? null : (
        <GameIcon icon={{ kind: "glyph", key: KIND_GLYPHS[kind as EditorKind] ?? "system-homebrew" }} size="size-9" />
      )}
      {icon ? <GameIcon icon={icon} size="size-9" className="absolute" /> : null}
    </span>
  );
}
