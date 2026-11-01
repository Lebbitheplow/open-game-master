// Which way a figure's dial (TokenHud.tsx) fans out, read from where the
// figure sits in the board's frame on screen. The dial rides inside the
// board, under the frame's own chrome (the camera buttons down the right,
// the initiative strip across the top), and the frame clips it, so a dial
// that fans up from a figure near the right edge ran its last sigils and
// their names under the zoom buttons. It now opens away from an edge it
// would cross: left near the right edge, right near the left, and up or
// down, as before, where both sides have room.
//
// Pure, so scripts/test-dial-side.mjs can drive it.

export type DialSide = "up" | "down" | "left" | "right";

// How far a sigil's name reaches from the figure's centre: the arc's radius,
// the name's offset beyond it, and a long name ("Condition") laid outward.
export const DIAL_REACH = 150;

// `zoom` is the board camera's: the dial rides inside the zoomed layer, so on
// screen it reaches that much further.
export function dialSide(
  figure: { x: number; y: number },
  frame: { left: number; top: number; right: number; bottom: number },
  zoom = 1,
): DialSide {
  const reach = DIAL_REACH * zoom;
  const room = {
    left: figure.x - frame.left,
    right: frame.right - figure.x,
    top: figure.y - frame.top,
    bottom: frame.bottom - figure.y,
  };
  if (room.left >= reach && room.right >= reach) {
    return room.top >= reach || room.top >= room.bottom ? "up" : "down";
  }
  return room.left >= room.right ? "left" : "right";
}

// The middle of the arc, in radians, for each side (screen y runs down).
export const DIAL_CENTRE: Record<DialSide, number> = {
  up: -Math.PI / 2,
  down: Math.PI / 2,
  left: Math.PI,
  right: 0,
};
