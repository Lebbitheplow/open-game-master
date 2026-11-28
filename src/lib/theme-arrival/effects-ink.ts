// The ink arrivals: drops, a brush and a spilled inkwell. Each is only a
// shape; the ink itself is painted over it by paintFrame (arrivals.ts).
import { TAU, across, blob, clamp, easeOut3, easeOut5, farthestCorner, wobbler, type Arrival, type Ring, type Scene } from "./shapes";

// Drops of ink. The first lands where the reader pressed and is the one that
// must reach the farthest corner; the others are splashes it runs into. One
// drop alone is the calm form.
export function inkDrops(count: number) {
  return ({ w, h, ox, oy, rand }: Scene): Arrival => {
    const reach = farthestCorner(ox, oy, w, h), short = Math.min(w, h), sway = 0.085;
    type Spatter = { x: number; y: number; r: number; wait: number; wobble: ReturnType<typeof wobbler> };
    type Drop = { x: number; y: number; start: number; r: number; sway: number; wobble: ReturnType<typeof wobbler>; first: boolean; spatter: Spatter[] };
    // The edge sways inward by up to `sway`, so the radius is that much over.
    const drops: Drop[] = [{ x: ox, y: oy, start: 0, r: (reach / (1 - sway)) * 1.03, sway, wobble: wobbler(rand), first: true, spatter: [] }];
    // One splash to each sixth of the screen, in a shuffled order.
    const cells: Array<[number, number, number]> = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) cells.push([i, j, rand()]);
    cells.sort((a, b) => a[2] - b[2]);
    for (let i = 1; i < count; i++) {
      const [column, row] = cells[(i - 1) % cells.length];
      drops.push({
        x: ((column + 0.15 + rand() * 0.7) / 3) * w,
        y: ((row + 0.15 + rand() * 0.7) / 2) * h,
        start: 0.04 + (0.42 * (i - 1)) / Math.max(1, count - 1) + rand() * 0.04,
        r: short * (0.16 + rand() * 0.2),
        sway: 0.09 + rand() * 0.07,
        wobble: wobbler(rand),
        first: false,
        spatter: [],
      });
    }
    for (const drop of drops) {
      const flecks = drop.first ? 10 : 3 + Math.floor(rand() * 4);
      for (let i = 0; i < flecks; i++) {
        const angle = rand() * TAU, far = short * (drop.first ? 0.09 + rand() * 0.17 : 0.05 + rand() * 0.1);
        drop.spatter.push({ x: drop.x + Math.cos(angle) * far, y: drop.y + Math.sin(angle) * far, r: short * (0.006 + rand() * 0.017), wait: 0.004 + rand() * 0.05, wobble: wobbler(rand, 3) });
      }
    }
    return {
      kind: "ink", lead: 0.08, trail: 0.2,
      shape(p) {
        const rings: Ring[] = [];
        for (const drop of drops) {
          if (p <= drop.start) continue;
          // A quick splash, then a spread that gathers pace.
          const r = drop.first
            ? drop.r * (0.06 * easeOut5(Math.min(1, p * 7)) + 0.94 * p * p)
            : drop.r * easeOut3(clamp((p - drop.start) / 0.45)) + reach * 0.22 * (p - drop.start) ** 2;
          const body = blob(drop.x, drop.y, r, drop.wobble, drop.sway, p * 4);
          if (body) rings.push(body);
          for (const fleck of drop.spatter) {
            const grown = clamp((p - drop.start - fleck.wait) / 0.07);
            const dot = grown > 0 ? blob(fleck.x, fleck.y, fleck.r * easeOut3(grown), fleck.wobble, 0.2, 0, 12) : null;
            if (dot) rings.push(dot);
          }
        }
        return rings;
      },
    };
  };
}

// A broad brush in overlapping passes, left then right. Each pass has a ragged
// leading edge (the bristles) and wavering sides.
export function brushStrokes({ w, h, rand }: Scene): Arrival {
  const short = Math.min(w, h), band = Math.max(h / 6, short * 0.3), passes = Math.ceil(h / (band * 0.7));
  const strokes = Array.from({ length: passes }, (_, i) => ({
    y: ((i + 0.5) / passes) * h,
    leftward: i % 2 === 1,
    start: i * (0.6 / passes),
    tilt: (rand() - 0.5) * 0.05,
    top: wobbler(rand, 4, 1),
    bottom: wobbler(rand, 4, 1),
    bristles: Array.from({ length: 15 }, () => rand()),
  }));
  // Each pass starts off one side and ends past the other, bristles included.
  const lasts = 0.4, from = -0.14 * w, travel = 1.34 * w, step = Math.max(6, w / 44), waver = band * 0.07;
  return {
    kind: "ink", lead: 0.07, trail: 0.17,
    shape(p) {
      const rings: Ring[] = [];
      for (const stroke of strokes) {
        const done = clamp((p - stroke.start) / lasts);
        if (done <= 0) continue;
        const front = from + (1 - (1 - done) ** 2.2) * travel, ragged = short * 0.12 * (1 - done * 0.45), count = stroke.bristles.length;
        const points: Array<[number, number]> = [];
        for (let x = from; x < front - ragged; x += step) points.push([x, stroke.y - band / 2 + waver * stroke.top((x / w) * TAU, 0)]);
        for (let j = 0; j < count; j++) points.push([front - stroke.bristles[j] * ragged - (j % 2 ? short * 0.014 : 0), stroke.y - band / 2 + (band * j) / (count - 1)]);
        for (let x = front - ragged; x > from; x -= step) points.push([x, stroke.y + band / 2 + waver * stroke.bottom((x / w) * TAU, 0)]);
        points.push([from, stroke.y + band / 2], [from, stroke.y - band / 2]);
        const cos = Math.cos(stroke.tilt), sin = Math.sin(stroke.tilt);
        const turned = points.map(([x, y]) => {
          const dx = (stroke.leftward ? w - x : x) - w / 2, dy = y - stroke.y;
          return [w / 2 + dx * cos - dy * sin, stroke.y + dx * sin + dy * cos];
        });
        // A mirrored pass winds the other way, and two passes that overlap
        // with opposite winding leave a hole where they cross.
        if (stroke.leftward) turned.reverse();
        rings.push(turned.flat());
      }
      return rings;
    },
  };
}

// Ink running down from the top edge: a slow uneven curtain with drips ahead
// of it, each drip a rounded bump that lengthens at its own speed.
export function spilledInk({ w, h, rand }: Scene): Arrival {
  const short = Math.min(w, h);
  const drips = Array.from({ length: 15 }, (_, i) => ({ x: ((i + 0.15 + rand() * 0.7) / 15) * w, width: short * (0.012 + rand() * 0.02), length: h * (0.12 + rand() * 0.42), speed: 0.7 + rand() * 0.9 }));
  const curtain = wobbler(rand, 5, 1), step = Math.max(1.5, w / 340);
  return {
    kind: "ink", lead: 0.1, trail: 0.2,
    shape(p) {
      if (p <= 0) return [];
      const fallen = p ** 1.25;
      const ring: Ring = [w + 4, -4, -4, -4];
      across(-4, w + 4, step, (x) => {
        // The slowest part of the curtain still passes the bottom edge at the end.
        let y = h * 1.5 * fallen * (0.7 + 0.15 * (1 + curtain((x / w) * TAU, 0)));
        for (const drip of drips) {
          const off = (x - drip.x) / drip.width;
          if (off > -3 && off < 3) y += Math.exp(-off * off) * drip.length * clamp(p * 1.5 * drip.speed);
        }
        ring.push(x, y);
      });
      return [ring];
    },
  };
}
