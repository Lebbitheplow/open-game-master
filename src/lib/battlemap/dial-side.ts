// Which way a figure's dial (TokenHud.tsx) fans out, and how wide, read from
// where the figure sits in the board's frame on screen. The dial rides
// inside the board, under the frame's own chrome (the camera buttons down
// the right, the initiative strip across the top), and the frame clips it,
// so a dial that fans up from a figure near the right edge ran its last
// sigils and their names under the zoom buttons. It now opens away from an
// edge it would cross: up where there is room above and to both sides, down
// where there is room below, else left or right.
//
// The dial undoes the camera's zoom, so its sigils and names keep their size
// on screen; zoomed in, the figure grows and the arc widens to clear it, as
// far as the frame has room for.
//
// Pure, so scripts/test-dial-side.mjs can drive it.

export type DialSide = "up" | "down" | "left" | "right";

// The arc's radius around a figure of an ordinary size, on screen.
export const DIAL_RADIUS = 56;

// Past the radius: a name laid outward to the side ("Condition", ~70px past
// a 24px gap), and a name above or below a sigil (the gap and its height).
const NAME_ACROSS = 94;
const NAME_UP = 40;
// Close sits across the figure from the arc (TokenHud.tsx), a 28px round
// centred 16px past the radius where the frame has the room.
const CLOSE_GAP = 16;
const CLOSE_HALF = 14;

// The radius that clears a figure: its half-width on screen and a gap wide
// enough for the condition badges along its rim.
export function dialRadius(figureHalf: number): number {
  return Math.max(DIAL_RADIUS, Math.round(figureHalf + 28));
}

type Box = { left: number; top: number; right: number; bottom: number };

function roomAround(figure: { x: number; y: number }, frame: Box) {
  return { left: figure.x - frame.left, right: frame.right - figure.x, top: figure.y - frame.top, bottom: frame.bottom - figure.y };
}

// Whether a dial of this radius fits on this side: an arc up or down spans
// side to side, one left or right spans top to bottom.
function fits(side: DialSide, radius: number, room: ReturnType<typeof roomAround>): boolean {
  const across = radius + NAME_ACROSS;
  const up = radius + NAME_UP;
  switch (side) {
    case "up":
      return room.top >= up && room.left >= across && room.right >= across;
    case "down":
      return room.bottom >= up && room.left >= across && room.right >= across;
    case "left":
      return room.left >= across && room.top >= up && room.bottom >= up;
    case "right":
      return room.right >= across && room.top >= up && room.bottom >= up;
  }
}

// The side and radius for a dial on a figure `figureHalf` wide (half its
// width on screen). The widest arc that clears the figure and fits, on the
// first side it fits: up, down, then towards the roomier side. When none
// fits even at the ordinary radius (a frame smaller than the dial), the
// ordinary arc on the side with the most room; `fits` says which it was.
export function fitDial(
  figure: { x: number; y: number },
  frame: Box,
  figureHalf = 0,
): { side: DialSide; radius: number; fits: boolean; close: number } {
  const room = roomAround(figure, frame);
  const sideways: DialSide = room.left >= room.right ? "left" : "right";
  const order: DialSide[] = ["up", "down", sideways, sideways === "left" ? "right" : "left"];
  for (let radius = dialRadius(figureHalf); radius >= DIAL_RADIUS; radius -= 2) {
    const side = order.find((option) => fits(option, radius, room));
    if (side) return { side, radius, fits: true, close: closeReach(side, radius, room) };
  }
  const level = room.left >= DIAL_RADIUS + NAME_ACROSS && room.right >= DIAL_RADIUS + NAME_ACROSS;
  const side: DialSide = level ? (room.top >= room.bottom ? "up" : "down") : sideways;
  return { side, radius: DIAL_RADIUS, fits: false, close: closeReach(side, DIAL_RADIUS, room) };
}

// How far across the figure from the arc Close sits: its usual gap past the
// radius, drawn in to stay whole inside the frame. Cut off by the frame it
// was out of reach, and the keyboard's focus on it scrolled the frame, which
// an overflow-hidden board never scrolls back.
function closeReach(side: DialSide, radius: number, room: ReturnType<typeof roomAround>): number {
  const far = { up: room.bottom, down: room.top, left: room.right, right: room.left }[side];
  return Math.max(0, Math.min(radius + CLOSE_GAP, far - CLOSE_HALF - 2));
}

// The middle of the arc, in radians, for each side (screen y runs down).
export const DIAL_CENTRE: Record<DialSide, number> = {
  up: -Math.PI / 2,
  down: Math.PI / 2,
  left: Math.PI,
  right: 0,
};
