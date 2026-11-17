"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TILE } from "@/app/campaigns/[campaignId]/battleMapCells";
import { prefersReducedMotion } from "@/lib/effects-mode";
import { clampZoomTo, fitCamera, minZoomFor } from "@/lib/battlemap/camera-fit";
import type { CameraEvent } from "@/lib/scene/state";

// Zoom and pan for the live board (docs/vtt-parity-implementation-plan.md
// section 1.2, "Camera"): wheel at the cursor, pinch on touch, a drag on the
// ground, corner buttons, a "follow the turn" pan that eases over
// --dur-scene, and the DM's pull and lock through the `camera` event. The
// board itself is not touched; the camera is a transform on the frame
// around it. The view rests on the fit (src/lib/battlemap/camera-fit.ts):
// the whole board, whatever the shape of the window it is shown in.

export type Camera = { zoom: number; x: number; y: number };

// One mouse-wheel notch (100 pixels of scroll) zooms by 1.12; a trackpad
// pinch sends many small deltas and zooms in proportion.
const WHEEL_RATE = Math.log(1.12) / 100;
const IDENTITY: Camera = { zoom: 1, x: 0, y: 0 };
// How far a press travels before it is a drag of the view and not a tap.
const PAN_SLOP = 6;
// What a press on the board must not start a drag of the view from: a
// figure (its own drag), a control, or a surface that reads the drag itself.
const NO_PAN = "[data-token-id], [data-no-pan], button, a, input, select, textarea";

// The chrome the resting view keeps clear, a direct child of the frame
// standing in its top left corner (the docked initiative strip).
const CLEAR_SELECTOR = ":scope > [data-fit-clear]";
// Room between that chrome and the first tile.
const CLEAR_GAP = 6;

// What stands over the frame's bottom: the Hand on the fight stage, a
// sibling of the board in the stage's frame (SessionView.tsx), not a child of
// this one. The cards lie on the map and the map keeps its size under them:
// the resting view fits the whole frame, Hand or no Hand (fitted above the
// cards instead, the board shrank to a small picture every time the Hand was
// shown). What the Hand does change is where a turn is followed to: the
// figure whose turn it is is centred in what the cards leave uncovered, and
// one under them counts as off screen, so the player's own figure is never
// dealt over. The cards overlap the board by design, so the foot is what
// they cover less FOOT_LAP, and never more than FOOT_SHARE of the frame.
const STAGE_SELECTOR = "[data-fit-stage]";
const FOOT_SELECTOR = "[data-fit-foot]";
const FOOT_LAP = 24;
const FOOT_SHARE = 0.55;

function footOf(frame: HTMLElement | null): HTMLElement | null {
  return frame?.closest(STAGE_SELECTOR)?.querySelector<HTMLElement>(FOOT_SELECTOR) ?? null;
}

function footToClear(frame: HTMLElement | null): number {
  const foot = footOf(frame);
  if (!frame || !foot || !foot.offsetHeight) return 0;
  return Math.max(0, frame.getBoundingClientRect().bottom - foot.getBoundingClientRect().top - FOOT_LAP);
}

// How much of the board shows above the Hand, said on the stage for its
// stylesheet (world.css, data-foot-band). The Hand is as tall as its cards
// and the board as tall as the window leaves it, so on a laptop the strip
// above the cards can be lower than what stands in it: under BAND_CLOSE the
// camera's buttons have no room to stand in a column under the turn's own
// plate, nor End turn over them in a row, and stood on the plate or were cut
// by the board's top edge; under BAND_TIGHT the order's plates lie under
// the Hand's heading.
const BAND_CLOSE = 236;
const BAND_TIGHT = 96;
// The Hand keeps to the share of the board the camera already counts on
// (FOOT_SHARE): nothing held it there, and on a laptop a picked card's aim
// panel covered the board to its top edge (issue 992). The share is said on
// the stage (--hand-share), where the stylesheet caps the aim panel to it
// and scrolls the rest. Under SHARE_SHORT the full panel cannot fit, so the
// stylesheet lays it out in fewer rows (data-hand-share) and the cards at
// rest slide under the frame's lower edge by what the Hand is over
// (--hand-tuck), never so far that a card's name goes under it. A board
// with room for the whole Hand is left as it was.
const SHARE_SHORT = 304;
// Room kept under the lowest name.
const NAME_CLEAR = 4;
// The fan's cards lean about a point this far under their top (hand.css).
const FAN_PIVOT = 470;

// How far down the fan the lowest card name ends: by the layout, with each
// card's own lean and droop (HandCardFace.tsx), and not by the cards' boxes,
// which are still rising while they are dealt. A legendary card says its cost
// and what is left at its foot (fight-bench-2 holds them in view), so it
// counts to its foot and a fan that holds one keeps it whole.
function nameLine(fan: HTMLElement): number {
  let line = 0;
  for (const name of fan.querySelectorAll<HTMLElement>(".hand-name")) {
    const card = name.closest<HTMLElement>(".hand-card");
    const slot = card?.closest<HTMLElement>(".hand-slot");
    if (!card || !slot) continue;
    let end = name.offsetHeight;
    for (let at: HTMLElement | null = name; at && at !== card; at = at.offsetParent as HTMLElement | null) end += at.offsetTop;
    if (card.dataset.cost === "legendary") end = card.offsetHeight;
    const lean = (Math.abs(parseFloat(slot.style.getPropertyValue("--rot")) || 0) * Math.PI) / 180;
    const droop = parseFloat(slot.style.getPropertyValue("--ty")) || 0;
    line = Math.max(line, end + droop + (FAN_PIVOT - end) * (1 - Math.cos(lean)) + (card.offsetWidth / 2) * Math.sin(lean));
  }
  return parseFloat(getComputedStyle(fan).paddingTop) + line + NAME_CLEAR;
}

function clearHandMarks(stage: HTMLElement): void {
  for (const mark of ["data-foot-band", "data-hand-share", "data-hand-tuck"]) stage.removeAttribute(mark);
  for (const value of ["--hand-share", "--hand-tuck", "--turn-hud-room"]) stage.style.removeProperty(value);
}

function markFootBand(frame: HTMLElement): void {
  const stage = frame.closest<HTMLElement>(STAGE_SELECTOR);
  if (!stage) return;
  const foot = footOf(frame);
  if (!foot?.offsetHeight) {
    clearHandMarks(stage);
    return;
  }
  const share = Math.round(frame.clientHeight * FOOT_SHARE);
  const short = share < SHARE_SHORT;
  stage.style.setProperty("--hand-share", `${share}px`);
  stage.toggleAttribute("data-hand-share", short);
  // The Hand as it would stand untucked, against its share. The tuck in
  // force lowers it only while the fan is shown: a picked card folds the
  // fan away behind the aim panel.
  const fan = foot.querySelector<HTMLElement>(".hand-fan");
  const shown = fan?.offsetHeight ? fan : null;
  const whole = foot.offsetHeight + (shown ? parseFloat(stage.style.getPropertyValue("--hand-tuck")) || 0 : 0);
  const tuck = short && shown ? Math.round(Math.max(0, Math.min(whole - share, shown.offsetHeight - nameLine(shown)))) : 0;
  if (tuck) stage.style.setProperty("--hand-tuck", `${tuck}px`);
  else stage.style.removeProperty("--hand-tuck");
  stage.toggleAttribute("data-hand-tuck", tuck > 0);
  // From the Hand's foot, which does not move, so the strip is right before
  // the cards have come down by a change in the tuck.
  const band = foot.getBoundingClientRect().bottom - frame.getBoundingClientRect().top - (whole - tuck);
  if (band < BAND_CLOSE) stage.setAttribute("data-foot-band", band < BAND_TIGHT ? "tight" : "close");
  else stage.removeAttribute("data-foot-band");
  const room = band < BAND_TIGHT ? roomBesideTurnHud(frame) : null;
  if (room === null) stage.style.removeProperty("--turn-hud-room");
  else stage.style.setProperty("--turn-hud-room", `${room}px`);
}

// Under BAND_TIGHT the strip is about one row tall, and the turn's own
// heading and plate (BoardChrome.tsx TurnHud) stand at its right: the
// camera's row lay over the plate and End turn over the heading (a painted
// appearance's taller header leaves a 1366x768 window 59px of strip). The
// row moves left of whichever of them shares its height, where it fits clear
// of the round's line, and stays where it was where it does not (a narrow
// board, the order's plates drawn). On your own turn the heading gives way
// in that band (world.css), so the row has only the plate to clear.
const TURN_HUD_SELECTOR = ".board-turn-hud";
const ROW_GAP = 8;

function roomBesideTurnHud(frame: HTMLElement): number | null {
  const hud = frame.querySelector<HTMLElement>(TURN_HUD_SELECTOR);
  const row = frame.querySelector<HTMLElement>(".board-corner");
  if (!hud?.offsetWidth || !row) return null;
  const parts = [...row.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.offsetWidth > 0);
  if (!parts.length) return null;
  const boxes = parts.map((part) => part.getBoundingClientRect());
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  const need = boxes.reduce((sum, box) => sum + box.width, 0) + ROW_GAP * (boxes.length - 1);
  const frameBox = frame.getBoundingClientRect();
  // The row's height does not change with where it stands across.
  const lefts = [...hud.children]
    .map((child) => child.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.bottom > top && box.top < bottom)
    .map((box) => box.left);
  if (!lefts.length) return null;
  const room = frameBox.right - Math.min(...lefts) + ROW_GAP;
  const order = frame.querySelector<HTMLElement>("[data-tour='battle-initiative']");
  const left = order?.offsetWidth ? order.getBoundingClientRect().right + ROW_GAP : frameBox.left + ROW_GAP;
  return frameBox.right - room - need >= left ? Math.ceil(room) : null;
}

function cornerToClear(frame: HTMLElement | null): { width: number; height: number } | null {
  const corner = frame?.querySelector<HTMLElement>(CLEAR_SELECTOR);
  if (!corner || !corner.offsetWidth) return null;
  return { width: corner.offsetLeft + corner.offsetWidth + CLEAR_GAP, height: corner.offsetTop + corner.offsetHeight + CLEAR_GAP };
}

export function useBoardCamera(
  boardWidth: number,
  boardHeight: number,
  options: {
    enabled?: boolean;
    followTurn: boolean;
    turnTile: { x: number; y: number } | null;
    remote: CameraEvent | null;
    onRemoteHandled: () => void;
    // The DM steering everyone else's view is not steered themselves.
    isDirector: boolean;
  },
) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(options.enabled !== false);
  useLayoutEffect(() => { enabledRef.current = options.enabled !== false; }, [options.enabled]);
  // The frame as state too, so the native listeners below follow it when
  // the board moves between the side panel and the enlarged view (a new
  // element each time).
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera>(IDENTITY);
  // Whether a transition should ease (a pull, a follow) or snap (a wheel).
  const [eased, setEased] = useState(false);
  // True while the view rests on the fit, so a window that changes shape
  // re-fits instead of leaving the board half out of it. Any move the
  // viewer makes clears it; "Fit the board" sets it again.
  const fittedRef = useRef(true);
  // The frame's last known width, for scaling the pan on a resize (below).
  const frameWidth = useRef(0);
  // Every frame the board is drawn in right now, newest last, and the view
  // each one was last drawn with. The enlarged tabletop is a second frame
  // beside the panel's: it opens on its own fit (a wide board in the middle
  // of the window, not the panel's close-up with its top cut off, issue
  // #189), and closing it hands the panel's frame back with the view it had.
  // The view is recorded as it is drawn, never at a handover: under Strict
  // Mode a frame attaches, detaches and attaches again before anything is
  // drawn in it, and recording then would hand the new frame the old view.
  const frames = useRef<HTMLDivElement[]>([]);
  const remembered = useRef(new WeakMap<HTMLDivElement, Camera>());
  // A mirror for effects that need the camera without depending on it.
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
    if (frameRef.current && enabledRef.current) {
      remembered.current.set(frameRef.current, camera);
    }
  }, [camera]);

  const take = useCallback((element: HTMLDivElement | null) => {
    frameRef.current = element;


    setFrameEl(element);
    // A session renderer's dialog must not replace the saved flat-board camera.
    if (!enabledRef.current) return;
    // The observer below reads a fresh frame's width for itself.
    frameWidth.current = 0;
    if (!element) {
      return;
    }
    const view = remembered.current.get(element);
    if (view) {
      fittedRef.current = false;
      setEased(false);
      setCamera(view);
    } else {
      // A frame never seen rests on its fit; the observer lands it.
      fittedRef.current = true;
    }
  }, []);
  // A ref callback with a cleanup (React 19): the cleanup knows which frame
  // left, so a closing tabletop gives the panel's frame back.
  const attachFrame = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        return;
      }
      frames.current.push(element);
      take(element);
      return () => {
        frames.current = frames.current.filter((frame) => frame !== element);
        if (frameRef.current === element) {

          take(frames.current.at(-1) ?? null);
        }
      };
    },
    [take],
  );

  const [locked, setLocked] = useState(false);

  // The escape hatch opens ten seconds into a lock.
  const [canRelease, setCanRelease] = useState(false);
  useEffect(() => {
    if (!locked) {
      return;
    }
    const timer = window.setTimeout(() => setCanRelease(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [locked]);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panRef = useRef<{ id: number; x: number; y: number; cx: number; cy: number; active: boolean } | null>(null);
  // A drag of the view ends in a click on whatever lies under the pointer;
  // that click is the drag's, not a tap on a tile.
  const pannedRef = useRef(false);
  // Frame size in CSS pixels, and the scale from SVG units to pixels.

  const metrics = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) {
      return null;
    }
    const width = frame.clientWidth;
    const whole = frame.clientHeight || (width * boardHeight) / boardWidth;
    // `height` is what shows above the Hand, where a figure is centred and
    // looked for; `whole` is the frame, which the resting view fits.
    const height = Math.max(whole * (1 - FOOT_SHARE), whole - footToClear(frame));
    return { width, height, whole, unit: width / (boardWidth * TILE) };
  }, [boardWidth, boardHeight]);

  const fit = useCallback((): Camera => {
    const m = metrics();
    return m ? fitCamera({ width: m.width, height: m.whole }, { width: boardWidth, height: boardHeight }, cornerToClear(frameRef.current)) : IDENTITY;
  }, [metrics, boardWidth, boardHeight]);
  const clampZoom = useCallback((zoom: number) => clampZoomTo(zoom, minZoomFor(fit())), [fit]);

  const zoomAt = useCallback(
    (nextZoom: number, px: number, py: number) => {
      setEased(false);
      fittedRef.current = false;
      setCamera((current) => {
        const zoom = clampZoom(nextZoom);
        // Keep the point under the cursor fixed.
        const ratio = zoom / current.zoom;
        return {
          zoom,
          x: px - (px - current.x) * ratio,
          y: py - (py - current.y) * ratio,
        };
      });
    },
    [clampZoom],
  );

  const reset = useCallback(() => {
    setEased(true);
    fittedRef.current = true;
    setCamera(fit());
  }, [fit]);

  // Centre a tile in the frame at a zoom, easing over --dur-scene.
  const centreOn = useCallback(
    (tile: { x: number; y: number }, zoom?: number) => {
      const m = metrics();
      if (!m) {
        return;
      }
      setEased(!prefersReducedMotion());
      fittedRef.current = false;
      setCamera((current) => {
        const z = clampZoom(zoom ?? current.zoom);
        const tx = (tile.x + 0.5) * TILE * m.unit * z;
        const ty = (tile.y + 0.5) * TILE * m.unit * z;
        return { zoom: z, x: m.width / 2 - tx, y: m.height / 2 - ty };
      });
    },
    [metrics, clampZoom],
  );

  const isOffScreen = useCallback(
    (tile: { x: number; y: number }, cam: Camera) => {
      const m = metrics();
      if (!m) {
        return false;
      }
      const px = (tile.x + 0.5) * TILE * m.unit * cam.zoom + cam.x;
      const py = (tile.y + 0.5) * TILE * m.unit * cam.zoom + cam.y;
      const margin = TILE * m.unit * cam.zoom;
      return px < margin || py < margin || px > m.width - margin || py > m.height - margin;
    },
    [metrics],
  );

  // Follow the turn: pan to the current token when it is off screen.
  const { followTurn, turnTile } = options;
  const turnKey = turnTile ? `${turnTile.x},${turnTile.y}` : "";
  useEffect(() => {
    if (!followTurn || !turnTile) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (enabledRef.current && isOffScreen(turnTile, cameraRef.current)) {
        centreOn(turnTile);
      }
    });
    return () => cancelAnimationFrame(frame);
    // turnKey stands in for the tile's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followTurn, turnKey, centreOn, isOffScreen]);

  // The DM's camera: pull once, lock until freed, with an escape hatch
  // after ten seconds so nobody is trapped.
  const { remote, onRemoteHandled, isDirector } = options;
  useEffect(() => {
    if (!remote) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!isDirector) {
        if (remote.mode === "free") {
          setLocked(false);
          setCanRelease(false);
        } else if (typeof remote.x === "number" && typeof remote.y === "number") {
          if (enabledRef.current) centreOn({ x: remote.x, y: remote.y }, remote.zoom);
          if (remote.mode === "lock") {
            setLocked(true);
            setCanRelease(false);
          }
        }
      }
      onRemoteHandled();
    });
    return () => cancelAnimationFrame(frame);
  }, [remote, isDirector, centreOn, onRemoteHandled]);

  const release = useCallback(() => {
    setLocked(false);
    setCanRelease(false);
  }, []);

  // Pointer handling on the frame: wheel zooms at the cursor; two fingers
  // pinch; a drag on the frame background pans (a drag that starts on a
  // token is the board's, not the camera's). The wheel is a native
  // non-passive listener: React's onWheel is passive, so it could not stop
  // the panel scrolling under the zoom, nor a trackpad pinch or Ctrl+wheel
  // zooming the whole page along with the board (issue 67).
  useEffect(() => {
    if (!frameEl || locked || options.enabled === false) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frameEl.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 600 : 1);
      const factor = Math.exp(-Math.max(-100, Math.min(100, pixels)) * WHEEL_RATE);
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setEased(false);
      fittedRef.current = false;
      setCamera((current) => {
        const zoom = clampZoom(current.zoom * factor);
        const ratio = zoom / current.zoom;
        return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    frameEl.addEventListener("wheel", onWheel, { passive: false });
    return () => frameEl.removeEventListener("wheel", onWheel);
  }, [frameEl, locked, clampZoom, options.enabled]);

  // The pan is held in the frame's pixels and the board fills the frame's
  // width, so when the frame changes width (browser zoom, a resized window,
  // the enlarged view) the pan scales with it and the same part of the
  // board stays in view. Without this a zoomed-in view slid off to one side
  // on every resize (issue 67). A hidden frame (width 0) keeps the view for
  // when it shows again. A view still resting on the fit is simply fitted
  // again, which is also how a board first lands whole in a fixed window
  // (issue 87).
  useEffect(() => {

    if (!frameEl || options.enabled === false) {
      return;
    }
    // The corner's chrome comes and goes with the fight's order and changes
    // size with it: the view resting on the fit moves out from under it.
    const watched = new Set<Element>();
    const watchCorner = () => {
      const corner = frameEl.querySelector(CLEAR_SELECTOR);
      if (corner && !watched.has(corner)) {
        watched.add(corner);
        observer.observe(corner);
      }
    };
    // The Hand folds, deals and gains a reaction's row without the frame
    // changing size, and can come to the stage after the board has.
    const watchFoot = () => {
      const foot = footOf(frameEl);
      if (foot && !watched.has(foot)) {
        watched.add(foot);
        observer.observe(foot);
      }
      // The turn's heading changes width with whose turn it is, and the row
      // with Undo move, which comes after a walk.
      for (const part of frameEl.querySelectorAll(`${TURN_HUD_SELECTOR}, .board-endturn`)) {
        if (!watched.has(part)) {
          watched.add(part);
          observer.observe(part);
        }
      }
      markFootBand(frameEl);
    };
    const observer = new ResizeObserver(() => {
      watchFoot();
      if (!enabledRef.current) return;
      const width = frameEl.clientWidth;
      if (!width) {
        return;
      }
      const before = frameWidth.current;
      frameWidth.current = width;
      if (fittedRef.current) {
        const next = fit();
        setEased(false);
        setCamera((current) =>
          current.zoom === next.zoom && current.x === next.x && current.y === next.y ? current : next,
        );
        return;
      }
      if (!before || before === width) {
        return;
      }
      const ratio = width / before;
      setEased(false);
      setCamera((current) =>
        current.x || current.y ? { ...current, x: current.x * ratio, y: current.y * ratio } : current,
      );
    });
    observer.observe(frameEl);
    watchCorner();
    watchFoot();
    // The order's strip mounts once the order is rolled, after the frame.
    const mounted = new MutationObserver(watchCorner);
    mounted.observe(frameEl, { childList: true });
    return () => {
      observer.disconnect();
      mounted.disconnect();
      const stage = frameEl.closest<HTMLElement>(STAGE_SELECTOR);
      if (stage) clearHandMarks(stage);
    };
  }, [frameEl, fit, options.enabled]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pannedRef.current = false;
    const frame = frameRef.current;
    const onGround = !(event.target as HTMLElement).closest?.(NO_PAN);
    // A press on the board gives it the keyboard: a tile that handles its
    // own press would otherwise leave the arrow keys with whatever had
    // them, and nothing would say why they do nothing (issue 90).
    if (frame && onGround && document.activeElement !== frame) {
      frame.focus({ preventScroll: true });
    }
    // One pointer on the ground may drag the view. A finger does only where
    // the frame is a fixed window: elsewhere that drag scrolls the page.
    const mayPan =
      frame &&
      onGround &&
      pointers.current.size === 1 &&
      (event.pointerType === "touch"
        ? getComputedStyle(frame).touchAction === "none"
        : event.button === 0 || event.button === 1);
    panRef.current = mayPan
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y, active: false }
      : null;
    if (pointers.current.size === 2) {
      panRef.current = null;
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: 0 };
      setCamera((current) => {
        pinchRef.current = { distance: pinchRef.current?.distance ?? 1, zoom: current.zoom };
        return current;
      });
    }
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (locked) {
        return;
      }
      if (!pointers.current.has(event.pointerId)) {
        return;
      }
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2 && pinchRef.current) {
        const [a, b] = [...pointers.current.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        const zoom = clampZoom((pinchRef.current.zoom * distance) / Math.max(1, pinchRef.current.distance));
        zoomAt(zoom, mid.x, mid.y);
        event.preventDefault();
        return;
      }
      const pan = panRef.current;
      if (!pan || pan.id !== event.pointerId) {
        return;
      }
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (!pan.active) {
        if (Math.hypot(dx, dy) < PAN_SLOP) {
          return;
        }
        pan.active = true;
        pannedRef.current = true;
        fittedRef.current = false;
        frameRef.current?.setPointerCapture?.(event.pointerId);
        frameRef.current?.setAttribute("data-panning", "");
      }
      setEased(false);
      setCamera((current) => ({ ...current, x: pan.cx + dx, y: pan.cy + dy }));
    },
    [locked, zoomAt, clampZoom],
  );
  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinchRef.current = null;
    }
    panRef.current = null;
    frameRef.current?.removeAttribute("data-panning");
  }, []);
  // Capture phase, so the tile under a finished drag never hears of it.
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (pannedRef.current) {
      pannedRef.current = false;
      event.stopPropagation();
      event.preventDefault();
    }
  }, []);

  // Keyboard pans while the frame is focused; plus and minus zoom. A key
  // held with Ctrl, Cmd or Alt is the browser's (Ctrl+plus zooms the page):
  // taking it too zoomed the board along with the page, and once the page
  // reflowed and the board lost focus the zoom back out never reached it,
  // leaving a few huge tiles (issue 67).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (locked || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const step = 40;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      if (moves[event.key]) {
        event.preventDefault();
        setEased(false);
        fittedRef.current = false;
        setCamera((current) => ({
          ...current,
          x: current.x + moves[event.key][0],
          y: current.y + moves[event.key][1],
        }));
      } else if (event.key === "+" || event.key === "=") {
        const m = metrics();
        if (m) {
          zoomAt(camera.zoom * 1.2, m.width / 2, m.height / 2);
        }
      } else if (event.key === "-") {
        const m = metrics();
        if (m) {
          zoomAt(camera.zoom / 1.2, m.width / 2, m.height / 2);
        }
      } else if (event.key === "0") {
        reset();
      }
    },
    [locked, metrics, zoomAt, camera.zoom, reset],
  );

  const zoomIn = useCallback(() => {
    const m = metrics();
    if (m) {
      zoomAt(camera.zoom * 1.25, m.width / 2, m.height / 2);
    }
  }, [metrics, zoomAt, camera.zoom]);
  const zoomOut = useCallback(() => {
    const m = metrics();
    if (m) {
      zoomAt(camera.zoom / 1.25, m.width / 2, m.height / 2);
    }
  }, [metrics, zoomAt, camera.zoom]);

  // The centre tile and zoom, for the DM's "pull everyone here".
  const describe = useCallback((): { x: number; y: number; zoom: number } | null => {
    const m = metrics();
    if (!m) {
      return null;
    }
    const unit = TILE * m.unit * camera.zoom;
    return {
      x: Math.round((m.width / 2 - camera.x) / unit - 0.5),
      y: Math.round((m.height / 2 - camera.y) / unit - 0.5),
      zoom: Number(camera.zoom.toFixed(2)),
    };
  }, [metrics, camera]);

  return {
    frameRef,
    attachFrame,
    camera,
    eased,
    locked,
    canRelease,
    release,
    reset,
    zoomIn,
    zoomOut,
    centreOn,
    describe,
    frameProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
      onKeyDown,
    },
  };
}
