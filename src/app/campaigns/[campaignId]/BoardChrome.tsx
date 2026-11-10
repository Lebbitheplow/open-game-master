"use client";

import { ChevronLeft, ChevronRight, EyeOff, X } from "lucide-react";
import { litOrderRows, pointerOrderIndex } from "@/lib/battlemap/initiative-rows";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { GameIcon } from "@/components/ui/GameIcon";
import { conditionIconKey } from "@/lib/battlemap/condition-glyphs";
import { conditionRule } from "@/lib/battlemap/condition-rules";
import { placePlate } from "@/lib/battlemap/plate-place";
import { HEALTH_LABEL, HEALTH_RING, type HealthWord } from "@/lib/battlemap/health-words";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { offSide, SidePlateBand, sidesLine, SideSr } from "@/app/campaigns/[campaignId]/SideBadge";
import type { TargetEdge } from "@/lib/battlemap/view-tactics";
import { variantUrl, type VariantWidth } from "@/lib/image-variant-url";

// The chrome on the board as a stage (docs/visual-overhaul-plan.md 5.1): the
// initiative rail, the turn HUD, the turn banner, the hover plate and the
// target chips. All of it is display: each piece states a fact the projection
// already carries and sends a tap back up; none of it decides a rule.

// A face, never a letter, wherever a combatant is shown. The caller hands the
// pictures in order of preference (own portrait, the monster's own art, the
// placeholder plate, the class emblem); each that fails to load gives way to
// the next, and the initial is what is left when none load.
export function TokenFace({
  candidates,
  name,
  className,
  enemy = false,
  width = 256,
}: {
  candidates: Array<string | null | undefined>;
  name: string;
  className?: string;
  enemy?: boolean;
  // Which of the server's smaller copies of a portrait to ask for
  // (src/lib/image-variant-url.ts): the 256 pixel one for a face on a plate,
  // a rail or a ribbon, the 1024 where the painting is shown large.
  width?: VariantWidth;
}) {
  const list = candidates.filter((src): src is string => Boolean(src));
  const key = list.join("|");
  const [attempt, setAttempt] = useState(0);
  const [shownFor, setShownFor] = useState(key);
  // A row can be reused for another combatant; start its chain again.
  if (shownFor !== key) {
    setShownFor(key);
    setAttempt(0);
  }
  const src = list[attempt];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-stone-950 font-display text-[11px] font-bold",
        enemy ? "text-red-300" : "text-amber-100",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // A face on a plate, a rail or a ribbon is a thumbnail: a smaller
          // copy the server keeps of a portrait, as the board's own tokens
          // ask for, not the full painting.
          src={variantUrl(src, width)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onError={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

// `face` is what the server found for an NPC the Cast knows (npc-faces.ts).
export type FaceLookup = (entry: { id: string; kind: string; name: string; face?: string }) => Array<string | null | undefined>;

// Top-left: the order as portrait plates, the current one framed and
// breathing. Display only; a tap opens the order (the DM's editable panel,
// or the plain list for a player). `above` is its place below the docked
// layout: a row of its own over the board, because on a phone it lay on the
// tiles of that corner, hid the figures standing there and took their taps.
export function InitiativeRail({
  encounter,
  round,
  faceOf,
  onOpen,
  namesOnly = false,
  above = false,
}: {
  encounter: PublicEncounter;
  round: number;
  faceOf: FaceLookup;
  onOpen?: () => void;
  namesOnly?: boolean;
  above?: boolean;
}) {
  if (!encounter.orderReady || !encounter.order.length) {
    return null;
  }
  // The plates whose turn it is, and the pointer's own plate: they differ
  // while the enemies before the player up next take their turns
  // (initiative-rows.ts litOrderRows).
  const lit = litOrderRows(encounter.order, encounter.turnIndex, encounter.acting, encounter.enemiesUp);
  const up = lit[0] ?? Math.max(0, pointerOrderIndex(encounter.order, encounter));
  if (namesOnly) {
    return (
      <div className="board-initiative-names" data-tour="battle-initiative">
        <button type="button" onClick={onOpen} disabled={!onOpen} aria-label={`Round ${round}, open initiative order`}>
          Round {round} · initiative
        </button>
        <ol tabIndex={0} aria-label="Initiative order">
          {encounter.order.map((entry, at) => (
            <li key={`${entry.id}-${at}`} aria-current={lit.includes(at) ? "step" : undefined} title={entry.name}>
              {entry.name}
              <SideSr side={offSide(encounter, entry.id, entry.kind)} />
            </li>
          ))}
        </ol>
      </div>
    );
  }
  // A short order is shown as it stands. A longer one is a window on the
  // cycle, starting one before the current turn, so whoever is up and whoever
  // is next are always inside it; a narrow board (a phone, the side panel)
  // shows the first NARROW of them and the enlarged board all MAX.
  const MAX = 7;
  const NARROW = 5;
  const order = encounter.order;
  const cyclic = order.length > NARROW;
  const start = cyclic ? (up - 1 + order.length) % order.length : 0;
  const shown = Array.from({ length: Math.min(MAX, order.length) }, (_, i) => {
    const at = (start + i) % order.length;
    return { entry: order[at], at };
  });
  const more = order.length - shown.length;
  const strip = (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      data-tour="battle-initiative"
      // On the board, the resting view keeps the tiles out from under it
      // (useBoardCamera.ts, camera-fit.ts).
      data-fit-clear={above || namesOnly ? undefined : ""}
      aria-label={`Round ${round}, initiative order. ${encounter.acting?.name ?? order[up]?.name ?? ""} is up. ${sidesLine(encounter)}Open the order.`}
      className={cn(
        "flex text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        above ? "min-h-10 max-w-full items-center gap-2" : "absolute left-2 top-2 z-10 flex-col items-start gap-1 @md:left-3.5 @md:top-3.5 @md:gap-1.5",
      )}
    >
      <span className="board-eyebrow">
        Round {round}
        <span className="hidden @md:inline"> · initiative</span>
      </span>
      <span className="flex gap-[3px] @md:gap-[5px]">
        {shown.map(({ entry, at }, index) => {
          const current = lit.includes(at);
          return (
            <span
              key={`${entry.id}-${at}`}
              title={`${entry.name}${entry.hidden ? " (hidden)" : ""}${entry.initiative !== undefined ? ` · ${entry.initiative}` : ""}`}
              className={cn(
                "board-plate relative block h-[38px] w-[31px] overflow-hidden rounded-[6px] border bg-[#0d0b1c] shadow-[0_2px_6px_rgba(4,2,12,0.55)] @md:h-14 @md:w-[46px] @md:rounded-[7px]",
                current ? "border-transparent" : "border-[rgba(227,193,92,0.25)]",
                !current && "opacity-80",
                index >= NARROW && "hidden @md:block",
              )}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <TokenFace
                candidates={faceOf(entry)}
                name={entry.name}
                enemy={entry.kind === "enemy"}
                className={cn("absolute inset-0 size-full", entry.hidden && "opacity-50")}
              />
              {entry.initiative !== undefined ? (
                <span className="absolute inset-x-0 bottom-0 bg-[rgba(8,6,18,0.85)] text-center font-mono text-[8px] leading-[11px] text-[#aeaac6] @md:text-[9px] @md:leading-3">
                  {entry.initiative}
                </span>
              ) : null}
              {entry.hidden ? (
                <EyeOff className="absolute right-0.5 top-0.5 size-2.5 text-amber-300 drop-shadow" aria-hidden="true" />
              ) : null}
              <SidePlateBand side={offSide(encounter, entry.id, entry.kind)} />
              {current ? (
                <span className="board-plate-current absolute inset-0 rounded-[6px] border-2 border-[#d4ab3a] @md:rounded-[7px]" />
              ) : null}
            </span>
          );
        })}
        {order.length > NARROW ? (
          <span className="board-glass flex h-[38px] items-center rounded-[6px] px-1 font-mono text-[9px] @md:hidden">
            +{order.length - NARROW}
          </span>
        ) : null}
        {more > 0 ? (
          <span className="board-glass hidden h-14 items-center rounded-[6px] px-1 font-mono text-[9px] @md:flex">
            +{more}
          </span>
        ) : null}
      </span>
    </button>
  );
  // A container narrower than @md keeps the small plates at any width (the
  // table's row is a container too): on a phone on its side every pixel of this
  // row comes off a board that is already short. A container takes no width
  // from what is in it, so it is told: the label, the plates and any "+n".
  const width = `calc(5.5rem + ${Math.min(shown.length, NARROW) * 34}px${order.length > NARROW ? " + 1.75rem" : ""})`;
  return above ? <div className="board-order-above @container max-w-full shrink-0" style={{ width }}>{strip}</div> : strip;
}

// The action economy, as the projection carries it (src/lib/db/encounter-view.ts
// turn and reactionsUsed, read by src/lib/battlemap/hand-table.ts
// turnHudBudget): the pips are drawn only for a seat that was sent one.
export type TurnHudBudget = { action: boolean; bonus: boolean; reaction: boolean };

const PIPS: Array<{ key: keyof TurnHudBudget; label: string }> = [
  { key: "action", label: "ACTION" },
  { key: "bonus", label: "BONUS" },
  { key: "reaction", label: "REACTION" },
];

// Top-right: whose turn, and on your own turn what you have left.
export function TurnHud({
  actorName,
  mine,
  commanded = false,
  budget,
  speedLeftFeet,
  ac,
  hp,
}: {
  actorName: string;
  mine: boolean;
  // The turn is a companion's this player commands.
  commanded?: boolean;
  budget?: TurnHudBudget | null;
  speedLeftFeet?: number | null;
  ac?: number | null;
  hp?: { current: number; max: number } | null;
}) {
  if (!actorName) {
    return null;
  }
  const stats = [
    typeof speedLeftFeet === "number" ? `${speedLeftFeet} ft left` : null,
    typeof ac === "number" ? `AC ${ac}` : null,
    hp ? `${hp.current}/${hp.max}` : null,
  ].filter(Boolean);
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-w-[58%] flex-col items-end gap-1 @md:right-3.5 @md:top-3.5 @md:gap-[7px]">
      <span className="board-eyebrow block max-w-full truncate text-right">{mine ? `${actorName} · ${commanded ? "your orders" : "your turn"}` : `${actorName}'s turn`}</span>
      {mine && budget ? (
        // On a narrow board the pips and the stats sit under the rail's
        // plates instead of beside them, where there is no room.
        <div className="turn-hud-pips mt-[42px] flex flex-wrap justify-end gap-1 @md:mt-0 @md:gap-1.5">
          {PIPS.map((pip) => {
            const left = budget[pip.key];
            return (
              <span
                key={pip.key}
                // The Hand's pips' colour and shape for the same cost (issue
                // 529, hand.css .turn-pip): a spent pip dims over a beat
                // instead of blinking out.
                data-cost={pip.key}
                data-left={left ? "true" : undefined}
                className="turn-pip flex items-center gap-[5px] rounded-full border px-2 py-[3px] font-mono text-[9px] tracking-[0.04em] @md:text-[10px]"
              >
                <span className="turn-pip-shape" aria-hidden="true" />
                {pip.label}
              </span>
            );
          })}
        </div>
      ) : null}
      {mine && stats.length ? (
        <div className={cn("board-glass rounded-lg px-[9px] py-1 font-mono text-[9px] @md:mt-0 @md:text-[10px]", !budget && "mt-[42px]")}>
          {stats.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

// The banner that wipes across the board when the turn changes. Keyed by the
// caller so a new turn replays it; it removes itself by ending transparent.
export function TurnBanner({ text, mine }: { text: string; mine: boolean }) {
  const ink = mine ? "#f4e0a6" : "#e9e6f4";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[42%] z-10 flex flex-col items-center gap-2" aria-hidden="true">
      <div
        className="board-banner px-[30px] py-[9px]"
        style={{
          background:
            "linear-gradient(90deg,rgba(13,11,28,0),rgba(13,11,28,.94) 18%,rgba(13,11,28,.94) 82%,rgba(13,11,28,0))",
        }}
      >
        <span
          className="block font-display text-lg font-bold tracking-[0.06em] @md:text-[26px]"
          style={{ transform: "skewX(14deg)", color: ink, textShadow: "0 2px 12px rgba(0,0,0,.8)" }}
        >
          {text}
        </span>
      </div>
      <div
        className="board-banner-rule h-px w-[220px]"
        style={{ background: `linear-gradient(90deg,transparent,${ink},transparent)` }}
      />
    </div>
  );
}

function HealthWordChip({ word }: { word: HealthWord }) {
  return (
    <span
      className="rounded-full border px-1.5 py-px text-[10px] font-medium"
      style={{ borderColor: `${HEALTH_RING[word]}99`, color: HEALTH_RING[word], background: "rgba(8,6,18,0.6)" }}
    >
      {HEALTH_LABEL[word] ?? word}
    </span>
  );
}

export function ConditionChip({ label, rounds, note }: { label: string; rounds?: number; note?: string }) {
  return (
    <span className="fx-pop inline-flex max-w-full items-center gap-1 rounded-full border border-amber-900/60 bg-amber-950/30 py-px pl-px pr-1.5 text-[10px] text-amber-300">
      <GameIcon icon={{ kind: "condition", key: conditionIconKey(label) }} size="size-4" />
      <span className="capitalize">{label}</span>
      {rounds ? ` (${rounds} rd)` : ""}
      {/* What the engine's metadata says: until whose turn, the save that
          ends it, who laid it (src/lib/battlemap/condition-notes.ts). */}
      {note ? <span className="truncate text-amber-200/70">{note}</span> : null}
    </span>
  );
}

// Cover and flanking from this player's character to the enemy under the
// plate: the board's own verdict (view-tactics.ts), the one the hit preview
// and pc_attack read.
function EdgeChips({ edge }: { edge: TargetEdge }) {
  const chips = [
    edge.blocked ? "No line of sight" : edge.cover === 5 ? "Three-quarters cover (+5 AC)" : edge.cover === 2 ? "Half cover (+2 AC)" : null,
    edge.flanking ? "Flanked: advantage in melee" : null,
    edge.hostileBeside && !edge.adjacent ? "Enemy beside you: ranged at disadvantage" : null,
  ].filter((chip): chip is string => Boolean(chip));
  if (!chips.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip} className="fx-pop rounded-full border border-sky-800/60 bg-sky-950/40 px-1.5 py-px text-[10px] text-sky-200">
          {chip}
        </span>
      ))}
    </div>
  );
}

// A condition on the hover plate: its painting large enough to read, its
// name, what it does (condition-rules.ts for the SRD's own; every other
// condition's note leads with its summary), and how long it lasts.
function ConditionRow({ id, label, rounds, note }: { id: string; label: string; rounds?: number; note?: string }) {
  const rule = conditionRule(id);
  return (
    <li className="fx-pop flex items-start gap-2 text-left">
      {/* A fixed box, so a condition with no painting keeps its text in line. */}
      <span className="flex size-10 shrink-0 items-center justify-center sm:size-12">
        <GameIcon icon={{ kind: "condition", key: conditionIconKey(label) }} size="size-10 sm:size-12" />
      </span>
      {/* The plate is dark by day too, so its golds are written out: the day
          theme turns the amber scale brown for light backgrounds
          (globals.css). */}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-[#ecd287]">
          <span className="capitalize">{label}</span>
          {rounds ? <span className="font-normal text-[rgba(244,224,166,0.8)]">{` (${rounds} rd)`}</span> : null}
        </span>
        {rule ? <span className="block text-[10px] leading-snug text-[#d8d3ea]">{rule}</span> : null}
        {note ? <span className="block text-[10px] leading-snug text-[rgba(244,224,166,0.75)]">{note}</span> : null}
      </span>
    </li>
  );
}

// The board's hover plate: what the native tooltip used to say, as a plate.
// The figure's painting large (a token shows it at a few dozen pixels, so
// this is the one place on the board the art is actually seen), then name
// and health word; beside them each condition with its painting and what it
// does, so a plate with conditions grows wider, not taller. Shown on hover;
// a click or tap (or Details on the figure's dial) pins it open.
//
// A pin the size of the figure rides in the board, under the camera; the
// plate itself is pinned to the page over it (plate-place.ts), so neither a
// short board's frame nor the camera's zoom cuts it off or scales it.
//
// A high-level fight piles buffs on debuffs, so the list comes a page at a
// time: four on a phone, six from sm up. Hovered, the plate shows the first
// page and names the rest; pinned, it pages through them.
const PAGE_NARROW = 4;
const PAGE_WIDE = 6;

export function TokenPlate({
  token,
  boardWidth,
  boardHeight,
  footprint,
  face,
  health,
  conditions,
  edge,
  anchor,
  pinned = false,
  onClose,
}: {
  token: StageToken;
  boardWidth: number;
  boardHeight: number;
  footprint: number;
  face: Array<string | null | undefined>;
  health?: HealthWord;
  conditions?: Array<{ id: string; label: string; rounds?: number; note?: string }>;
  edge?: TargetEdge;
  // Where an addon's board view drew the figure (TokenHud.tsx says how).
  anchor?: [number, number, number];
  // Held open by a click: it takes the pointer and the keyboard, pages, and
  // closes by its own button, Escape, a tap on the board or anywhere else.
  pinned?: boolean;
  onClose?: () => void;
}) {
  const pin = useRef<HTMLSpanElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [wide, setWide] = useState(false);
  const [floor, setFloor] = useState(0);
  const floorRef = useRef(0);
  const pagedRef = useRef(false);
  // Every frame while open: the camera pans and zooms, the page scrolls, the
  // window turns, and none of them re-render the plate.
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      const figure = pin.current?.getBoundingClientRect();
      const plate = plateRef.current;
      if (figure && plate) {
        // Paging, the plate keeps the height of its tallest page, so a
        // shorter last page neither moves it nor the arrows on it.
        if (pagedRef.current && plate.offsetHeight > floorRef.current) {
          floorRef.current = plate.offsetHeight;
          setFloor(plate.offsetHeight);
        }
        const next = placePlate(figure, { width: plate.offsetWidth, height: plate.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
        setSpot((current) =>
          current && current.left === next.left && current.top === next.top && current.below === next.below ? current : next,
        );
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, []);
  // The page size follows the layout's own breakpoint (Tailwind's sm).
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const read = () => setWide(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const shown = Boolean(spot);
  // Pinned: the keyboard comes to the plate once it is in place, and goes
  // back where it was when the plate closes. A press outside the plate and
  // the board closes it; the board's own taps close or move it themselves.
  useEffect(() => {
    if (!pinned || !shown) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    plateRef.current?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (plateRef.current?.contains(target) || pin.current?.parentElement?.contains(target))) return;
      closeRef.current?.();
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [pinned, shown]);

  const left = anchor ? anchor[0] * 100 : ((token.x + footprint / 2) / boardWidth) * 100;
  const top = anchor ? anchor[1] * 100 : (token.y / boardHeight) * 100;
  const height = anchor ? (anchor[2] - anchor[1]) * 100 : (footprint / boardHeight) * 100;
  const all = conditions ?? [];
  const listed = all.length > 0;
  // Three or more conditions stood in one column would run past a phone's
  // screen: on a phone the portrait shrinks to a header beside the name and
  // the list takes the plate's width; from sm up the list goes two across.
  const crowded = all.length >= 3;
  const size = wide ? PAGE_WIDE : PAGE_NARROW;
  const pages = Math.max(1, Math.ceil(all.length / size));
  // A condition that ends while the plate is open can take the last page.
  const at = Math.min(page, pages - 1);
  const onPage = all.slice(at * size, (at + 1) * size);
  const rest = pinned ? [] : all.slice(size);
  const paged = pinned && pages > 1;
  useEffect(() => {
    pagedRef.current = paged;
  });
  const pagerButton =
    "flex size-10 items-center justify-center rounded-full border border-[rgba(107,99,148,0.6)] text-[#dedbec] sm:size-8 hover:text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ecd287]";
  const plate = (
    <div
      ref={plateRef}
      role={pinned ? "dialog" : "tooltip"}
      aria-label={pinned ? `${token.name}: details` : undefined}
      tabIndex={pinned ? -1 : undefined}
      data-pinned={pinned ? "true" : undefined}
      className={cn(
        "z-[70] flex items-start gap-2 rounded-lg border bg-[rgba(8,6,18,0.94)] p-1.5 text-[#e9e6f4] shadow-elev-2 outline-none",
        pinned ? "pointer-events-auto border-[rgba(227,193,92,0.45)] pr-12 sm:pr-10" : "pointer-events-none border-[rgba(107,99,148,0.4)]",
        // Measured where it will sit, before it is shown.
        spot ? "fixed animate-fade-up" : "invisible fixed left-0 top-0",
        crowded
          ? "w-[340px] max-w-[calc(100vw-16px)] flex-col sm:w-[680px] sm:flex-row"
          : listed
            ? "w-[312px] sm:w-[380px]"
            : "w-[136px] sm:w-[172px]",
      )}
      style={spot ? { left: spot.left, top: spot.top, ...(paged && floor ? { minHeight: floor } : {}) } : undefined}
    >
      {pinned ? (
        <button type="button" onClick={() => onClose?.()} aria-label="Close" className={cn(pagerButton, "absolute right-1 top-1")}>
          <X className="size-3.5" />
        </button>
      ) : null}
      <div
        className={cn(
          "flex shrink-0 sm:w-[160px] sm:flex-col sm:items-center sm:gap-0",
          crowded ? "w-full flex-row items-center gap-2" : "w-[124px] flex-col items-center",
        )}
      >
        {/* The plates are square paintings; a square frame shows all of one. */}
        <TokenFace
          candidates={face}
          name={token.name}
          enemy={token.kind === "enemy"}
          width={1024}
          className={cn(
            "rounded-md border border-[rgba(227,193,92,0.35)] text-3xl sm:size-[160px]",
            crowded ? "size-[72px] shrink-0" : "size-[124px]",
          )}
        />
        <span className={cn("mt-1 flex min-w-0 flex-col sm:w-full sm:items-center sm:text-center", crowded ? "flex-1 items-start text-left" : "w-full items-center text-center")}>
          <span className="block max-w-full truncate font-display text-xs font-semibold">{token.name}</span>
          {health ? <HealthWordChip word={health} /> : null}
          {edge && crowded ? <EdgeChips edge={edge} /> : null}
        </span>
        {edge && !crowded ? <EdgeChips edge={edge} /> : null}
      </div>
      {listed ? (
        <div className={cn("flex min-w-0 flex-col gap-1.5", crowded ? "w-full sm:flex-1" : "flex-1")}>
          {/* Above the list, so a shorter last page does not move the arrows
              out from under the pointer. */}
          {pinned && pages > 1 ? (
            <div className="flex items-center gap-2 text-[11px] text-[#d8d3ea]">
              <button type="button" onClick={() => setPage(at - 1)} disabled={at === 0} aria-label="Previous conditions" className={pagerButton}>
                <ChevronLeft className="size-4" />
              </button>
              {/* Even digits and a set width: the next arrow holds still. */}
              <span aria-live="polite" className="min-w-[5.5rem] text-center tabular-nums">{`Page ${at + 1} of ${pages}`}</span>
              <button type="button" onClick={() => setPage(at + 1)} disabled={at === pages - 1} aria-label="Next conditions" className={pagerButton}>
                <ChevronRight className="size-4" />
              </button>
            </div>
          ) : null}
          <ul
            className={cn("min-w-0 gap-1.5", crowded ? "grid w-full grid-cols-1 sm:grid-cols-2 sm:gap-x-3" : "flex flex-col")}
            aria-label="Conditions"
          >
            {onPage.map((condition, index) => (
              <ConditionRow key={`${condition.id}-${at * size + index}`} {...condition} />
            ))}
          </ul>
          {/* Hovered, the rest are named: a click opens the plate to page them. */}
          {rest.length ? (
            <p className="text-[10px] leading-snug text-[#aeaac6]" data-plate-more>
              <span className="font-semibold text-[#ecd287]">{`+${rest.length} more: `}</span>
              <span className="capitalize">{rest.map((condition) => condition.label).join(", ")}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <>
      <span
        ref={pin}
        aria-hidden="true"
        className="pointer-events-none absolute w-px -translate-x-1/2"
        style={{ left: `${left}%`, top: `${top}%`, height: `${height}%` }}
      />
      {typeof document === "undefined" ? plate : createPortal(plate, document.body)}
    </>
  );
}

// The phone's way to pick a target: every legal one as a chip with its face,
// its health word and how far it stands. A finger covers a 32 px figure; it
// does not cover a chip.
export function TargetChips({
  targets,
  onPick,
  onHover,
}: {
  targets: Array<{
    token: StageToken;
    face: Array<string | null | undefined>;
    health?: HealthWord;
    feet: number | null;
  }>;
  onPick: (tokenId: string) => void;
  onHover?: (tokenId: string | null) => void;
}) {
  if (!targets.length) {
    return <p className="text-[11px] text-stone-500">Nobody here to aim at.</p>;
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Targets">
      {targets.map(({ token, face, health, feet }, index) => (
        <button
          key={token.id}
          type="button"
          onClick={() => onPick(token.id)}
          onPointerEnter={() => onHover?.(token.id)}
          onPointerLeave={() => onHover?.(null)}
          onFocus={() => onHover?.(token.id)}
          onBlur={() => onHover?.(null)}
          className="motion-press flex shrink-0 animate-fade-up items-center gap-1.5 rounded-full border border-ember-500/50 bg-stone-950/80 py-0.5 pl-0.5 pr-2.5 text-left hover:border-ember-500 hover:bg-red-950/30"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <TokenFace
            candidates={face}
            name={token.name}
            enemy={token.kind === "enemy"}
            className="size-8 rounded-full border border-ember-500/60"
          />
          <span className="min-w-0">
            <span className="block max-w-[9rem] truncate text-xs font-medium text-stone-100">{token.name}</span>
            <span className="block font-mono text-[10px] text-stone-400">
              {[health ? HEALTH_LABEL[health] ?? health : null, feet !== null ? `${feet} ft` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// The die on the field: the D20Spinner's geometry at board scale, six held
// faces, and the label under it. Shown while a roll is in the air for a
// commit made from the board; the number itself lands in the chronicle.
const FIELD_FACES = [17, 4, 20, 11, 8, 14];

export function FieldDie({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 fx-pop" aria-hidden="true">
      <div className="relative flex size-[72px] items-center justify-center @md:size-[104px]">
        <svg viewBox="0 0 24 24" className="absolute inset-0 size-full text-[#f9ecc8] drop-shadow-[0_0_14px_rgba(212,171,58,0.45)]">
          <g
            className="check-die-body"
            data-rolling="loop"
            fill="rgba(13,11,28,0.92)"
            stroke="currentColor"
            strokeWidth={1.1}
            strokeLinejoin="round"
            style={{ "--check-run": "4320ms" } as React.CSSProperties}
          >
            <path d="M12 2 L20.66 7 L20.66 17 L12 22 L3.34 17 L3.34 7 Z" />
            <path d="M12 6 L17 15 L7 15 Z" fill="rgba(212,171,58,0.14)" />
            <path d="M12 6 L12 2 M12 6 L20.66 7 M12 6 L3.34 7 M17 15 L20.66 17 M7 15 L3.34 17 M17 15 L12 22 M7 15 L12 22" fill="none" />
          </g>
        </svg>
        {FIELD_FACES.map((n, i) => (
          <span
            key={n}
            className="check-face absolute inset-0 flex items-center justify-center font-display text-2xl font-bold text-[#f9ecc8] @md:text-[38px]"
            style={{ animationDuration: "720ms", animationDelay: `${-i * 120}ms`, opacity: i === 0 ? 1 : 0 }}
          >
            {n}
          </span>
        ))}
      </div>
      <span className="board-eyebrow text-[10px] text-[#ecd287]">{label}</span>
    </div>
  );
}
