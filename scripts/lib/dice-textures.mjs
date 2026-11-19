// The texture files the dice tray can draw: for each texture a player can
// pick (DICE_TEXTURES in src/lib/dice/dice-look.ts), the image and bump map
// dice-box-threejs loads for it. The library ships 38 textures; the rest
// (bronze, tiger, lizard and the like) no look can choose, so they stay out
// of public/dice-box and out of the apps. Plain JS, read by the postinstall
// copy (scripts/copy-dice-assets.mjs) and by scripts/test-dice-look.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";

// The ids a look may hold, read from the source so this cannot drift.
export function pickableTextureIds(root) {
  const source = readFileSync(path.join(root, "src", "lib", "dice", "dice-look.ts"), "utf8");
  const block = /export const DICE_TEXTURES = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/\{ id: "([a-z0-9_]+)"/g)].map((match) => match[1]);
}

// The library's texture table: id to the files it loads. Null when the
// installed build no longer has the table this reads, so a caller can fall
// back to copying everything rather than ship dice with no texture.
export function libraryTextureFiles(root) {
  const dist = path.join(root, "node_modules", "@3d-dice", "dice-box-threejs", "dist", "dice-box-threejs.es.js");
  let source;
  try {
    source = readFileSync(dist, "utf8");
  } catch {
    return null;
  }
  const table = new Map();
  for (const [, id, body] of source.matchAll(/(\w+): \{\s*name: "[^"]*",([^{}]*)\}/g)) {
    const files = [...body.matchAll(/source(?:_bump)?: "textures\/([^"]+)"/g)].map((match) => match[1]);
    if (files.length) table.set(id, files);
  }
  return table.size ? table : null;
}

// The file names to keep in public/dice-box/textures, or null when the
// library's table could not be read.
export function diceTextureFiles(root) {
  const table = libraryTextureFiles(root);
  if (!table) return null;
  return new Set(pickableTextureIds(root).flatMap((id) => table.get(id) ?? []));
}
