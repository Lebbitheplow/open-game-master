"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, EyeOff, GripVertical, Maximize2, Minimize2, PanelBottom, PictureInPicture2, Plus, Undo2, type LucideIcon } from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/locale";
import { GameIcon } from "@/components/ui/GameIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { HeaderGlyph } from "@/app/campaigns/[campaignId]/SessionGlyph";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { CHRONICLE_MAX, CHRONICLE_MIN, setLocked, type PaneId } from "@/lib/table-layout";
import { useTableLayoutApi } from "@/app/campaigns/[campaignId]/table-layout-context";
import type { TableTabId } from "@/lib/dm/table-tabs";
import {
  resetTableLayout,
  saveTableLayout,
  setArranging,
  useLayoutSession,
  useTableLayout,
  type LayoutSeat,
} from "@/app/campaigns/[campaignId]/table-layout-store";

// The end of a press wherever the pointer is let go: the element's own
// pointerup as a rule, but the window's too, for a path that loses the
// capture on the way (a button released outside the app, input the
// platform makes up). Returns the way to stop listening.
export function onRelease(handler: (event: globalThis.PointerEvent) => void): () => void {
  window.addEventListener("pointerup", handler, true);
  window.addEventListener("pointercancel", handler, true);
  return () => {
    window.removeEventListener("pointerup", handler, true);
    window.removeEventListener("pointercancel", handler, true);
  };
}

// A mouse that moves with no button down was let go where nothing heard it.
export function released(event: { pointerType: string; buttons: number }): boolean {
  return event.pointerType === "mouse" && event.buttons === 0;
}

// A line between two panels that moves (client issue 46): dragged with a
// pointer or a finger, or stepped with the arrow keys, Home and End, the
// window splitter of the ARIA patterns. It owns no layout: it reports the
// length it would give the panel it moves, live while it is held (at most
// once a frame) and once more when it is let go.
export function Splitter({
  orientation,
  label,
  value,
  min,
  max,
  sign = 1,
  focusable,
  className,
  style,
  onStart,
  onPreview,
  onCommit,
}: {
  // "vertical" stands between two columns and moves sideways.
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  // -1 when the panel it moves lies after it (left of the line grows
  // the panel on the right).
  sign?: 1 | -1;
  focusable: boolean;
  className?: string;
  style?: CSSProperties;
  // Called as a drag or a key press begins; a measured length returned
  // here is where the drag starts from.
  onStart: () => number | void;
  onPreview: (length: number) => void;
  onCommit: (length: number) => void;
}) {
  const drag = useRef<{ pointer: number; start: number; last: number; frame: number; stop: () => void } | null>(null);
  const [held, setHeld] = useState(false);
  const along = (event: { clientX: number; clientY: number }) => (orientation === "vertical" ? event.clientX : event.clientY);
  const fit = (length: number) => Math.min(max, Math.max(min, length));
  // Let go: the length is where the pointer was let go, saved once.
  const finish = (event?: { clientX: number; clientY: number }) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    current.stop();
    if (current.frame) cancelAnimationFrame(current.frame);
    if (event) current.last = fit(current.start + sign * (along(event) - current.pointer));
    setHeld(false);
    onCommit(current.last);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    const back = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    let next: number;
    const keys = [forward, back, "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const measured = onStart();
    const from = typeof measured === "number" ? measured : value;
    if (event.key === forward) next = from + sign * step;
    else if (event.key === back) next = from - sign * step;
    else next = event.key === "Home" ? min : max;
    onCommit(fit(next));
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={focusable ? 0 : -1}
      className={cn("tlay-split", className)}
      data-held={held ? "" : undefined}
      style={style}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const measured = onStart();
        const start = typeof measured === "number" ? measured : value;
        drag.current = { pointer: along(event), start, last: start, frame: 0, stop: onRelease((up) => finish(up)) };
        setHeld(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current) return;
        if (released(event)) {
          finish();
          return;
        }
        current.last = fit(current.start + sign * (along(event) - current.pointer));
        if (!current.frame) {
          current.frame = requestAnimationFrame(() => {
            if (drag.current !== current) return;
            current.frame = 0;
            onPreview(current.last);
          });
        }
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={() => finish()}
      onLostPointerCapture={() => finish()}
    />
  );
}

// The line between the fight stage's scroll and its board (issue 213's
// full-height column): dragged, or stepped with the arrow keys, it gives
// the scroll the width that reads best. Kept with the rest of the
// arrangement; the board beside it always keeps 320px (TableLayout.tsx).
export function ChronicleSplitter() {
  const t = useT();
  const api = useTableLayoutApi();
  const [bounds, setBounds] = useState({ value: 0, max: CHRONICLE_MAX });
  if (!api?.active || api.locked) return null;
  const measure = () => {
    const chronicle = document.querySelector<HTMLElement>(".cine-chat-staged > .cine-fight > .cine-chronicle");
    const stage = chronicle?.closest<HTMLElement>(".cine-chat-staged");
    const value = chronicle ? Math.round(chronicle.getBoundingClientRect().width) : (api.chronicle ?? CHRONICLE_MIN);
    // The stage's 12px of padding and the board's 320px.
    const max = stage ? Math.max(CHRONICLE_MIN, Math.min(CHRONICLE_MAX, stage.clientWidth - 332)) : CHRONICLE_MAX;
    setBounds({ value, max });
    return value;
  };
  return (
    <Splitter
      orientation="vertical"
      label={t("Resize the chronicle")}
      value={bounds.value || api.chronicle || CHRONICLE_MIN}
      min={CHRONICLE_MIN}
      max={bounds.max}
      focusable={api.editing}
      className="tlay-split-stage"
      onStart={measure}
      onPreview={api.previewChronicle}
      onCommit={(width) => {
        setBounds((current) => ({ ...current, value: width }));
        api.commitChronicle(width);
      }}
    />
  );
}

// A floating pane's corner, to resize it by: dragged, or stepped with the
// arrow keys. TableRow owns what a drag and a step do.
export function FloatCorner({
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onStep,
}: {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onStep: (dir: "left" | "right" | "up" | "down", large: boolean) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="tlay-corner"
      aria-label={t("Resize {name}", { name: label })}
      title={t("Drag to resize it, or use the arrow keys")}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onPointerDown(event);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        const dir = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[
          event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
        ];
        if (!dir) return;
        event.preventDefault();
        onStep(dir, event.shiftKey);
      }}
    />
  );
}

// The handlers a movable bar's grip carries; TableRow owns what they do.
export type GripHandlers = {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

export type PaneActions = {
  maximized: boolean;
  onMaximize: () => void;
  onFloat?: () => void;
  onDock?: () => void;
  onHide?: () => void;
  onReturn?: () => void;
};

function BarButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Tooltip content={label} side="bottom">
      <button type="button" aria-label={label} className="tlay-act motion-press" onClick={onClick}>
        <Icon className="size-3.5" />
      </button>
    </Tooltip>
  );
}

// The strip along a pane's top: its name, a grip to move it by (when it
// may move), and its few verbs. Drawn while the table is being arranged,
// on a floating pane, on a tab's own pane, and on a maximized one.
export function PaneBar({
  label,
  glyph,
  tour,
  grip,
  actions,
}: {
  label: string;
  glyph: string;
  // The tab's tour anchor, so a tour step about the tab finds its pane.
  tour?: string;
  grip: GripHandlers | null;
  actions: PaneActions;
}) {
  const t = useT();
  const title = (
    <>
      {grip ? <GripVertical className="size-3.5 shrink-0 opacity-70" /> : null}
      <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-5" className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <div className="tlay-bar" data-tour={tour}>
      {grip ? (
        <button
          type="button"
          className="tlay-grip"
          aria-label={t("Move {name}", { name: label })}
          aria-roledescription={t("movable panel")}
          title={t("Drag to move it, or use the arrow keys")}
          {...grip}
        >
          {title}
        </button>
      ) : (
        <span className="tlay-grip" data-still="">
          {title}
        </span>
      )}
      {actions.onFloat ? <BarButton label={t("Float {name}", { name: label })} icon={PictureInPicture2} onClick={actions.onFloat} /> : null}
      {actions.onDock ? <BarButton label={t("Dock {name}", { name: label })} icon={PanelBottom} onClick={actions.onDock} /> : null}
      <BarButton
        label={actions.maximized ? t("Restore the layout") : t("Maximize {name}", { name: label })}
        icon={actions.maximized ? Minimize2 : Maximize2}
        onClick={actions.onMaximize}
      />
      {actions.onReturn ? <BarButton label={t("Put {name} back in the side panel", { name: label })} icon={Undo2} onClick={actions.onReturn} /> : null}
      {actions.onHide ? <BarButton label={t("Hide {name}", { name: label })} icon={EyeOff} onClick={actions.onHide} /> : null}
    </div>
  );
}

// Over the row while it is being arranged: how it works, the tabs that can
// have a pane of their own, the panes set aside, Reset and Done.
export function ArrangeBar({
  tabs,
  setAside,
  onAdd,
  onShow,
  onReset,
  onDone,
}: {
  tabs: Array<{ id: TableTabId; label: string; icon: LucideIcon }>;
  setAside: Array<{ id: PaneId; label: string }>;
  onAdd: (tab: TableTabId) => void;
  onShow: (id: PaneId) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const t = useT();
  return (
    <div className="tlay-arrange" role="region" aria-label={t("Arrange the table", { context: "table.layout.arrange" })}>
      <p className="tlay-arrange-hint">
        {t("Drag a panel by its bar: onto another panel's edge to sit beside it, onto its middle to swap the two, or to either end of the row. Drag the lines between panels to resize them. Everything keeps running while you do.")}
      </p>
      {tabs.length ? (
        <div className="tlay-arrange-group">
          <span className="tlay-arrange-label">{t("Give a tab its own pane")}</span>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className="tlay-chip motion-press" onClick={() => onAdd(id)}>
              <Plus className="size-3" />
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {setAside.length ? (
        <div className="tlay-arrange-group">
          <span className="tlay-arrange-label">{t("Set aside")}</span>
          {setAside.map(({ id, label }) => (
            <button key={id} type="button" className="tlay-chip motion-press" onClick={() => onShow(id)}>
              {t("Show {name}", { name: label })}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tlay-arrange-end">
        <button type="button" className="tlay-chip motion-press" onClick={onReset}>
          {t("Reset")}
        </button>
        <button type="button" className="tlay-chip tlay-chip-gold motion-press" onClick={onDone}>
          <Check className="size-3.5" />
          {t("Done", { context: "action.done" })}
        </button>
      </div>
    </div>
  );
}

// The header's layout menu: arrange, lock, reset. A wide window only; a
// phone keeps its bottom bar and has nothing to arrange.
export function LayoutMenu({ seat }: { seat: LayoutSeat }) {
  const t = useT();
  const layout = useTableLayout(seat);
  const { editing } = useLayoutSession();
  const row = "session-menu-row";
  const hint = (text: ReactNode) => <span className="session-menu-hint">{text}</span>;
  return (
    <div className="hidden lg:flex">
      <DropdownMenu.Root>
        <Tooltip content={t("Arrange the table: move, resize and lock its panels")} side="bottom">
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t("Table layout")}
              data-tour="header-layout"
              className={headerButtonClass(editing)}
            >
              <HeaderGlyph glyph="system-maps" />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="panel z-50 min-w-60 rounded-lg p-1">
            {layout.locked ? null : (
              <DropdownMenu.Item className={row} onSelect={() => setArranging(!editing)}>
                <GameIcon icon={{ kind: "glyph", key: "ui-edit" }} size="size-6" />
                <span>
                  {editing ? t("Done arranging") : t("Arrange the table", { context: "table.layout.arrange" })}
                  {hint(t("Move, resize, hide and add panels"))}
                </span>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.CheckboxItem
              checked={layout.locked}
              onCheckedChange={(locked) => {
                saveTableLayout(seat, (current) => setLocked(current, locked));
                if (locked) setArranging(false);
              }}
              className={row}
            >
              <span className="flex size-4 items-center justify-center">
                <DropdownMenu.ItemIndicator>
                  <Check className="size-3.5 text-amber-300" />
                </DropdownMenu.ItemIndicator>
              </span>
              <span>
                {t("Lock layout")}
                {hint(t("Nothing moves or resizes until it is unlocked"))}
              </span>
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Separator className="my-1 h-px bg-stone-700/60" />
            <DropdownMenu.Item className={row} onSelect={() => resetTableLayout(seat)}>
              <GameIcon icon={{ kind: "glyph", key: "ui-restore" }} size="size-6" />
              <span>
                {t("Reset layout")}
                {hint(t("Back to the table's own arrangement"))}
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
