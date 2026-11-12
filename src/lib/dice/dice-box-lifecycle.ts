// The parts of the 3D dice tray's lifecycle that are plain logic: catching
// the window listener dice-box-threejs adds during initialize() and never
// removes, the idle window after which an unused tray is torn down, and the
// deadline that keeps a stuck throw from staying drawn on the page. The order
// rolls are shown in, and which wait, is roll-stage-logic.ts.
//
// The library calls window.addEventListener("resize", ...) synchronously
// inside initialize(), before its first await, with no matching remove. A
// disposed box therefore keeps a listener that calls setDimensions on a
// dead renderer, and every rebuild stacks another. Wrapping the call for
// exactly that synchronous stretch captures the handler without patching
// the package.

type ListenerTarget = Pick<Window, "addEventListener" | "removeEventListener">;

export type CapturedListener = {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

// Runs `start` with the target's addEventListener wrapped, restores it as
// soon as `start` returns (synchronously, so nothing else that mounts during
// the library's later awaits is caught), and hands back what was added.
export function captureListeners<T>(
  target: ListenerTarget,
  types: readonly string[],
  start: () => T,
): { result: T; captured: CapturedListener[] } {
  const captured: CapturedListener[] = [];
  const original = target.addEventListener;
  const wrapped: Window["addEventListener"] = function (
    this: unknown,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener && types.includes(type)) {
      captured.push({ type, listener, options });
    }
    // The DOM accepts a null listener as a no-op; the lib typing does not.
    return original.call(target, type, listener as EventListenerOrEventListenerObject, options);
  };
  target.addEventListener = wrapped;
  try {
    const result = start();
    return { result, captured };
  } finally {
    target.addEventListener = original;
  }
}

export function releaseListeners(target: ListenerTarget, captured: CapturedListener[]): void {
  for (const entry of captured) {
    target.removeEventListener(entry.type, entry.listener, entry.options);
  }
  captured.length = 0;
}

// How long a tray sits unused before its WebGL context and canvas go. The
// next roll pays theme load plus context creation again (a few hundred
// milliseconds on a phone), so this is well past a normal pause between
// rolls but short enough that a table left idle stops holding a context.
export const DICE_IDLE_MS = 30_000;

// dice-box-threejs settles roll() only from inside its own animation-frame
// loop: if that loop stops (a frame throws, the tab is hidden, clearDice
// lands mid-throw, the WebGL context is lost) the promise never settles.
// The overlay used to await it bare, so one wedged throw kept its dice drawn
// on the canvas for the rest of the session and every later roll queued
// behind it (issue 668). A normal throw lands in two to four seconds; the
// library's own frame cap (1000 frames) is about 17, so ten seconds is
// generous for a real throw and short enough that a stuck one clears.
export const DICE_ROLL_DEADLINE_MS = 10_000;

// A failed tray build is retried once (a theme texture that failed to load
// is often a passing network blip). A device with no WebGL never retries.
export const DICE_INIT_TRIES = 2;

export type Settled = "done" | "failed" | "timeout";

type Timers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// Waits for `promise` but never longer than `ms`, and never rejects: the
// caller learns whether the throw finished, failed, or ran out of time, so
// its clean-up always runs.
export function settleWithin(
  promise: Promise<unknown>,
  ms: number,
  timers: Timers = realTimers,
): Promise<Settled> {
  return new Promise<Settled>((resolve) => {
    let open = true;
    const finish = (outcome: Settled) => {
      if (!open) {
        return;
      }
      open = false;
      timers.clear(handle);
      resolve(outcome);
    };
    const handle = timers.set(() => finish("timeout"), ms);
    promise.then(
      () => finish("done"),
      () => finish("failed"),
    );
  });
}

// Whether the overlay may try to build a tray again after `failures`
// failed builds.
export function trayBuildAllowed(failures: number, webgl: boolean): boolean {
  return webgl && failures < DICE_INIT_TRIES;
}
