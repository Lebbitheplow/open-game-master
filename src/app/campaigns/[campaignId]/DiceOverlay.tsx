"use client";

import { useCallback, useEffect, useRef } from "react";
import { rollToDiceBoxNotation } from "@/lib/dice-notation";
import { diceLookKey, diceLookTheme } from "@/lib/dice/dice-look";
import {
  captureListeners,
  DICE_IDLE_MS,
  DICE_ROLL_DEADLINE_MS,
  releaseListeners,
  settleWithin,
  trayBuildAllowed,
  type CapturedListener,
} from "@/lib/dice/dice-box-lifecycle";
import { holdAfterShown, placeRoll, toastShows, trimStage, type OpenAction, type StageEntry } from "@/lib/dice/roll-stage-logic";
import { hydrateDiceLook, useDiceLook } from "@/lib/dice/dice-look-store";
import type { StoredRoll } from "@/lib/db/rolls";
import { shellHost } from "@/lib/shell-host";

// The roll stage: every roll the table hears is shown once, in the order the
// server rolled it (issue 843). With 3D dice on, a roll is thrown in a
// full-screen tray with baked physics, forced to land on the server's
// authoritative values (dice-box-threejs "2d20@12,15" notation), and handed to
// the roll toast when its dice land. A roll that is not thrown (3D dice off,
// real dice, reduced motion, a hidden tab, no WebGL) goes to the toast in its
// turn, for a short beat. The RollCard chips in chat remain the durable record.

type DiceBoxInstance = {
  initialize: () => Promise<void>;
  roll: (notation: string) => Promise<unknown>;
  clearDice: () => void;
  updateConfig: (config: Record<string, unknown>) => Promise<void>;
  renderer?: {
    dispose: () => void;
    forceContextLoss: () => void;
    domElement: HTMLCanvasElement;
  };
};

// A built tray: the box plus the window listener it registered during
// initialize(), which the library never removes on its own.
type Tray = { box: DiceBoxInstance; listeners: CapturedListener[]; overlay: Window | null; disposed?: boolean };

export type OverlayRoll = { roll: StoredRoll; source: string; seq: number };

// The native HWND covers web canvases; an owned transparent layer preserves the same renderer.
function foregroundDice(canvas?: HTMLCanvasElement): Window | null {
  const frame = document.querySelector("iframe[data-native-board-active]");
  if (!canvas || shellHost()?.platform !== "desktop" || !frame?.getClientRects().length) return null;
  let overlay: Window | null = null;
  const parent = canvas.parentElement;
  try {
    overlay = window.open("about:blank", "odm-native-dice-overlay");
    if (!overlay) return null;
    overlay.document.title = "ODM dice";
    overlay.document.documentElement.style.cssText = "width:100%;height:100%;background:transparent";
    overlay.document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:transparent";
    canvas.style.background = "transparent";
    overlay.document.body.appendChild(canvas);
    overlay.document.body.style.zoom = String(window.devicePixelRatio / overlay.devicePixelRatio);
    return overlay;
  } catch {
    parent?.appendChild(canvas);
    overlay?.close();
    return null;
  }
}

// Firefox caps live WebGL contexts (~32) and loses the oldest past that, so
// every orphaned context from an undisposed box brings the tab closer to a
// wedge; tear the renderer down whenever the overlay unmounts or the tray
// has sat idle (DICE_IDLE_MS), and take the resize listener with it so a
// later window resize never reaches a disposed renderer. It is also how a
// stuck throw is cleared (issue 668): removing the canvas is the one step
// that guarantees nothing stays drawn, whatever state the library is in.
// Safe to call twice: forceContextLoss below fires the context-lost
// listener, which disposes the same tray again.
function disposeTray(tray: Tray | null) {
  if (!tray || tray.disposed) {
    return;
  }
  tray.disposed = true;
  releaseListeners(window, tray.listeners);
  try {
    tray.box.clearDice();
  } catch {
    // Disposal must never throw during unmount.
  }
  try {
    tray.box.renderer?.dispose();
    tray.box.renderer?.forceContextLoss();
    tray.box.renderer?.domElement.remove();
  } catch {
    // Same: a half-initialized renderer is fine to abandon.
  }
  try { tray.overlay?.close(); } catch { /* The owner may already have closed. */ }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// The browser scenarios read whether a throw is on screen from the overlay's
// data-dice (scripts/browser/scenarios/106-dice-clear.mjs). A DOM write, not
// state, so it never re-renders the table.
function markTray(overlay: HTMLDivElement | null, state: "rolling" | "idle") {
  if (overlay) overlay.dataset.dice = state;
}

function newestSeq(rolls: readonly OverlayRoll[]): number {
  return rolls.reduce((top, entry) => Math.max(top, entry.seq), 0);
}

// The dice a roll throws, or null when it is shown without a throw.
function notationsFor(entry: OverlayRoll): string[] | null {
  // Real dice were thrown at the table already.
  if (entry.source === "physical") return null;
  // A blind roll reaches the table with its faces stripped
  // (src/lib/dm/viewer.ts): there is nothing to throw.
  if (!entry.roll.breakdown) return null;
  return rollToDiceBoxNotation(entry.roll.breakdown);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function DiceOverlay({
  rolls,
  enabled,
  onStage,
}: {
  // The last few rolls the stream heard, oldest first. A list rather than
  // the latest one, because an enemy's attack and damage can arrive in one
  // render and the attack's throw used to be lost (issue 668).
  rolls: readonly OverlayRoll[];
  // Whether rolls are thrown in 3D. Off, the stage still paces the toast.
  enabled: boolean;
  // The roll the toast shows now: called as each roll's dice land, or in
  // its turn when it is not thrown.
  onStage: (roll: OverlayRoll) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<Tray | null>(null);
  const idleTimerRef = useRef(0);
  const buildFailuresRef = useRef(0);
  const webglRef = useRef<boolean | null>(null);
  const queueRef = useRef<StageEntry<StoredRoll>[]>([]);
  // The action the last roll heard left open (an attack its damage joins),
  // and the action on stage now, which a backlog never cuts.
  const openRef = useRef<OpenAction>(null);
  const playingRef = useRef<number | null>(null);
  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  }, [onStage]);
  const animatingRef = useRef(false);
  // Only rolls that arrive after mount animate; the snapshot backlog and
  // reconnect replays stay silent. The watermark starts at whatever the
  // stream already holds (0 on a table nothing has rolled at yet), so the
  // first roll of a fresh table tumbles like every later one instead of
  // passing for backlog. The stage stays mounted with 3D dice off, so
  // switching them back on throws the next roll.
  const seenSeqRef = useRef<number>(newestSeq(rolls));
  const unmountedRef = useRef(false);
  // The player's own dice (src/lib/dice/dice-look.ts). The box is themed
  // from whatever the look is when it is first built, and re-themed in
  // place when the look changes, so a tweak in the editor shows on the
  // very next roll without a new WebGL context.
  const look = useDiceLook();
  const lookRef = useRef(look);
  const themedRef = useRef("");
  useEffect(() => {
    hydrateDiceLook();
  }, []);
  useEffect(() => {
    lookRef.current = look;
  }, [look]);

  const dropTray = useCallback(() => {
    const tray = trayRef.current;
    trayRef.current = null;
    themedRef.current = "";
    disposeTray(tray);
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    const alignOverlay = () => {
      const overlay = trayRef.current?.overlay;
      if (overlay && !overlay.closed) overlay.document.body.style.zoom = String(window.devicePixelRatio / overlay.devicePixelRatio);
    };
    // A hidden tab pauses requestAnimationFrame, so a throw in flight would
    // freeze mid-air and every roll after it would pile up and replay stale
    // when the seat came back (issue 668). Hidden: the waiting rolls are
    // shown without a throw, and the tray in use is dropped; the deadline
    // then releases the throw that was in flight.
    const onVisibility = () => {
      if (!document.hidden) return;
      queueRef.current = queueRef.current.map((entry) => ({ ...entry, notations: null }));
      if (animatingRef.current) dropTray();
    };
    window.addEventListener("resize", alignOverlay);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("resize", alignOverlay);
      document.removeEventListener("visibilitychange", onVisibility);
      unmountedRef.current = true;
      queueRef.current = [];
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = 0;
      dropTray();
    };
  }, [dropTray]);

  const pump = useCallback(async () => {
    if (animatingRef.current) {
      return;
    }
    queueRef.current = trimStage(queueRef.current, performance.now(), playingRef.current);
    const next = queueRef.current.shift();
    if (!next) {
      // Nothing waits: the tray is idle, and its context is let go after a
      // quiet spell like any other. Returning without this left the tray
      // marked rolling and its WebGL context held for the session.
      settleIdle();
      return;
    }
    animatingRef.current = true;
    playingRef.current = next.group;
    let shown = false;
    const show = () => {
      if (shown || unmountedRef.current) return;
      shown = true;
      onStageRef.current({ roll: next.roll, source: next.source, seq: next.seq });
    };
    try {
      const thrown = next.notations ? await throwDice(next.notations, show) : false;
      // Not thrown, or a throw that never landed: the roll still happened,
      // and the toast is where its number shows.
      show();
      if (!thrown) {
        await pause(holdAfterShown(false, queueRef.current.length));
      }
    } finally {
      animatingRef.current = false;
      if (queueRef.current.length) {
        void pump();
      } else {
        settleIdle();
      }
    }

    // Throws the dice and calls `landed` when the last of them lands, before
    // the beat it stays on screen. True when any dice were thrown (and held).
    async function throwDice(notations: readonly string[], landed: () => void): Promise<boolean> {
      markTray(overlayRef.current, "rolling");
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = 0;
      let tray: Tray | null = null;
      let wedged = false;
      let thrown = false;
      try {
        const box = await ensureBox();
        tray = trayRef.current;
        if (box && tray) {
          if (!tray.overlay || tray.overlay.closed) tray.overlay = foregroundDice(box.renderer?.domElement);
          const wanted = diceLookKey(lookRef.current);
          if (themedRef.current !== wanted) {
            // Marked themed only once the theme took, so a re-theme that
            // failed is tried again on the next roll (issue 668).
            const themed = await settleWithin(box.updateConfig(diceLookTheme(lookRef.current)), DICE_ROLL_DEADLINE_MS);
            if (themed === "done") themedRef.current = wanted;
          }
          for (const [index, notation] of notations.entries()) {
            const settled = await settleWithin(box.roll(notation), DICE_ROLL_DEADLINE_MS);
            if (settled !== "done") {
              wedged = true;
              break;
            }
            if (unmountedRef.current || trayRef.current !== tray) {
              break;
            }
            thrown = true;
            if (index === notations.length - 1) landed();
            await pause(holdAfterShown(true, queueRef.current.length));
          }
        }
      } catch {
        // A wedged animation must never block the game.
        wedged = true;
      } finally {
        // The clear always runs now (issue 668). A throw that failed or never
        // finished takes its whole tray with it: the library may be stuck
        // mid-frame, and removing the canvas is the only clear that cannot
        // itself be left half done. The next roll builds a fresh tray.
        if (tray) {
          if (wedged || tray.disposed) {
            if (trayRef.current === tray) dropTray();
            else disposeTray(tray);
          } else {
            try {
              tray.box.clearDice();
            } catch {
              if (trayRef.current === tray) dropTray();
            }
          }
        }
      }
      return thrown;
    }

    function settleIdle() {
      markTray(overlayRef.current, "idle");
      if (trayRef.current && !unmountedRef.current && !idleTimerRef.current) {
        // Nothing left to show: let the context go after a quiet spell. The
        // next roll rebuilds the tray (theme load plus WebGL init), which is
        // the same path the very first roll takes.
        idleTimerRef.current = window.setTimeout(() => {
          idleTimerRef.current = 0;
          if (animatingRef.current || queueRef.current.length) {
            return;
          }
          dropTray();
        }, DICE_IDLE_MS);
      }
    }

    async function ensureBox(): Promise<DiceBoxInstance | null> {
      if (trayRef.current) {
        return trayRef.current.box;
      }
      if (webglRef.current === null) webglRef.current = webglAvailable();
      // A failed build used to switch 3D dice off until reload, even when it
      // was only a theme texture that failed to load; it is retried once
      // now, and never on a device without WebGL (issue 668).
      if (!trayBuildAllowed(buildFailuresRef.current, webglRef.current)) {
        return null;
      }
      try {
        const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
        // Shadows stay on everywhere, phones included: Kaleb wants the full
        // look on every device (decided 2026-09-22).
        const box = new DiceBox("#dice-overlay", {
          assetPath: "/dice-box/",
          sounds: false,
          shadows: true,
          light_intensity: 0.8,
          baseScale: 85,
          ...diceLookTheme(lookRef.current),
        }) as unknown as DiceBoxInstance;
        themedRef.current = diceLookKey(lookRef.current);
        // The resize listener is added before initialize()'s first await,
        // so the capture only spans that synchronous stretch.
        const { result: ready, captured } = captureListeners(window, ["resize"], () => box.initialize());
        const tray: Tray = { box, listeners: captured, overlay: null };
        try {
          await ready;
        } catch (error) {
          disposeTray(tray);
          throw error;
        }
        if (unmountedRef.current) {
          disposeTray(tray);
          return null;
        }
        trayRef.current = tray;
        // A lost context (the GPU reset, too many contexts open) leaves a
        // dead canvas holding its last frame; drop it so the next roll
        // builds a working tray (issue 668).
        box.renderer?.domElement.addEventListener("webglcontextlost", () => {
          if (trayRef.current === tray) dropTray();
          else disposeTray(tray);
        });
        return box;
      } catch {
        buildFailuresRef.current += 1;
        return null;
      }
    }
  }, [dropTray]);

  // Switched off mid-burst: what still waits is shown without a throw.
  useEffect(() => {
    if (!enabled) queueRef.current = queueRef.current.map((entry) => ({ ...entry, notations: null }));
  }, [enabled]);

  useEffect(() => {
    const unseen = rolls.filter((entry) => entry.seq > seenSeqRef.current).sort((a, b) => a.seq - b.seq);
    if (!unseen.length) {
      return;
    }
    seenSeqRef.current = unseen[unseen.length - 1].seq;
    const now = performance.now();
    // Nobody is looking at a hidden tab: a throw would freeze with the frame
    // loop.
    const throwing = enabled && !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const entry of unseen) {
      const placed = placeRoll(openRef.current, entry.roll, entry.seq, now);
      openRef.current = placed.open;
      const notations = throwing ? notationsFor(entry) : null;
      // A blind roll has no number on this seat and nothing to throw.
      if (!notations && !toastShows(entry.roll)) {
        continue;
      }
      queueRef.current.push({ seq: entry.seq, roll: entry.roll, source: entry.source, at: now, group: placed.group, notations });
    }
    queueRef.current = trimStage(queueRef.current, now, playingRef.current);
    void pump();
  }, [rolls, enabled, pump]);

  return (
    <div
      ref={overlayRef}
      id="dice-overlay"
      data-dice="idle"
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 [&_canvas]:!bg-transparent"
    />
  );
}
