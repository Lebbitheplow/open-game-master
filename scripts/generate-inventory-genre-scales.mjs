// Keep existing genre paintings, but fit their actual alpha bounds inside
// inventory circles instead of applying the legacy blanket 1.7 zoom.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "..");
export async function buildInventoryGenreScales() {
  const subjects = ["genre-equipment", "shared-genre-equipment", "extended-genre-equipment"].flatMap(name => JSON.parse(fs.readFileSync(path.join(root, `scripts/${name}-subjects.json`), "utf8")));
  const scales = {};
  for (const { id } of subjects.sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    const { data, info } = await sharp(path.join(root, `public/assets/icons/item/${id}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let radius = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 64) radius = Math.max(radius, Math.hypot(x - info.width / 2, y - info.height / 2) / Math.max(info.width, info.height));
    }
    scales[id] = Number(Math.min(1.8, 0.45 / radius).toFixed(4));
  }
  return scales;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scales = await buildInventoryGenreScales();
  fs.writeFileSync(path.join(root, "src/lib/inventory-genre-scales.json"), JSON.stringify(scales, null, 2) + "\n");
  console.log(`${Object.keys(scales).length} genre inventory scales written`);
}
