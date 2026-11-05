"use client";

import {
  ArrowRightLeft,
  Crosshair,
  Eye,
  EyeOff,
  Hand,
  HandHelping,
  Heart,
  HeartCrack,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  Wind,
  Wand2,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { DIAL_CENTRE, DIAL_RADIUS, fitDial, type DialSide } from "@/lib/battlemap/dial-side";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";
import type { HudGateId } from "@/lib/battlemap/hand-hud";

// The radial HUD on a token (docs/vtt-parity-implementation-plan.md section
// 1.4). Six 40 px buttons in an arc, scaling in over --dur-quick. It is a
// shortcut, not a new path: every button is an existing composer action
// or an existing adjudication, with the target already known.
//
// Positioned in the board's own coordinate space as percentages, so it
// rides with the camera and never needs measuring.

// How far a sigil's name leans off its anchor, from -1 to 1: fully past 30
// degrees off the axis, so a diagonal name's corner, not its middle, meets
// the anchor.
function lean(component: number): number {
  return Math.max(-1, Math.min(1, component / 0.5));
}

export type HudAction = {
  id: string;
  label: string;
  icon: typeof Hand;
  tone?: "gold" | "ember" | "plain";
  // The engine's reason this cannot be done now; the sigil dims and a press
  // says why instead of composing it.
  disabled?: string | null;
  onPick: () => void;
};

export function playerActions(
  compose: (text: string) => void,
  pickTarget: (mode: "attack" | "cast") => void,
  // hudGates (src/lib/battlemap/hand-hud.ts): canAct, the turn's spends and
  // the casting state, asked the way the Hand asks them.
  gates?: Partial<Record<HudGateId, string | null>>,
  refuse?: (reason: string) => void,
): HudAction[] {
  const gate = (id: HudGateId, action: Omit<HudAction, "disabled">): HudAction => {
    const reason = gates?.[id] ?? null;
    return reason ? { ...action, disabled: reason, onPick: () => refuse?.(reason) } : action;
  };
  return [
    gate("attack", { id: "attack", label: "Attack", icon: Crosshair, tone: "ember", onPick: () => pickTarget("attack") }),
    gate("cast", { id: "cast", label: "Cast", icon: Wand2, tone: "gold", onPick: () => pickTarget("cast") }),
    gate("dodge", { id: "dodge", label: "Dodge", icon: Shield, onPick: () => compose("I take the Dodge action.") }),
    gate("dash", { id: "dash", label: "Dash", icon: Wind, onPick: () => compose("I Dash.") }),
    gate("disengage", { id: "disengage", label: "Disengage", icon: ArrowRightLeft, onPick: () => compose("I Disengage and step away.") }),
    gate("help", { id: "help", label: "Help", icon: HandHelping, onPick: () => compose("I take the Help action for ") }),
  ];
}

export function dmActions(
  token: StageToken,
  handlers: {
    hold: () => void;
    teleport: () => void;
    visibility: (hidden: boolean) => void;
    damage: () => void;
    heal: () => void;
    condition: () => void;
    remove: () => void;
  },
): HudAction[] {
  const adhoc = token.kind === "npc" || token.kind === "prop";
  const combatant = token.kind === "pc" || token.kind === "enemy";
  const actions: HudAction[] = [
    { id: "hold", label: "Pick up", icon: Hand, tone: "gold", onPick: handlers.hold },
    { id: "teleport", label: "Teleport", icon: Sparkles, onPick: handlers.teleport },
  ];
  if (token.kind !== "pc") {
    actions.push({
      id: "visibility",
      label: token.hidden ? "Reveal" : "Hide",
      icon: token.hidden ? Eye : EyeOff,
      onPick: () => handlers.visibility(!token.hidden),
    });
  }
  if (combatant) {
    actions.push(
      { id: "damage", label: "Damage", icon: HeartCrack, tone: "ember", onPick: handlers.damage },
      { id: "condition", label: "Condition", icon: Tag, onPick: handlers.condition },
    );
  }
  if (token.kind === "pc") {
    actions.push({ id: "heal", label: "Heal", icon: Heart, onPick: handlers.heal });
  }
  if (adhoc) {
    actions.push({ id: "remove", label: "Take off", icon: Trash2, tone: "ember", onPick: handlers.remove });
  }
  return actions.slice(0, 7);
}

export function TokenHud({
  token,
  boardWidth,
  boardHeight,
  footprint,
  actions,
  hint,
  onClose,
  anchor,
  camera,
}: {
  token: StageToken;
  boardWidth: number;
  boardHeight: number;
  footprint: number;
  // The board camera, to measure the dial again as it pans and zooms (an
  // addon's board view has none).
  camera?: { x: number; y: number; zoom: number };
  actions: HudAction[];
  // A line under the arc: "tap an enemy" while a target is being chosen.
  hint?: string;
  onClose: () => void;
  // Where an addon's board view drew the figure, as fractions of the board
  // (centre across, top, bottom), when it is not on the grid's square.
  anchor?: [number, number, number];
}) {
  const cx = anchor ? anchor[0] * 100 : ((token.x + footprint / 2) / boardWidth) * 100;
  const cy = anchor ? ((anchor[1] + anchor[2]) / 2) * 100 : ((token.y + footprint / 2) / boardHeight) * 100;
  // The arc opens upward, or downward near the top edge so it stays on the board.
  const flip = anchor ? cy < 100 / 3 : token.y < boardHeight / 3;
  // Then, measured where the figure sits in the frame on screen, away from
  // an edge it would cross: near the right edge it no longer runs under the
  // camera buttons (dial-side.ts).
  //
  // The dial rides inside the camera's layer, so the camera's zoom scaled it:
  // zoomed out to a third, a 40px sigil drew at 13px. It undoes the zoom about
  // the figure's centre, so it keeps its size on screen at any zoom while it
  // still rides with the figure as the board pans.
  const centre = useRef<HTMLDivElement>(null);
  // Zoomed in, the figure grows and the sigils do not, so the arc widens to
  // clear it, as far as the frame has room (fitDial).
  const [fit, setFit] = useState<{ side: DialSide; zoom: number; radius: number; fits: boolean; close: number } | null>(null);
  // Again whenever the figure or the camera moves: a pan or a zoom changes
  // where the figure sits on screen without the figure moving.
  const [panX, panY, camZoom] = [camera?.x, camera?.y, camera?.zoom];
  const across = anchor ? anchor[2] - anchor[1] : footprint / boardWidth;
  useLayoutEffect(() => {
    const at = centre.current?.getBoundingClientRect();
    const view = centre.current?.closest(".board-view");
    const box = view?.getBoundingClientRect();
    // The camera buttons stand inside the frame's right edge: room on the
    // right ends where they begin.
    const cams = view?.querySelector(".board-cam")?.getBoundingClientRect();
    const frame = box && { left: box.left, top: box.top, bottom: box.bottom, right: cams?.width ? Math.min(box.right, cams.left) : box.right };
    // The camera's zoom: the dial's layer on screen against its own size.
    const layer = centre.current?.parentElement;
    const shown = layer?.getBoundingClientRect();
    const zoom = layer && shown && layer.offsetWidth ? shown.width / layer.offsetWidth : 1;
    if (!at || !frame || !shown || !(zoom > 0)) return;
    // The figure's half-width on screen (an addon's anchor is a share of
    // the board's height).
    const half = ((anchor ? shown.height : shown.width) * across) / 2;
    // Its size undone, the dial reaches the same on screen at any zoom.
    const next = fitDial({ x: at.left, y: at.top }, frame, half);
    setFit((current) =>
      current && current.side === next.side && current.radius === next.radius && current.fits === next.fits && current.close === next.close && Math.abs(current.zoom - zoom) < 0.001
        ? current
        : { ...next, zoom },
    );
  }, [cx, cy, panX, panY, camZoom, across, anchor]);
  const side = fit?.side ?? (flip ? "down" : "up");
  const radius = fit?.radius ?? DIAL_RADIUS;
  const spread = Math.min(Math.PI, actions.length * 0.52);
  const middle = DIAL_CENTRE[side];
  const start = middle - spread / 2;
  // Close sits across the figure from the arc, drawn in to stay inside the
  // frame (dial-side.ts); the hint keeps above or below.
  const closeReach = fit?.close ?? radius + 16;
  const closeAt = { x: -Math.cos(middle) * closeReach, y: -Math.sin(middle) * closeReach };
  const hintBelow = side === "down" || (side !== "up" && flip);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      role="menu"
      aria-label={`Actions for ${token.name}`}
      data-dial-side={side}
      data-dial-radius={radius}
      data-dial-fits={fit ? String(fit.fits) : undefined}
    >
      <div
        ref={centre}
        className="absolute"
        style={{
          left: `${cx}%`,
          top: `${cy}%`,
          width: 0,
          height: 0,
          // About its own point, the figure's centre (it has no size).
          ...(fit && fit.zoom !== 1 ? { scale: String(1 / fit.zoom), transformOrigin: "0 0" } : {}),
        }}
      >
        {actions.map((action, index) => {
          const angle = start + (actions.length === 1 ? spread / 2 : (index / (actions.length - 1)) * spread);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const Icon = action.icon;
          return (
            <button
          data-native-board-occluder
              key={action.id}
              type="button"
              role="menuitem"
              title={action.disabled ?? action.label}
              aria-label={action.disabled ? `${action.label}: ${action.disabled}` : action.label}
              aria-disabled={action.disabled ? "true" : undefined}
              data-refused={action.disabled ? "true" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                action.onPick();
              }}
              className={cn(
                // The Dial's sigil: a dark glass disc with a lit rim, the same
                // on the painted board in both themes. A refused one dims
                // (token-sigil[data-refused] in board.css eases it) but still
                // takes the press, which says why.
                "token-sigil pointer-events-auto fx-pop absolute flex size-10 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border shadow-elev-2 backdrop-blur",
                action.disabled
                  ? "border-[rgba(107,99,148,0.4)] text-[#6f6a8c]"
                  : action.tone === "gold"
                    ? "border-[rgba(212,171,58,0.75)] text-[#ecd287]"
                    : action.tone === "ember"
                      ? "border-[rgba(224,112,58,0.75)] text-[#ffbe8f]"
                      : "border-[rgba(143,138,171,0.6)] text-[#dedbec]",
              )}
              style={{
                left: x,
                top: y,
                animationDelay: `${index * 22}ms`,
              }}
            >
              <Icon className="size-4" />
              <span className="sr-only">{action.label}</span>
            </button>
          );
        })}
        <button
              data-native-board-occluder
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          className="token-sigil pointer-events-auto fx-pop absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(107,99,148,0.6)] text-[#aeaac6] hover:text-white"
          style={{ left: closeAt.x, top: closeAt.y }}
        >
          <X className="size-3.5" />
        </button>
        {hint ? (
          <p
            data-native-board-occluder
            className="fx-pop pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md border border-[rgba(224,112,58,0.5)] bg-[rgba(13,11,28,0.94)] px-2 py-0.5 text-[11px] text-[#ffbe8f] shadow-elev-1"
            style={{ left: 0, top: hintBelow ? radius + 18 : -radius - 30 }}
          >
            {hint}
          </p>
        ) : null}
        {actions.map((action, index) => {
          const angle = start + (actions.length === 1 ? spread / 2 : (index / (actions.length - 1)) * spread);
          // Just beyond the sigil's rim, and anchored by the side that faces
          // it: a name beside a sigil starts (or ends) there, one above it
          // sits on it. Centred on a fixed radius, a name to either side ran
          // back under its own sigil ("Pick up", "Details").
          const x = Math.cos(angle) * (radius + 24);
          const y = Math.sin(angle) * (radius + 24);
          return (
            <span
              data-native-board-occluder
              key={`label-${action.id}`}
              // Each name arrives with its sigil, on the same stagger.
              className="fx-pop pointer-events-none absolute whitespace-nowrap font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-[#dedbec] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              style={{
                left: x,
                top: y,
                // A diagonal name is held by its corner nearest the sigil, a
                // name straight above or beside one by the middle of its edge.
                translate: `${-50 + 50 * lean(Math.cos(angle))}% ${-50 + 50 * lean(Math.sin(angle))}%`,
                animationDelay: `${index * 22}ms`,
              }}
            >
              {action.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
