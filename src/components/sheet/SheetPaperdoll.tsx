"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { SheetGearRows, type PendingWear } from "@/components/sheet/SheetGearRow";
import { DOLL_PLACES, dollPlaceOf, dollTileLabel, dollTileLine, dollTileNames, dollView, type DollPlaceId, type DollTile } from "@/components/sheet/paperdoll-logic";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { findNamed } from "@/lib/language/text-logic";
import { itemCategory, itemToneStyle } from "@/lib/srd/item-category-logic";
import { inventoryItemIcon } from "@/lib/inventory-art-logic";

type GearAsk = Record<string, { equipped?: boolean; attuned?: boolean; layered?: boolean }>;

// The character's body with a tile for every place gear is worn: filled with
// what is on, empty with what goes there. Pressing a place opens what the
// pack holds for it, as the rows the sheet has always had (wear, attune, the
// swap question), so the flat list those rows were is gone and a player
// sees the places before two cloaks collide. Rows with no place on the body
// share one last tile, which is drawn only while something is in it.
export function SheetPaperdoll({
  sheet,
  armor,
  mine,
  corrects,
  inCombat,
  myTurn,
  dead,
  busy,
  pending,
  onPending,
  onGear,
}: {
  sheet: CharacterSheet;
  armor: { armorName: string | null; shieldName: string | null };
  mine: boolean;
  corrects: boolean;
  inCombat: boolean;
  myTurn: boolean;
  dead: boolean;
  busy: boolean;
  pending: PendingWear | null;
  onPending: (pending: PendingWear | null) => void;
  onGear: (gear: GearAsk) => void;
}) {
  const view = dollView(sheet.equipment, armor);
  const [picked, setPicked] = useState<DollPlaceId | null>(null);
  // The swap question is asked on a row, so the place it sits in opens for
  // it: the server may raise it for a row whose place is shut.
  const asked = pending ? findNamed(sheet.equipment, pending.name, (item) => [item.name]) : null;
  const open = (asked ? dollPlaceOf(asked) : null) ?? picked;
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // On a phone the opened place lands under the whole figure, past the fold.
  useEffect(() => {
    if (open) {
      panel.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open]);

  const rows = (items: EquipmentItem[]) => (
    <SheetGearRows
      sheet={sheet}
      items={items}
      armor={armor}
      corrects={corrects}
      inCombat={inCombat}
      myTurn={myTurn}
      dead={dead}
      busy={busy}
      pending={pending}
      onPending={onPending}
      onGear={onGear}
    />
  );
  const tile = (id: DollPlaceId) => (
    <DollTileButton
      key={id}
      tile={view.tiles[id]}
      open={open === id}
      controls={panelId}
      onPress={() => {
        onPending(null);
        setPicked(open === id ? null : id);
      }}
    />
  );
  // Other is no part of the body: it is there while it holds something.
  const drawn = DOLL_PLACES.filter((id) => id !== "other" || view.tiles.other.fits.length > 0);
  const side = (which: "left" | "right" | "below") => drawn.filter((id) => view.tiles[id].place.side === which);
  const shown = open ? view.tiles[open] : null;

  return (
    <div data-paperdoll className="space-y-1.5">
      {view.unsaid ? (
        <p className="text-[11px] text-stone-500">
          Nobody has said what {mine ? "you wear" : `${sheet.name} wears`} yet, so everything carried counts as worn.
        </p>
      ) : null}
      {/* No group role here: each tile names its own place, and a sheet-wide
          count of groups that hold an expandable button is how the
          personality pickers are found (scenario 138-creator-sheets). */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1.5">
          <div className="flex min-w-0 flex-col justify-between gap-1.5">{side("left").map(tile)}</div>
          <DollFigure view={view.tiles} open={open} />
          <div className="flex min-w-0 flex-col justify-between gap-1.5">{side("right").map(tile)}</div>
        </div>
        <div className={cn("grid gap-1.5", side("below").length > 2 ? "grid-cols-3" : "grid-cols-2")}>{side("below").map(tile)}</div>
      </div>
      {shown ? (
        <div
          ref={panel}
          id={panelId}
          role="group"
          aria-label={`${shown.place.label}: what goes there`}
          data-doll-panel={shown.place.id}
          className="reveal space-y-1 rounded border border-stone-700 px-2 py-1.5"
        >
          <p className="text-[11px] text-stone-400">
            <span className="text-stone-200">{shown.place.label}.</span> {shown.place.goes}. {shown.place.rule}
          </p>
          {shown.fits.length ? (
            rows(shown.fits)
          ) : (
            <p className="text-[11px] text-stone-500">Nothing {mine ? "you carry" : `${sheet.name} carries`} goes here.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DollTileButton({ tile, open, controls, onPress }: { tile: DollTile; open: boolean; controls: string; onPress: () => void }) {
  const first = tile.worn[0];
  const category = first ? itemCategory(first) : null;
  const attuned = tile.worn.some((item) => item.attuned);
  return (
    <button
      type="button"
      data-doll-place={tile.place.id}
      data-filled={first ? "true" : undefined}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={dollTileLabel(tile)}
      title={tile.worn.length > 1 ? dollTileNames(tile) : undefined}
      onClick={onPress}
      style={category ? itemToneStyle(category, "row") : undefined}
      className={cn(
        // Finger-sized on a phone and on a desk alike: the doll is a row of
        // targets, and a short one would be a figure with labels.
        "motion-press flex min-h-[44px] w-full min-w-0 items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs",
        first ? "border-stone-600 bg-stone-900/40 text-stone-200" : "border-dashed border-stone-700 text-stone-500",
        open && "border-solid border-amber-600 bg-amber-950/40",
      )}
    >
      {first ? <GameIcon icon={inventoryItemIcon(first)} size="size-6" className="tone-rim" /> : null}
      <span className="min-w-0 grow">
        <span className={cn("block text-[10px] leading-tight", first ? "text-stone-400" : "text-stone-300")}>{tile.place.label}</span>
        {/* Two lines before it is cut: beside the figure a phone's tile is about a hundred pixels wide, which cut "Cloak of Protection" at "Prote". */}
        <span className="line-clamp-2 leading-tight">{dollTileLine(tile)}</span>
      </span>
      {tile.idle.length ? (
        <span aria-hidden="true" className="shrink-0 rounded-full border border-stone-700 px-1 text-[10px] text-stone-400">
          idle
        </span>
      ) : null}
      {attuned ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-sky-400" /> : null}
    </button>
  );
}

// A plain figure drawn in the text's own colour, so it follows the day and
// night themes and needs no painting. Each place on the body has a mark:
// lit while something is worn there, ringed while its place is open.
function DollFigure({ view, open }: { view: Record<DollPlaceId, DollTile>; open: DollPlaceId | null }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 80 200" className="h-full max-h-64 w-14 self-center text-stone-600 sm:w-24">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        <circle cx="40" cy="18" r="11" />
        <path d="M34 28v6c-8 2-14 6-16 14l-7 48q-1 6 3 7q4 0 5-6l6-37l2 44l-3 82q0 6 5 6q5 0 5-6l5-74h2l5 74q0 6 5 6q5 0 5-6l-3-82l2-44l6 37q1 6 5 6q4-1 3-7l-7-48c-2-8-8-12-16-14v-6" />
      </g>
      {DOLL_PLACES.map((id) => {
        const { place, worn } = view[id];
        return place.at ? (
          <circle
            key={id}
            cx={place.at.x}
            cy={place.at.y}
            r={open === id ? 4.5 : 3}
            strokeWidth="1.5"
            className={cn(worn.length ? "fill-amber-400 stroke-amber-200" : "fill-stone-900 stroke-stone-500", open === id && "stroke-amber-400")}
          />
        ) : null;
      })}
    </svg>
  );
}
