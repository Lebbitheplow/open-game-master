// Plays a theme's arrival on the page (docs/appearance-themes.md, "How a
// theme arrives"). The browser's View Transitions keep a picture of the old
// page under the live new one; each frame the new one is cut to the
// arrival's shape, and a canvas above both paints the ink, embers or foam.
//
// Everything it needs is set from here, in a stylesheet made in script and
// inline styles: the apps confine the game's stylesheet to their page column
// (the client's scripts/scope-css.mjs), where a rule about the document's own
// transition would be lost.
import type { AppearanceTheme } from "@/lib/appearance-themes";
import { readEffectsMode } from "@/lib/effects-mode";
import { overlayRoot } from "@/lib/overlay-root";
import { ARRIVALS, THEME_ARRIVALS, paintFrame } from "./arrivals";
import { brightness, clamp, hueShift, seeded, type Tones } from "./shapes";

export interface ArrivalRequest {
  theme: AppearanceTheme;
  // Writes the new theme onto the page. Called once, as the old page's
  // picture is taken, or at once where nothing can be played.
  lay: () => void;
  done: () => void;
}

const FX = "theme-arrival-fx";
const NEW_PAGE = "::view-transition-new(root)";
// What a reader who asks for less motion gets instead: a short plain fade.
const FADE_MS = 280;
// An arrival ends a little before its clock does, so the last frame drawn is
// always one that covers the screen.
const FULL_AT = 0.96;

// While an arrival plays, the whole document is one picture: the apps name
// only their page column for their own page changes (and take the document's
// name away), React names a page for its route change, and either would
// leave part of the screen out of the arrival. The canvas is its own picture,
// above the pages.
const RULES = `
:root[data-theme-arrival]{view-transition-name:root !important}
:root[data-theme-arrival] *{view-transition-name:none !important}
:root[data-theme-arrival] canvas[data-theme-arrival-fx]{view-transition-name:${FX} !important}
:root[data-theme-arrival]::view-transition-group(*),
:root[data-theme-arrival]::view-transition-image-pair(*),
:root[data-theme-arrival]::view-transition-old(*),
:root[data-theme-arrival]::view-transition-new(*){animation:none !important;mix-blend-mode:normal !important}
:root[data-theme-arrival]::view-transition-old(${FX}){display:none}
`;
let sheet: CSSStyleSheet | null = null;
function layRules() {
  if (sheet) return;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(RULES);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

// Where the reader last pressed, so the theme they pick spreads from under
// their finger. The picker loads this module as it opens, ahead of the pick.
let pressed: { x: number; y: number; at: number } | null = null;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pointerdown", (event) => { pressed = { x: event.clientX, y: event.clientY, at: performance.now() }; }, { capture: true, passive: true });
}
// A pick by keyboard starts from the focused control; a change that came from
// someone else (the GM re-themes the table) starts from the middle.
function origin(): { x: number; y: number } | null {
  if (pressed && performance.now() - pressed.at < 1500) return pressed;
  const focused = document.activeElement?.closest(".appearance-picker") ? document.activeElement : null;
  if (!focused) return null;
  const box = focused.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

const HEX = /^#[0-9a-f]{6}$/i;
function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return HEX.test(value) ? value : fallback;
}
// The new theme's accent, read off the page once it is laid. Arcane's night
// stands in for a token that is missing or not a plain hex colour.
function tones(paper: string): Tones {
  const style = getComputedStyle(overlayRoot());
  const light = token(style, "--color-amber-300", "#ecd287"), dark = token(style, "--color-amber-700", "#95761f");
  // The ramp runs the other way by day, so the brighter end is found, not assumed.
  const bright = brightness(light) > brightness(dark) ? light : dark;
  return { accent: token(style, "--color-amber-600", "#b8922a"), bright, deep: bright === light ? dark : light, second: hueShift(bright, 165), paper };
}

// The picture of the page can be taller than the window on a phone browser
// (it runs under the address bar), while the canvas fills the window. The
// arrival is laid out on the picture; the canvas is told where it sits on it.
function stage(canvas: HTMLCanvasElement) {
  const root = document.documentElement;
  try {
    const page = getComputedStyle(root, "::view-transition-group(root)"), fx = getComputedStyle(root, `::view-transition-group(${FX})`);
    const at = (transform: string) => new DOMMatrixReadOnly(transform === "none" ? "" : transform);
    const w = parseFloat(page.width), h = parseFloat(page.height), left = at(fx.transform).e - at(page.transform).e, top = at(fx.transform).f - at(page.transform).f;
    if (w > 0 && h > 0 && Number.isFinite(left) && Number.isFinite(top)) return { w, h, left, top };
  } catch {
    // An engine that will not report the pictures' boxes: the window's own.
  }
  return { w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight, left: 0, top: 0 };
}

let latest = 0;

export function runThemeArrival(request: ArrivalRequest): { skip: () => void } {
  const root = document.documentElement, turn = ++latest;
  let laid = false;
  const lay = () => {
    if (laid) return;
    laid = true;
    request.lay();
  };
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches || readEffectsMode() === "low";
  const id = THEME_ARRIVALS[request.theme], from = origin();
  // The old page's panel colour, before it changes: the back of a turned page.
  const paper = token(getComputedStyle(overlayRoot()), "--color-stone-800", "#211b3a");
  const canvas = calm ? null : document.createElement("canvas");
  if (canvas) {
    canvas.dataset.themeArrivalFx = "";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;pointer-events:none";
  }
  let frame = 0;
  let held: Animation | null = null;
  // While an arrival plays the browser draws pictures of the page, and the
  // page itself takes no press: everything lands on <html>. So a press ends
  // the arrival at once, and the click it would have made is handed to what
  // lay under it. A reader trying one theme after another is never kept
  // waiting for the last one to finish.
  const onPress = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    transition.skipTransition();
    window.addEventListener("click", (click) => {
      const under = click.target === root ? document.elementFromPoint(click.clientX, click.clientY) : null;
      if (under instanceof HTMLElement && under !== root) under.click();
    }, { capture: true, once: true });
  };
  const end = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointerdown", onPress, true);
    // It holds its last value for good otherwise, and would cut the next
    // arrival's page too: the next one's picture has the same name.
    held?.cancel();
    canvas?.remove();
    // A later arrival may already have set the mark again: it is theirs.
    if (turn === latest) delete root.dataset.themeArrival;
    lay();
    request.done();
  };
  let transition: ViewTransition;
  try {
    layRules();
    root.dataset.themeArrival = calm ? "fade" : id;
    transition = document.startViewTransition(() => {
      lay();
      // Beside <body>, not in it: a theme may hide the page's own background
      // canvas (High Kingdoms does, as "body > canvas[aria-hidden]"), and in
      // the body this one was hidden with it and the page turned with no page.
      if (canvas) root.append(canvas);
    });
  } catch {
    end();
    return { skip: () => undefined };
  }
  window.addEventListener("pointerdown", onPress, true);
  transition.finished.then(end, end);
  transition.ready.then(() => {
    if (!canvas) {
      held = root.animate({ opacity: [0, 1] }, { pseudoElement: NEW_PAGE, duration: FADE_MS, easing: "ease-out" });
      return;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    const { w, h, left, top } = stage(canvas), ratio = Math.min(window.devicePixelRatio || 1, 2), line = clamp(Math.min(w, h) / 800, 0.7, 1.3);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    g.setTransform(ratio, 0, 0, ratio, -left * ratio, -top * ratio);
    const scene = {
      w, h,
      ox: clamp((from?.x ?? window.innerWidth / 2) + left, 0, w),
      oy: clamp((from?.y ?? window.innerHeight / 2) + top, 0, h),
      rand: seeded((Math.random() * 2 ** 31) | 0),
      line, glow: line * ratio,
      tones: tones(paper),
    };
    const { ms, make } = ARRIVALS[id], arrival = make(scene);
    // One animation holds the cut for the whole arrival; each frame replaces
    // the value it holds. The page under it never restyles, as it would if
    // the cut were a variable on <html>.
    const hold = root.animate([{ clipPath: "inset(50%)" }, { clipPath: "inset(50%)" }], { pseudoElement: NEW_PAGE, duration: ms, fill: "both" });
    held = hold;
    const cut = hold.effect as KeyframeEffect;
    const draw = () => {
      // The animation's own clock, so a paused or scrubbed arrival draws the frame it is at.
      const p = clamp(Number(hold.currentTime ?? 0) / ms / FULL_AT);
      g.clearRect(left, top, canvas.clientWidth, canvas.clientHeight);
      const style = paintFrame(arrival, p, g, scene);
      cut.setKeyframes([{ ...style }, { ...style }]);
      if (hold.playState !== "finished") frame = requestAnimationFrame(draw);
    };
    draw();
  }, () => undefined);
  return { skip: () => transition.skipTransition() };
}
