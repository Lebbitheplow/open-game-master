// Whether a set of squares can stand in one cone from an origin square
// (SRD 5.1, Areas of Effect, Cone: "A cone's width at a given point along
// its length is equal to that point's distance from the point of origin"),
// so its sides open at atan(1/2) either way of its line. A creature counts
// when any part of its square is inside: each square gets the half-square of
// slack its edge gives at its distance. Pure: the counter saves
// (counter-saves.ts) ask it of the creatures a breath names, which before
// this were each checked as a radius, so one breath caught creatures 30 feet
// south and 25 feet north at once.
export type Point = { x: number; y: number };

const HALF_ANGLE = Math.atan(0.5);

export function fitsOneCone(origin: Point, points: Point[]): boolean {
  const arcs = points
    .map((point) => ({ dx: point.x - origin.x, dy: point.y - origin.y }))
    .filter(({ dx, dy }) => dx !== 0 || dy !== 0)
    .map(({ dx, dy }) => ({ angle: Math.atan2(dy, dx), slack: Math.atan(0.5 / Math.hypot(dx, dy)) }));
  if (arcs.length < 2) {
    return true;
  }
  // The cone's line may point anywhere: try it along each creature's edge,
  // and see whether every other one falls inside the opening.
  const width = 2 * HALF_ANGLE;
  const norm = (angle: number) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return arcs.some((start) => {
    const from = start.angle - start.slack;
    return arcs.every((arc) => norm(arc.angle - arc.slack - from) <= width || norm(arc.angle + arc.slack - from) <= width || norm(from - (arc.angle - arc.slack)) <= 2 * arc.slack);
  });
}
