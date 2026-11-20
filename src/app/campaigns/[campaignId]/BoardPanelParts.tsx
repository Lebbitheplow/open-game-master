"use client";

import { extraTurnTag, litOrderRows } from "@/lib/battlemap/initiative-rows";
import { Keyboard, LocateFixed, Lock, Maximize2, Unlock, Users, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/locale";
import { TILE_FEET } from "@/lib/battlemap/types";
import { playingSheet } from "@/lib/battlemap/hand-table";

import { TokenFace, type FaceLookup } from "@/app/campaigns/[campaignId]/BoardChrome";
import { DmInitiativePanel } from "@/app/campaigns/[campaignId]/DmInitiativePanel";
import { offSide, SideBadge } from "@/app/campaigns/[campaignId]/SideBadge";
import type { PublicEncounter } from "@/lib/db/encounter-view";

// Two pieces of BattleMapPanel that carry no state of their own, split out so
// the panel stays readable: the camera buttons in the board's corner, and the
// order the initiative rail opens.

const CAMERA_BUTTON =
  "motion-press rounded-md border border-stone-700/80 bg-stone-950/85 p-1 text-stone-300 hover:text-stone-100";

// The short form, shown for a few seconds each time the board takes the
// keyboard (board.css fades it), so the keys are learned by using the board
// and not by hunting for a help page. Hidden where there is no keyboard to
// speak of.
export function BoardKeyStrip() {
  const t = useT();
  return (
    <div className="board-keys-strip" aria-hidden="true">
      <span>
        <span className="kbd-key">←</span>
        <span className="kbd-key">↑</span>
        <span className="kbd-key">↓</span>
        <span className="kbd-key">→</span> {t("move", { context: "board.strip.move" })}
      </span>
      <span>
        <span className="kbd-key">+</span>
        <span className="kbd-key">−</span> {t("zoom")}
      </span>
      <span>
        <span className="kbd-key">0</span> {t("fit")}
      </span>
    </div>
  );
}

// Camera controls: corner buttons for everyone, the follow toggle for a
// player in a fight, and the DM's pull, lock and free.
export function BoardCameraControls({
  onZoomIn,
  onZoomOut,
  onFit,
  followTurn,
  onFollowTurn,
  onDirect,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  // Null when this seat has no follow toggle (the DM, or a scene board).
  followTurn: boolean | null;
  onFollowTurn: () => void;
  // Present for the DM seat only.
  onDirect?: (mode: "pull" | "lock" | "free") => void;
}) {
  const [keysOpen, setKeysOpen] = useState(false);
  const t = useT();
  // What the board does with the keyboard and the mouse (issue 90). The keys
  // only reach the board while it has focus, so the list says that first.
  const BOARD_KEYS: Array<{ keys: string[]; does: string }> = [
    { keys: ["←", "↑", "↓", "→"], does: t("Move the view") },
    { keys: ["+", "−"], does: t("Zoom in and out") },
    { keys: ["0"], does: t("Fit the whole board") },
    { keys: ["Esc"], does: t("Cancel an aim or a drag") },
    { keys: ["Ctrl", "Z"], does: t("Take back your last move") },
    { keys: ["Scroll"], does: t("Zoom at the pointer") },
    { keys: ["Drag"], does: t("Move the view") },
  ];
  return (
    <div className={cn("board-cam absolute bottom-2 right-2 z-10 flex flex-col gap-1", onDirect && "board-cam-long")}>
      {keysOpen ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the note only catches Escape from inside it to close; the button that opened it is the control
        <div
          id="board-keys-card"
          role="note"
          className="board-keys-card"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setKeysOpen(false);
            }
          }}
        >
          <p className="board-eyebrow mb-1.5">{t("Board controls")}</p>
          <dl>
            {BOARD_KEYS.map((row) => (
              <div key={row.keys.join()}>
                <dt>
                  {row.keys.map((key) => (
                    <span key={key} className="kbd-key">
                      {key}
                    </span>
                  ))}
                </dt>
                <dd>{row.does}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-[10px] leading-snug text-[#8f8aab]">
            {t("The keys work while the board is lit: click it, or Tab to it.")}
          </p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setKeysOpen((open) => !open)}
        aria-label={t("Board keys and mouse controls")}
        aria-expanded={keysOpen}
        aria-controls="board-keys-card"
        title={t("Keys and mouse controls")}
        className={cn(CAMERA_BUTTON, "board-keys-button", keysOpen && "border-amber-600/80 text-amber-200")}
      >
        <Keyboard className="size-4" />
      </button>
      <button type="button" onClick={onZoomIn} aria-label={t("Zoom in")} className={CAMERA_BUTTON}>
        <ZoomIn className="size-4" />
      </button>
      <button type="button" onClick={onZoomOut} aria-label={t("Zoom out")} className={CAMERA_BUTTON}>
        <ZoomOut className="size-4" />
      </button>
      <button type="button" onClick={onFit} aria-label={t("Fit the board")} className={CAMERA_BUTTON}>
        <Maximize2 className="size-4" />
      </button>
      {followTurn !== null ? (
        <button
          type="button"
          onClick={onFollowTurn}
          aria-pressed={followTurn}
          aria-label={t("Follow the turn")}
          title={t("Follow the turn")}
          className={cn(
            "motion-press rounded-md border p-1",
            followTurn
              ? "border-amber-600/80 bg-amber-950/70 text-amber-200"
              : "border-stone-700/80 bg-stone-950/85 text-stone-400 hover:border-amber-500/50 hover:text-amber-100 hover:shadow-glow-gold",
          )}
        >
          <LocateFixed className="size-4" />
        </button>
      ) : null}
      {onDirect ? (
        <>
          <button
            type="button"
            title={t("Pull everyone here")}
            aria-label={t("Pull everyone to this view")}
            onClick={() => onDirect("pull")}
            className="motion-press rounded-md border border-amber-700/70 bg-stone-950/85 p-1 text-amber-200 hover:bg-amber-950/60"
          >
            <Users className="size-4" />
          </button>
          <button
            type="button"
            title={t("Lock everyone to my view")}
            aria-label={t("Lock everyone to this view")}
            onClick={() => onDirect("lock")}
            className={CAMERA_BUTTON}
          >
            <Lock className="size-4" />
          </button>
          <button
            type="button"
            title={t("Free everyone's view")}
            aria-label={t("Free everyone's view")}
            onClick={() => onDirect("free")}
            className={CAMERA_BUTTON}
          >
            <Unlock className="size-4" />
          </button>
        </>
      ) : null}
    </div>
  );
}

// The rail on the board is display only; a tap opens the order itself: the
// DM's editable panel, the plain list for everyone else.
export function BoardOrderDialog({
  open,
  onOpenChange,
  campaignId,
  encounter,
  round,
  canDirect,
  faceOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  encounter: PublicEncounter | null;
  round: number;
  canDirect: boolean;
  faceOf: FaceLookup;
}) {
  const t = useT();
  return (
    <Dialog
      open={open && Boolean(encounter)}
      onOpenChange={onOpenChange}
      title={t("Initiative, round {n}", { n: round })}
      width="w-[min(94vw,26rem)]"
    >
      {encounter && canDirect ? (
        <DmInitiativePanel campaignId={campaignId} encounter={encounter} faceOf={faceOf} />
      ) : encounter ? (
        <ol className="space-y-1">
          {encounter.order.map((entry, index, order) => (
            <li
              key={`${entry.id}-${index}`}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1 text-sm",
                litOrderRows(order, encounter.turnIndex, encounter.acting, encounter.enemiesUp).includes(index)
                  ? "border-amber-700 bg-amber-950/40 text-amber-100"
                  : "border-stone-800 text-stone-300",
              )}
            >
              <TokenFace
                candidates={faceOf(entry)}
                name={entry.name}
                enemy={entry.kind === "enemy"}
                className="size-7 rounded-full border border-stone-700"
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}{entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300" title={extraTurnTag(entry)?.title}>{extraTurnTag(entry)?.short}</sup> : null}</span>
              <SideBadge side={offSide(encounter, entry.id, entry.kind)} />
              {litOrderRows(order, encounter.turnIndex, encounter.acting, encounter.enemiesUp).includes(index) ? (
                <span className="text-[10px] uppercase tracking-wide text-amber-300">{t("up now")}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Dialog>
  );
}

// The line under the board saying what a tap does now, for the DM's tools
// and for a player's turn. Split from BattleMapPanel.tsx.
// Pure logic: the translator comes in as the first argument (the agoLabel
// pattern), so the caller's locale picks the words.
export function boardHintText(
  t: (key: string, vars?: Record<string, string | number>) => string,
  input: {
    canDirect: boolean;
    tool: string;
    teleporting: boolean;
    held: boolean;
    liveOrigin: boolean;
    pointing: boolean;
    drawing: boolean;
    targeting: boolean;
    canMove: boolean;
    // A first tap aimed the walk; the second makes it.
    moveAimed: boolean;
    scene: boolean;
    budgetLeft: number;
    hasToken: boolean;
  },
): string {
  const { canDirect, tool, teleporting, held, liveOrigin, pointing, drawing, targeting, canMove, scene } = input;
  return canDirect
    ? tool === "draw"
      ? t("Drag to draw. Everyone sees it; it is a plan, not a fact.")
      : teleporting
      ? t("Tap the tile it appears on. No path, no movement spent.")
      : held
        ? t("Tap where it should stand. The round's movement is not charged for this.")
        : tool === "measure"
          ? liveOrigin
            ? t("Now tap where it points.")
            : t("Tap where the area starts.")
          : tool === "point"
            ? t("Tap a tile and everyone looks at it.")
            : tool === "place"
              ? t("Name it, then tap a tile.")
              : t("Tap a piece for its actions. Nothing here is charged against the round.")
    : pointing
      ? t("Tap a tile to point at it.")
      : drawing
        ? t("Drag to draw. The table sees it; erase it when the plan changes.")
      : targeting
        ? t("Tap the enemy.")
        : canMove && input.moveAimed
          ? t("Tap the same tile again to move there. Tap another to change course, or press Esc.")
        : canMove
          ? scene
            ? t("Tap anywhere you can walk, then tap it again to go. Nothing is being counted out here.")
            : t("Tap a highlighted tile to see the path, then again to move ({ft} ft left this turn). Tap your figure for actions.", { ft: input.budgetLeft * TILE_FEET })
          : input.hasToken
            ? t("You can move on your turn. The shroud shows what your character cannot see.")
            : t("You have no token on this field.");
}

// The turn order under the board, the pointer's entry lit; a thief's second
// turn in round 1 is marked (Thief's Reflexes). Split from BattleMapPanel.tsx.
export function BoardOrderStrip({ encounter, faceOf }: { encounter: PublicEncounter | null | undefined; faceOf: FaceLookup }) {
  const t = useT();
  if (!encounter?.orderReady) return null;
  // Whose turn it is (initiative-rows.ts litOrderRows), not only the pointer.
  const lit = litOrderRows(encounter.order, encounter.turnIndex, encounter.acting, encounter.enemiesUp);
  return (
    <ol className="board-order-strip flex flex-wrap gap-1 text-[11px] text-stone-400">
      {encounter.order.map((entry, index) => (
        <li
          key={`${entry.id}-${index}`}
          className={cn(
            "flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2",
            lit.includes(index) ? "bg-amber-950/60 font-medium text-amber-300" : "bg-stone-900",
          )}
        >
          <TokenFace
            candidates={faceOf(entry)}
            name={entry.name}
            enemy={entry.kind === "enemy"}
            className={cn(
              "size-5 rounded-full border",
              lit.includes(index) ? "border-amber-500" : "border-stone-700",
            )}
          />
          {entry.name}
          {entry.hidden ? ` ${t("(hidden)", { context: "board.hiddenMark" })}` : ""}
          {entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300" title={extraTurnTag(entry)?.title}>{extraTurnTag(entry)?.short}</sup> : null}
        </li>
      ))}
    </ol>
  );
}

// Which of their characters a player runs, for the enlarged tabletop: the
// dialog covers the Party panel's Play as, so the choice is offered here too
// (issue #189). Nothing for a player with one character, or a table that
// seats one each. The switch is the same request the Party panel sends; the
// stream's roster_updated moves the Hand, the HUD and the board after it.
export function PlayAsStrip({
  campaignId,
  sheets,
  meUserId,
  activeSheetId,
  multiCharacter,
}: {
  campaignId: string;
  sheets: Array<{ id: string; name: string; userId: string; isCompanion?: boolean }>;
  meUserId: string;
  activeSheetId: string;
  multiCharacter: string;
}) {
  const [switching, setSwitching] = useState("");
  const t = useT();
  const own = sheets.filter((sheet) => sheet.userId === meUserId && !sheet.isCompanion);
  if (!meUserId || multiCharacter === "off" || own.length < 2) {
    return null;
  }
  const playing = playingSheet(sheets, meUserId, activeSheetId);
  async function playAs(sheetId: string) {
    setSwitching(sheetId);
    try {
      await fetch(`/api/campaigns/${campaignId}/sheet/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: sheetId }),
      });
    } finally {
      setSwitching("");
    }
  }
  return (
    <div role="radiogroup" aria-label={t("Playing as")} data-pill-group="" className="flex items-center gap-1">
      <span className="eyebrow mr-1 text-[9px] text-stone-400">{t("Playing as")}</span>
      {own.map((sheet) => {
        const current = playing?.id === sheet.id;
        return (
          <button
            key={sheet.id}
            type="button"
            role="radio"
            aria-checked={current}
            aria-disabled={switching === sheet.id}
            data-on={current ? "" : undefined}
            onClick={() => {
              if (!current && switching !== sheet.id) void playAs(sheet.id);
            }}
            className={cn(
              "motion-press rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-[var(--dur-quick,150ms)]",
              current
                ? "border-amber-500/60 bg-amber-400/10 text-amber-200"
                : "border-stone-700 text-stone-300 hover:border-amber-500/60 hover:text-amber-200",
              switching === sheet.id && "opacity-50",
            )}
          >
            {sheet.name}
          </button>
        );
      })}
    </div>
  );
}
