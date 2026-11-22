// Side-by-side comparison sheets from theme-review/screens (run shots.mjs first).
//   node theme-review/compare.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const here = import.meta.dirname;
const screens = path.join(here, "screens");
const out = path.join(here, "compare");
fs.mkdirSync(out, { recursive: true });
const THEMES = [["wasteland", "Wasteland"], ["forge", "Deep Forge"], ["inferno", "Inferno"]];
const LABEL = 44, GAP = 12;

for (const screen of ["lobby", "story", "combat", "map"]) for (const size of ["desktop", "phone"]) for (const mode of ["night", "day"]) {
  const files = THEMES.map(([id]) => path.join(screens, `${id}-${screen}-${size}-${mode}.png`));
  if (!files.every((file) => fs.existsSync(file))) { console.log("skip", screen, size, mode); continue; }
  const metas = await Promise.all(files.map((file) => sharp(file).metadata()));
  const width = metas.reduce((sum, meta) => sum + meta.width, 0) + GAP * (files.length + 1);
  const height = Math.max(...metas.map((meta) => meta.height)) + LABEL + GAP;
  let x = GAP;
  const layers = [];
  files.forEach((file, i) => {
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${metas[i].width}" height="${LABEL}"><text x="0" y="30" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="600" fill="#f2f2f2">${THEMES[i][1]} · ${screen}, ${size}, ${mode}</text></svg>`;
    layers.push({ input: Buffer.from(label), left: x, top: 0 }, { input: file, left: x, top: LABEL });
    x += metas[i].width + GAP;
  });
  const target = path.join(out, `compare-${screen}-${size}-${mode}.png`);
  await sharp({ create: { width, height, channels: 3, background: "#2a2a2a" } }).composite(layers).png({ compressionLevel: 9 }).toFile(target);
  console.log(path.basename(target));
}
