// Copies the browser-side files two libraries load at run time into
// public/, so they work offline and the apps can carry them (the client's
// build copies these public folders beside its screens):
//
//   - dice-box-threejs textures and sounds into public/dice-box (3D dice);
//   - pdf.js's worker, character maps, standard fonts and image decoders
//     into public/pdfjs (the adventure PDF import reads books in the page,
//     src/lib/pdf-import/read-pdf.ts). Its script sandbox (quickjs) is left
//     out: an import never runs a PDF's scripts.
//
// Wired as postinstall; safe to rerun.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const dice = path.join(root, "node_modules", "@3d-dice", "dice-box-threejs", "public");
if (existsSync(dice)) {
  cpSync(dice, path.join(root, "public", "dice-box"), { recursive: true });
  console.log("[assets] Copied dice assets to public/dice-box");
} else {
  console.warn("[assets] @3d-dice/dice-box-threejs not installed; skipping the dice.");
}

const pdfjs = path.join(root, "node_modules", "pdfjs-dist");
const target = path.join(root, "public", "pdfjs");
if (existsSync(pdfjs)) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  // The legacy build: the modern one calls built-ins only the newest
  // engines have (Map.prototype.getOrInsertComputed, Uint8Array.fromBase64),
  // and an Android WebView or a Safari a few versions back has none of them.
  cpSync(path.join(pdfjs, "legacy", "build", "pdf.worker.min.mjs"), path.join(target, "pdf.worker.min.mjs"));
  cpSync(path.join(pdfjs, "LICENSE"), path.join(target, "LICENSE"));
  for (const folder of ["cmaps", "standard_fonts"]) cpSync(path.join(pdfjs, folder), path.join(target, folder), { recursive: true });
  mkdirSync(path.join(target, "wasm"), { recursive: true });
  for (const name of readdirSync(path.join(pdfjs, "wasm"))) {
    if (/quickjs/i.test(name)) continue;
    cpSync(path.join(pdfjs, "wasm", name), path.join(target, "wasm", name));
  }
  console.log("[assets] Copied the pdf.js worker and its data files to public/pdfjs");
} else {
  console.warn("[assets] pdfjs-dist not installed; skipping the PDF reader's files.");
}
