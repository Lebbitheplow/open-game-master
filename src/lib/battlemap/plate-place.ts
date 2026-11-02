// Where the board's hover plate sits on screen. The plate used to ride
// inside the board, so the board's frame cut it off whenever the board was
// shorter than the plate (an inline board is often under 200px tall), and
// the camera's zoom scaled its words. Now it is pinned to the page over the
// figure: below the figure when there is room there, above it otherwise, and
// kept a margin inside the window either way.
//
// Pure, so scripts/test-token-plate.mjs can drive it.

export type ScreenBox = { left: number; top: number; right: number; bottom: number };

const GAP = 6;
const MARGIN = 8;

export function placePlate(
  figure: ScreenBox,
  plate: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number; below: boolean } {
  const roomBelow = view.height - figure.bottom - GAP - MARGIN;
  const roomAbove = figure.top - GAP - MARGIN;
  const below = roomBelow >= plate.height || roomBelow >= roomAbove;
  const top = below ? figure.bottom + GAP : figure.top - GAP - plate.height;
  const middle = (figure.left + figure.right) / 2;
  return {
    left: clamp(middle - plate.width / 2, MARGIN, view.width - plate.width - MARGIN),
    top: clamp(top, MARGIN, view.height - plate.height - MARGIN),
    below,
  };
}

// The low edge wins when the window is narrower than the plate.
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}
