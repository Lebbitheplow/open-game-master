// Turns the generator's PNGs into the shipped WebP files. Not shipped; kept
// with the drafts so a repaint can repeat the same steps.
//   node theme-review/art-src/process.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const here = import.meta.dirname;
const out = path.resolve(here, "../../public/assets/themes/wasteland");
fs.mkdirSync(out, { recursive: true });

// Magenta (#FF00FF) to alpha. "Magentaness" is how far red and blue both
// stand above green; rust, steel and teal paint all score at or below zero.
// Edge pixels have the magenta taken back out of their colour.
async function key(source, target, size) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lo = 36, hi = 190;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const m = Math.min(r, b) - g;
    const alpha = m <= lo ? 1 : m >= hi ? 0 : 1 - (m - lo) / (hi - lo);
    if (alpha < 1 && alpha > 0) {
      data[i] = Math.max(0, Math.min(255, (r - (1 - alpha) * 255) / alpha));
      data[i + 1] = Math.max(0, Math.min(255, g / alpha));
      data[i + 2] = Math.max(0, Math.min(255, (b - (1 - alpha) * 255) / alpha));
    }
    if (alpha === 0) data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = Math.round(alpha * 255);
  }
  await sharp(data, { raw: info }).resize(size, size).webp({ quality: 90, alphaQuality: 100 }).toFile(target);
}

// Each edge is cross-faded with the half-offset image, one axis at a time,
// so the tile repeats without a seam.
async function tile(source, target, { size = 1024, saturation = 1, quality = 84 } = {}) {
  const { data, info } = await sharp(source).resize(size, size).modulate({ saturation }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const band = Math.round(size * 0.14);
  const weight = (p, n) => Math.min(1, Math.min(p, n - 1 - p) / band);
  let image = Buffer.from(data);
  for (const axis of ["x", "y"]) {
    const next = Buffer.alloc(image.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const w = axis === "x" ? weight(x, width) : weight(y, height);
      const ox = axis === "x" ? (x + width / 2) % width : x;
      const oy = axis === "y" ? (y + height / 2) % height : y;
      for (let c = 0; c < channels; c++) {
        next[(y * width + x) * channels + c] = Math.round(image[(y * width + x) * channels + c] * w + image[(oy * width + ox) * channels + c] * (1 - w));
      }
    }
    image = next;
  }
  await sharp(image, { raw: info }).webp({ quality }).toFile(target);
}

async function banner(source, target) {
  await sharp(source).removeAlpha().resize(1536, 512, { fit: "cover" }).webp({ quality: 86 }).toFile(target);
}

await key(path.join(here, "frame/frame-1.png"), path.join(out, "bent-sheet-frame-v1.webp"), 1024);
await key(path.join(here, "corner/corner-1.png"), path.join(out, "welded-scrap-corner-v1.webp"), 768);
await tile(path.join(here, "steel/steel-1.png"), path.join(out, "cooled-steel-v1.webp"), { saturation: 0.45 });
await tile(path.join(here, "canvas/canvas-1.png"), path.join(out, "bleached-canvas-v1.webp"), { saturation: 0.6 });
await banner(path.join(here, "day/day-1.png"), path.join(out, "wrecked-horizon-v1.webp"));
await banner(path.join(here, "night/night-1.png"), path.join(out, "starlit-camp-v1.webp"));
for (const file of fs.readdirSync(out)) console.log(file, fs.statSync(path.join(out, file)).size);
