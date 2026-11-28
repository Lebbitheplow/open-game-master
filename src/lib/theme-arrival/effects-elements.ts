// The arrivals made of weather and fire: a burning page, a rising tide,
// creeping frost and a watercolor wash.
import { TAU, across, alpha, blob, clamp, easeOut3, easeOut5, farthestCorner, lerp, tracePath, wobbler, type Arrival, type Ring, type Scene, type SoftSpot } from "./shapes";

// The old page burns away from where the reader pressed, and from two more
// places that catch a moment later. The edge is a char band and an ember
// line, with sparks rising off the first fire.
export function burningPage(scene: Scene): Arrival {
  const { w, h, ox, oy, rand } = scene, reach = farthestCorner(ox, oy, w, h), short = Math.min(w, h), sway = 0.12;
  const fires = [
    { x: ox, y: oy, start: 0, r: (reach / (1 - sway)) * 1.03, first: true },
    // Small beside the first: larger ones had the page burnt through half way.
    { x: rand() * w, y: rand() * h, start: 0.2, r: reach * 0.28, first: false },
    { x: rand() * w, y: rand() * h, start: 0.36, r: reach * 0.24, first: false },
  ].map((fire) => {
    // A slow wander with a fast flicker on top.
    const slow = wobbler(rand, 5), fast = wobbler(rand, 6, 9);
    return { ...fire, wobble: (angle: number, phase: number) => 0.7 * slow(angle, phase * 0.4) + 0.3 * fast(angle, phase * 3) };
  });
  const radius = (fire: (typeof fires)[number], p: number) =>
    fire.first ? fire.r * (0.05 * easeOut5(Math.min(1, p * 8)) + 0.95 * p ** 1.35) : fire.r * easeOut3(clamp((p - fire.start) / 0.55));
  const sparks = Array.from({ length: 80 }, () => ({ angle: rand() * TAU, born: rand() * 0.85, life: 0.1 + rand() * 0.12, drift: rand() - 0.5, size: rand() }));
  return {
    kind: "cut",
    shape(p) {
      const rings: Ring[] = [];
      for (const fire of fires) {
        const ring = p > fire.start ? blob(fire.x, fire.y, radius(fire, p), fire.wobble, sway, p * 10, 140) : null;
        if (ring) rings.push(ring);
      }
      return rings;
    },
    paint(g, p, rings) {
      if (!rings.length) return;
      const edge = tracePath(rings), first = fires[0], { line, glow } = scene;
      g.save();
      g.lineJoin = "round";
      g.strokeStyle = "rgba(18,8,3,.92)"; g.shadowColor = "rgba(25,10,2,.95)"; g.shadowBlur = 22 * glow; g.lineWidth = 22 * line; g.stroke(edge);
      g.strokeStyle = "#ffae42"; g.shadowColor = "#ff5a14"; g.shadowBlur = 16 * glow; g.lineWidth = 5 * line; g.stroke(edge);
      g.strokeStyle = "#fff1c9"; g.shadowBlur = 4 * glow; g.lineWidth = 2 * line; g.stroke(edge);
      // Only the outer half of each line stays: where two fires overlap, the
      // outline of one would otherwise cross the other's clean new page. The
      // fill is set here: rubbing out with whatever colour the last thing
      // painted left behind (a fading spark) rubbed out almost nothing.
      g.shadowBlur = 0; g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.fill(edge);
      g.restore();
      g.save();
      for (const spark of sparks) {
        const age = (p - spark.born) / spark.life;
        if (age <= 0 || age >= 1) continue;
        const from = radius(first, spark.born) * (1 + sway * first.wobble(spark.angle, spark.born * 10));
        const x = first.x + Math.cos(spark.angle) * from + spark.drift * short * 0.06 * age, y = first.y + Math.sin(spark.angle) * from - short * 0.1 * age * (0.5 + spark.size);
        g.fillStyle = `rgba(255,${150 + Math.round(spark.size * 80)},60,${0.35 * (1 - age)})`;
        g.beginPath(); g.arc(x, y, (2.5 + spark.size * 3) * line, 0, TAU); g.fill();
        g.fillStyle = `rgba(255,236,170,${1 - age})`;
        g.beginPath(); g.arc(x, y, (0.8 + spark.size * 1.2) * line, 0, TAU); g.fill();
      }
      g.restore();
    },
  };
}

// A wave rolling up the page: two swells ahead of it in the new accent, a
// white crest, and bubbles under the crest.
export function risingTide(scene: Scene): Arrival {
  const { w, h, rand } = scene, swell = Math.min(w, h) * 0.045, offset = rand() * TAU, step = Math.max(2, w / 220);
  const bubbles = Array.from({ length: 50 }, () => ({ x: rand() * w, depth: rand(), size: rand(), beat: rand() * TAU }));
  // The water laps: it never falls back, but it surges twice on the way up.
  const lap = (p: number) => p + 0.028 * Math.sin(p * TAU * 2);
  const crest = (x: number, p: number, shift = 0) =>
    h + swell - (h + 2.3 * swell) * lap(p) + swell * 0.6 * Math.sin((x / w) * TAU * 1.4 + p * 10 + offset + shift) + swell * 0.4 * Math.sin((x / w) * TAU * 3.1 - p * 15 + offset * 2 + shift * 1.7);
  const line = (p: number, shift: number, lift: number) => {
    const points: number[] = [];
    across(-4, w + 4, step, (x) => points.push(x, crest(x, p, shift) - lift));
    return points;
  };
  const stroke = (g: CanvasRenderingContext2D, points: number[]) => {
    g.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      if (i) g.lineTo(points[i], points[i + 1]);
      else g.moveTo(points[i], points[i + 1]);
    }
  };
  return {
    kind: "cut",
    shape(p) {
      return p <= 0 ? [] : [[-4, h + 6, ...line(p, 0, 0), w + 4, h + 6]];
    },
    paint(g, p) {
      if (p <= 0 || p >= 1) return;
      const water = line(p, 0, 0), { tones } = scene, thick = scene.line;
      const backwards: number[] = [];
      for (let i = water.length - 2; i >= 0; i -= 2) backwards.push(water[i], water[i + 1]);
      g.save();
      g.lineJoin = "round";
      for (const [shift, lift, opacity] of [[1.3, swell * 1.5, 0.2], [0.6, swell * 0.7, 0.3]]) {
        stroke(g, [...line(p, shift, lift), ...backwards]);
        g.closePath(); g.fillStyle = alpha(tones.accent, opacity); g.fill();
      }
      stroke(g, water); g.strokeStyle = alpha(tones.deep, 0.5); g.lineWidth = 6 * thick; g.stroke();
      stroke(g, water); g.strokeStyle = "rgba(255,255,255,.92)"; g.lineWidth = 2.8 * thick; g.stroke();
      stroke(g, line(p, 0.2, -8 * thick)); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1.6 * thick; g.stroke();
      for (const bubble of bubbles) {
        g.fillStyle = `rgba(255,255,255,${0.55 * Math.abs(Math.sin(p * 26 + bubble.beat))})`;
        g.beginPath(); g.arc(bubble.x, crest(bubble.x, p) + (5 + bubble.depth * 44) * thick, (1 + bubble.size * 2.2) * thick, 0, TAU); g.fill();
      }
      g.restore();
    },
  };
}

// Ice grows in from the edges and closes on a point between the middle of the
// screen and where the reader pressed. The shape is the whole screen with a
// hole in it; the hole's outline is a ring of shards that shrinks.
export function frostCreep(scene: Scene): Arrival {
  const { w, h, ox, oy, rand } = scene, steps = 320, cx = lerp(w / 2, ox, 0.5), cy = lerp(h / 2, oy, 0.5);
  // How far ahead of the rest each direction runs: 36 shards of random width.
  const shard = new Float32Array(steps), tips: number[] = [];
  for (let k = 0; k < 36; k++) {
    const at = Math.floor(rand() * steps), half = 2 + Math.floor(rand() * 7), height = 0.25 + rand() * 0.75;
    if (height > 0.55) tips.push(at);
    for (let j = -half; j <= half; j++) {
      const i = (at + j + steps) % steps;
      shard[i] = Math.max(shard[i], height * (1 - Math.abs(j) / half));
    }
  }
  const rays: Array<[number, number, number]> = [];
  for (let i = 0; i < steps; i++) {
    shard[i] += rand() * 0.1;
    const angle = (i / steps) * TAU, cos = Math.cos(angle), sin = Math.sin(angle);
    const toSide = cos > 1e-6 ? (w - cx) / cos : cos < -1e-6 ? -cx / cos : Infinity, toEnd = sin > 1e-6 ? (h - cy) / sin : sin < -1e-6 ? -cy / sin : Infinity;
    // A little past the screen's edge, so no sliver of new page shows at the start.
    rays.push([cos, sin, Math.min(toSide, toEnd) * 1.02]);
  }
  const point = (i: number, p: number): [number, number] => {
    const left = clamp(1 - p * (1 + 1.15 * shard[i])), [cos, sin, far] = rays[i];
    return [cx + cos * far * left, cy + sin * far * left];
  };
  const hole = (p: number) => {
    const ring: Ring = [];
    for (let i = 0; i < steps; i++) ring.push(...point(i, p));
    return ring;
  };
  const screen: Ring = [-2, -2, w + 2, -2, w + 2, h + 2, -2, h + 2];
  return {
    kind: "cut", rule: "evenodd",
    shape(p) {
      return p <= 0 ? [] : [screen, hole(p)];
    },
    paint(g, p, rings) {
      if (p <= 0 || p >= 1) return;
      const { line, glow } = scene, edge = tracePath([rings[1]]);
      // Rime on the new page, just behind the ice's edge.
      g.save();
      g.clip(tracePath(rings), "evenodd");
      g.lineJoin = "miter";
      g.strokeStyle = "rgba(225,243,255,.16)"; g.lineWidth = 90 * line; g.stroke(edge);
      g.strokeStyle = "rgba(235,248,255,.24)"; g.lineWidth = 34 * line; g.stroke(edge);
      g.restore();
      g.save();
      g.strokeStyle = "#ffffff"; g.lineWidth = 1.5 * line; g.shadowColor = "#9fdcff"; g.shadowBlur = 11 * glow; g.stroke(edge);
      g.shadowBlur = 6 * glow; g.lineCap = "round";
      for (const [n, i] of tips.entries()) {
        const [x, y] = point(i, p), twinkle = Math.abs(Math.sin(p * 22 + n * 1.9)), r = (3 + 7 * twinkle) * line;
        g.globalAlpha = 0.35 + 0.65 * twinkle; g.lineWidth = 1.3 * line;
        g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
      }
      g.restore();
    },
  };
}

// Soft blooms of pigment that bleed into each other. The first is under the
// reader's finger; its solid middle is what reaches the farthest corner.
export function watercolorWash(scene: Scene): Arrival {
  const { w, h, ox, oy, rand } = scene, reach = farthestCorner(ox, oy, w, h), solid = 0.58;
  const blooms: Array<{ x: number; y: number; r: number; start: number; lasts: number; first: boolean }> = [];
  const bloom = (x: number, y: number, r: number, start: number, lasts: number, first: boolean) => {
    // Three lobes a little apart, so no bloom is a plain circle.
    for (let i = 0; i < 3; i++) {
      const angle = rand() * TAU, off = i ? r * 0.16 : 0;
      blooms.push({ x: x + Math.cos(angle) * off, y: y + Math.sin(angle) * off, r: r * (i ? 0.8 + rand() * 0.2 : 1), start: start + i * 0.02, lasts, first });
    }
  };
  bloom(ox, oy, reach / 0.55, 0, 1, true);
  // The others stay small and slow: with large ones the screen was covered
  // half way through, and the rest of the arrival showed nothing.
  for (let i = 0; i < 6; i++) bloom(rand() * w, rand() * h, reach * (0.2 + rand() * 0.2), 0.08 + i * 0.08 + rand() * 0.04, 0.7, false);
  return {
    kind: "soft",
    spots(p) {
      const spots: SoftSpot[] = [];
      for (const each of blooms) {
        const grown = clamp((p - each.start) / each.lasts);
        if (grown <= 0) continue;
        const r = each.r * (each.first ? grown ** 1.6 : easeOut3(grown));
        spots.push({ x: each.x, y: each.y, r, inner: r * solid });
      }
      return spots;
    },
    paint(g, p, spots) {
      // The ring of pigment a wet wash leaves at its edge.
      g.save();
      g.globalAlpha = 0.9 * (1 - p * p);
      for (const spot of spots) {
        const ring = g.createRadialGradient(spot.x, spot.y, spot.inner * 0.8, spot.x, spot.y, spot.r * 1.02);
        // Faint: twenty blooms lie over each other, and their rings add up.
        ring.addColorStop(0, alpha(scene.tones.accent, 0)); ring.addColorStop(0.55, alpha(scene.tones.accent, 0.13));
        ring.addColorStop(0.8, alpha(scene.tones.accent, 0.06)); ring.addColorStop(1, alpha(scene.tones.accent, 0));
        g.fillStyle = ring;
        g.beginPath(); g.arc(spot.x, spot.y, spot.r * 1.02, 0, TAU); g.fill();
      }
      g.restore();
    },
  };
}
