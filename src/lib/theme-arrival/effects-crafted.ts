// The arrivals made by hand or machine: a spell circle, a turned page, a hex
// map and a signal glitch.
import { TAU, alpha, clamp, easeOut3, farthestCorner, lerp, mix, outBack, seeded, smooth, tracePath, type Arrival, type Ring, type Scene } from "./shapes";

// A rune circle opens where the reader pressed, holds a beat, and widens
// until the new theme fills the screen. The band of runes rides ahead of the
// circle, over the old page.
export function spellCircle(scene: Scene): Arrival {
  const { w, h, ox, oy, rand } = scene, reach = farthestCorner(ox, oy, w, h) * 1.04, opened = Math.min(w, h) * 0.09, count = 24, sides = 128;
  // Each rune is a stave with one to three branches, sometimes a bar.
  const runes = Array.from({ length: count }, () => {
    const strokes: Array<[number, number, number, number]> = [[0, -1, 0, 1]];
    for (let i = 1 + Math.floor(rand() * 3); i > 0; i--) {
      const y = -1 + rand() * 1.5, side = rand() < 0.5 ? -1 : 1, length = 0.5 + rand() * 0.4, up = rand() < 0.5 ? -1 : 1;
      strokes.push([0, y, side * length, y + up * length * 0.9]);
    }
    if (rand() < 0.35) {
      const y = rand() * 1.4 - 0.7;
      strokes.push([-0.5, y, 0.5, y]);
    }
    return strokes;
  });
  const radius = (p: number) => (p < 0.2 ? opened * outBack(p / 0.2) : opened + (reach - opened) * smooth((p - 0.2) / 0.8));
  return {
    kind: "cut",
    shape(p) {
      const r = radius(p);
      if (r < 0.5) return [];
      // Many sides: at the screen's diagonal a side still bows under a pixel.
      const ring: Ring = [];
      for (let i = 0; i < sides; i++) ring.push(ox + Math.cos((i / sides) * TAU) * r, oy + Math.sin((i / sides) * TAU) * r);
      return [ring];
    },
    paint(g, p) {
      const r = radius(p);
      if (r < 0.5) return;
      const { line, glow, tones } = scene, size = clamp(r * 0.085, 7 * line, 20 * line), turn = p * 2.4, band = r + size * 3.3;
      const circle = (at: number, width: number) => { g.lineWidth = width * line; g.beginPath(); g.arc(ox, oy, at, 0, TAU); g.stroke(); };
      g.save();
      // A dark band under the runes, so they read on a pale page too.
      g.beginPath(); g.arc(ox, oy, band, 0, TAU); g.arc(ox, oy, r, 0, TAU, true);
      g.fillStyle = alpha(mix(tones.deep, "#000000", 0.6), 0.62); g.fill();
      g.strokeStyle = tones.bright; g.lineCap = "round"; g.shadowColor = tones.bright; g.shadowBlur = 12 * glow;
      circle(r, 3.2); circle(band, 2.2); circle(band + 6 * line, 1.1);
      g.shadowBlur = 4 * glow;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + turn, at = r + size * 1.65;
        g.save();
        g.translate(ox + Math.cos(angle) * at, oy + Math.sin(angle) * at); g.rotate(angle + Math.PI / 2); g.scale(size * 0.6, size * 0.9);
        g.beginPath();
        for (const [x1, y1, x2, y2] of runes[i]) { g.moveTo(x1, y1); g.lineTo(x2, y2); }
        // Stroked after the restore, so the scale shapes the rune and not its line.
        g.restore();
        g.lineWidth = 2 * line; g.stroke();
      }
      // Inside the circle: a faint six-pointed figure turning the other way.
      g.shadowBlur = 0; g.globalAlpha = 0.12 + 0.38 * (1 - p); g.lineWidth = 1.2 * line;
      for (let half = 0; half < 2; half++) {
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          const angle = -turn * 0.6 + half * Math.PI + (i * TAU) / 3, x = ox + Math.cos(angle) * r * 0.94, y = oy + Math.sin(angle) * r * 0.94;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath(); g.stroke();
      }
      circle(r - 7 * line, 1);
      g.globalAlpha = 1; g.fillStyle = tones.bright; g.shadowColor = tones.bright; g.shadowBlur = 8 * glow;
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * TAU - turn * 1.7;
        g.beginPath(); g.arc(ox + Math.cos(angle) * band, oy + Math.sin(angle) * band, 2.6 * line, 0, TAU); g.fill();
      }
      g.restore();
    },
  };
}

// The old theme lifts from the bottom right corner and turns over like a page
// of the rulebook. The fold is a straight line; what it has passed shows the
// new page, and the old page's back lies mirrored across it.
export function pageTurn(scene: Scene): Arrival {
  const { w, h } = scene, corner: [number, number] = [w, h];
  // The fold travels up and to the left, flattening toward level as it goes.
  const started = Math.atan2(-h, -w), ended = lerp(started, -Math.PI, 0.55);
  const fold = (p: number) => {
    const angle = lerp(started, ended, p), dir: [number, number] = [Math.cos(angle), Math.sin(angle)];
    const along = (point: number[]) => (point[0] - corner[0]) * dir[0] + (point[1] - corner[1]) * dir[1];
    const screen = [[0, 0], [w, 0], [w, h], [0, h]];
    // A little past the farthest corner, so the page is wholly turned at the end.
    const at = smooth(p) * Math.max(...screen.map(along)) * 1.04;
    // The part of the screen the fold has passed.
    const passed: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const a = screen[i], b = screen[(i + 1) % 4], da = along(a) - at, db = along(b) - at;
      if (da <= 0) passed.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) passed.push([lerp(a[0], b[0], da / (da - db)), lerp(a[1], b[1], da / (da - db))]);
    }
    return { dir, at, along, passed };
  };
  return {
    kind: "cut",
    shape(p) {
      return p <= 0 ? [] : [fold(p).passed.flat()];
    },
    paint(g, p) {
      if (p <= 0) return;
      const { dir, at, along, passed } = fold(p);
      if (passed.length < 3) return;
      const { line, glow, tones } = scene, fx = corner[0] + dir[0] * at, fy = corner[1] + dir[1] * at;
      const trace = (points: number[][]) => {
        g.beginPath();
        points.forEach((point, i) => (i ? g.lineTo(point[0], point[1]) : g.moveTo(point[0], point[1])));
        g.closePath();
      };
      // The lifted page shades the new one beside the fold.
      g.save();
      trace(passed); g.clip();
      const shade = g.createLinearGradient(fx, fy, fx - dir[0] * 90 * line, fy - dir[1] * 90 * line);
      shade.addColorStop(0, "rgba(0,0,0,.42)"); shade.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = shade; g.fillRect(0, 0, w, h);
      g.restore();
      // Its back: darkest in the crease, a highlight beside it, then flat.
      // Paler than the page it is turning off, or on a dark theme the back of
      // the page could not be told from the page.
      const back = passed.map((point) => { const over = 2 * (at - along(point)); return [point[0] + over * dir[0], point[1] + over * dir[1]]; });
      const sheet = mix(tones.paper, "#ffffff", 0.2);
      const paper = g.createLinearGradient(fx, fy, fx + dir[0] * Math.max(at, 1), fy + dir[1] * Math.max(at, 1));
      paper.addColorStop(0, mix(sheet, "#000000", 0.45)); paper.addColorStop(0.05, mix(sheet, "#ffffff", 0.3));
      paper.addColorStop(0.3, sheet); paper.addColorStop(1, mix(sheet, "#000000", 0.2));
      g.save();
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 40 * glow; g.shadowOffsetX = dir[0] * 14 * glow; g.shadowOffsetY = dir[1] * 14 * glow;
      g.fillStyle = paper; trace(back); g.fill();
      g.restore();
      g.strokeStyle = alpha(mix(sheet, "#ffffff", 0.45), 0.7); g.lineWidth = 1.2 * line; trace(back); g.stroke();
    },
  };
}

// Hex tiles fill in as a wave from where the reader pressed, like a map being
// uncovered. Each tile's outline lights just before the tile itself grows.
export function hexMap(scene: Scene): Arrival {
  const { w, h, ox, oy, rand } = scene, r = Math.sqrt(w * h) / 21, reach = farthestCorner(ox, oy, w, h), across = 1.5 * r, down = Math.sqrt(3) * r, lasts = 0.28;
  const tiles: Array<{ x: number; y: number; start: number }> = [];
  for (let i = 0; i * across <= w + r; i++) {
    for (let y = i % 2 ? down / 2 : 0; y <= h + down / 2; y += down) tiles.push({ x: i * across, y, start: (Math.hypot(i * across - ox, y - oy) / reach) * 0.66 + rand() * 0.05 });
  }
  const tile = (x: number, y: number, size: number) => {
    const ring: Ring = [];
    for (let k = 0; k < 6; k++) ring.push(x + Math.cos((k * TAU) / 6) * size, y + Math.sin((k * TAU) / 6) * size);
    return ring;
  };
  return {
    kind: "cut",
    shape(p) {
      const rings: Ring[] = [];
      for (const each of tiles) {
        const grown = clamp((p - each.start) / lasts);
        // A hair over its cell when full, so no seam shows between neighbours.
        if (grown > 0) rings.push(tile(each.x, each.y, r * 1.035 * easeOut3(grown)));
      }
      return rings;
    },
    paint(g, p) {
      const waves: Ring[][] = [[], [], []];
      for (const each of tiles) {
        const lit = (p + 0.05 - each.start) / (lasts + 0.05);
        if (lit > 0 && lit < 1) waves[Math.min(2, Math.floor(lit * 3))].push(tile(each.x, each.y, r));
      }
      g.save();
      g.lineWidth = 1.6 * scene.line; g.strokeStyle = scene.tones.bright; g.shadowColor = scene.tones.bright; g.shadowBlur = 8 * scene.glow;
      waves.forEach((rings, i) => {
        if (!rings.length) return;
        g.globalAlpha = [0.95, 0.6, 0.28][i];
        g.stroke(tracePath(rings));
      });
      g.restore();
    },
  };
}

// Bands of the screen cut over one at a time, each in a few hard steps, with
// a lit bar at its leading edge and stray lines of the sign's two colours.
export function signalGlitch(scene: Scene): Arrival {
  const { w, h, rand } = scene;
  const bands: Array<{ y: number; height: number; start: number; lasts: number; rightward: boolean; steps: number; second: boolean }> = [];
  for (let y = 0, i = 0; y < h; i++) {
    const height = h * (0.03 + rand() * 0.075);
    bands.push({ y, height, start: rand() * 0.55, lasts: 0.18 + rand() * 0.22, rightward: rand() < 0.5, steps: 4 + Math.floor(rand() * 5), second: i % 2 === 1 });
    y += height;
  }
  const across = (band: (typeof bands)[number], p: number) => {
    const done = clamp((p - band.start) / band.lasts);
    return done <= 0 ? 0 : Math.ceil(done * band.steps) / band.steps;
  };
  return {
    kind: "cut",
    shape(p) {
      const rings: Ring[] = [];
      for (const band of bands) {
        const done = across(band, p);
        if (done <= 0) continue;
        const width = w * done, x = band.rightward ? 0 : w - width;
        // Half a pixel over its neighbours, so no line of old page shows between bands.
        rings.push([x, band.y - 0.5, x + width, band.y - 0.5, x + width, band.y + band.height + 0.5, x, band.y + band.height + 0.5]);
      }
      return rings;
    },
    paint(g, p) {
      const { line, glow, tones } = scene;
      g.save();
      for (const band of bands) {
        const done = across(band, p);
        if (done <= 0 || done >= 1) continue;
        const front = band.rightward ? w * done : w - w * done, colour = band.second ? tones.second : tones.bright;
        g.fillStyle = alpha(colour, 0.16);
        g.fillRect(band.rightward ? front : 0, band.y, band.rightward ? w - front : front, band.height);
        g.shadowColor = colour; g.shadowBlur = 14 * glow; g.fillStyle = colour;
        g.fillRect(front - 2 * line, band.y, 4 * line, band.height);
        g.shadowBlur = 0;
      }
      if (p > 0 && p < 0.92) {
        // New stray lines about 45 times over the arrival, not every frame.
        const stray = seeded(Math.floor(p * 45) + 7);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = alpha(k % 2 ? tones.second : tones.bright, 0.4);
          g.fillRect(stray() * w * 0.6, stray() * h, w * (0.1 + stray() * 0.4), (1 + stray() * 2.5) * line);
        }
      }
      g.restore();
    },
  };
}
