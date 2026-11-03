// The board's resting view (issue 87). The board is laid out as wide as the
// frame around it. Where the frame is as tall as the board (a phone held
// upright, a side panel with room) that is the whole board and the resting
// view is the plain one. Where the frame is a fixed window (the fight stage,
// the enlarged tabletop, the shared screen, the side panel or a phone on a
// short screen) a tall board would run out of the bottom, so the resting
// view shrinks it until all of it shows and centres it; a wide board in a
// window taller than it sits in the middle of the window rather than along
// its top edge with the table bare beneath (issue 189, the enlarged board).
// Chrome in the frame's top left corner is kept clear (fitCamera's `clear`).


export type FitCamera = { zoom: number; x: number; y: number };

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 3;

// `clear` is the frame's top left corner the chrome stands in (the docked
// initiative strip, BoardChrome.tsx), measured from the frame's own corner.
// A board that fills the frame's width or height put its first tiles under
// the strip, where a figure was hidden and a tap opened the order (PR 770
// moved the strip off the board below the docked layout; this is the
// docked one). The resting view then sits below the corner or beside it,
// whichever leaves the board larger.
export function fitCamera(
  frame: { width: number; height: number },
  board: { width: number; height: number },
  clear?: { width: number; height: number } | null,
): FitCamera {
  if (frame.width <= 0 || frame.height <= 0 || board.width <= 0 || board.height <= 0) {
    return { zoom: 1, x: 0, y: 0 };
  }
  // The board's height in frame pixels at zoom 1.
  const tall = (frame.width * board.height) / board.width;
  let fit: FitCamera;
  // A pixel of slack: a frame sized by its own board rounds either way.
  if (tall <= frame.height + 1) {
    fit = { zoom: 1, x: 0, y: Math.max(0, (frame.height - tall) / 2) };
  } else {
    const zoom = frame.height / tall;
    fit = { zoom, x: (frame.width - frame.width * zoom) / 2, y: 0 };
  }
  if (!clear || clear.width <= 0 || clear.height <= 0 || fit.x >= clear.width || fit.y >= clear.height) {
    return fit;
  }
  // Below the corner: the height under it, centred in the whole frame when
  // that already clears it.
  const belowZoom = Math.min(1, Math.max(0, frame.height - clear.height) / tall);
  const below = {
    zoom: belowZoom,
    x: (frame.width - frame.width * belowZoom) / 2,
    y: Math.max(clear.height, (frame.height - tall * belowZoom) / 2),
  };
  // Beside it: the width right of it.
  const besideZoom = Math.min(Math.max(0, frame.width - clear.width) / frame.width, frame.height / tall);
  const beside = {
    zoom: besideZoom,
    x: Math.max(clear.width, (frame.width - frame.width * besideZoom) / 2),
    y: Math.max(0, (frame.height - tall * besideZoom) / 2),
  };
  const best = below.zoom >= beside.zoom ? below : beside;
  // A frame too small for both keeps the plain fit: a board shrunk to
  // nothing helps no one.
  return best.zoom > 0 ? best : fit;
}

// The furthest out a view may go: the usual floor, or the fit when a tall
// board in a short window needs to go further to show whole.
export function minZoomFor(fit: FitCamera): number {
  return Math.min(MIN_ZOOM, fit.zoom);
}

export function clampZoomTo(zoom: number, floor: number): number {
  return Math.min(MAX_ZOOM, Math.max(floor, zoom));
}
