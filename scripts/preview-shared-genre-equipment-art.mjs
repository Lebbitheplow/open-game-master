// Render the shipped components and CSS, without a server account or player data.
// Set ODM_BROWSER to an installed Chrome/Chromium executable before running.
import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "@radix-ui/react-tooltip";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { launchBrowser } from "./browser/lib.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { EquipmentArtProvider } = await import("../src/components/ui/EquipmentArtProvider.tsx");
const { GameIcon } = await import("../src/components/ui/GameIcon.tsx");
const { HandCardFace } = await import("../src/app/campaigns/[campaignId]/HandCardFace.tsx");
const { weaponNamed } = await import("../src/lib/srd/weapons.ts");
const root = path.resolve(import.meta.dirname, "..");
const subjects = JSON.parse(readFileSync(path.join(root, "scripts/shared-genre-equipment-subjects.json"), "utf8"));
const cssPath = path.join(root, "src/app/globals.css");
const css = (await postcss([tailwind({ base: root })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
const inventory = subjects.map((row) => h(EquipmentArtProvider, { genre: row.genre, key: row.id }, h("article", null,
  h("div", { className: "inventory-icons" }, ...["size-10", "size-24"].map((size) => h(GameIcon, { key: size, icon: { kind: "item", key: row.label, family: `item-${row.kind}` }, size }))),
  h("p", null, `${row.label} (${row.genre})`),
)));
const cards = subjects.filter((row) => row.kind === "weapon").map((row, index) => {
  const weapon = weaponNamed(row.label);
  const card = { id: `review:${row.id}`, type: "attack", name: row.label, cost: "action", range: weapon.rangeFt ? `${weapon.rangeFt} ft` : "5 ft",
    dice: weapon.damage, roll: "", rules: "", resource: "", condition: "", target: "enemy", heals: false, save: null, disabled: null,
    spent: false, compose: false, icon: { kind: "item", key: row.label, family: "item-weapon" }, intent: { card: "attack", weapon: row.label } };
  return h(HandCardFace, { key: row.id, card, index, offset: 0, step: 0, picked: false, attached: false, played: false, aim: null, conditions: [], genre: row.genre, onPick: () => {} });
});
const body = renderToStaticMarkup(h(Provider, null, h("main", null,
  h("h1", null, "Shared equipment by genre"),
  h("p", null, "Component review: inventory icons at 40px and 96px; weapon Hand cards below."),
  h("section", { className: "inventory-grid" }, ...inventory),
  h("h2", null, "Weapon cards"), h("section", { className: "hand review-hand" }, ...cards),
)));
// Only the review layout is overridden; icon framing and card faces use the app CSS.
const layout = "main{max-width:1200px;margin:auto;padding:24px}h1,h2{font-size:26px;margin:16px 0}main>p{margin-bottom:20px}.inventory-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.inventory-grid article{padding:12px;border:1px solid var(--color-stone-700);border-radius:10px}.inventory-icons{display:flex;align-items:center;gap:24px;margin-bottom:8px}.review-hand{max-height:none;overflow:visible;display:grid;grid-template-columns:repeat(auto-fit,minmax(156px,1fr));gap:20px;padding:10px 0}.review-hand .hand-slot{height:var(--card-h);width:var(--card-w);transform:none;animation:none}.review-hand .hand-card{position:relative;transform:none}*{animation:none!important;transition:none!important}";
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><body>${body}</body></html>`); return; }
  if (pathname === "/preview.css") { res.setHeader("Content-Type", "text/css"); res.end(css + layout); return; }
  const file = path.resolve(root, "public", `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(path.join(root, "public", "assets") + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader("Content-Type", "image/webp"); res.end(readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await launchBrowser({ app: false });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  for (const [size, width] of [["desktop", 1280], ["phone", 390]]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.querySelectorAll("img").forEach((img) => { img.loading = "eager"; }); }, theme);
    await page.locator("img").evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    assert.equal(await page.locator(".inventory-grid img").count(), 98);
    assert.equal(await page.locator(".hand-card img").count(), 22);
    assert.deepEqual(await page.locator(".inventory-grid img").evaluateAll(images => images.map(img => img.getAttribute("src"))),
      subjects.flatMap(row => Array(2).fill(`/assets/icons/item/${row.id}.webp`)));
    assert.deepEqual(await page.locator(".hand-card img").evaluateAll(images => images.map(img => img.getAttribute("src"))),
      subjects.filter(row => row.kind === "weapon").map(row => `/assets/icons/action/${row.cardId}.webp`));
    assert.ok(await page.locator(".review-hand").evaluate((el) => el.scrollHeight <= el.clientHeight + 1), "all weapon cards appear in the screenshot");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(root, `docs/art/shared-genre-equipment-${size}-${theme}.png`), fullPage: true });
  }
  assert.deepEqual(failures, []);
  writeFileSync(path.join(root, "docs/art/shared-genre-equipment-component-checks.json"), JSON.stringify({ inventoryImages: 98, weaponCards: 22, viewports: [1280, 390], themes: ["dark", "light"], allImagesDecoded: true, horizontalOverflow: false, pageErrors: failures, scope: "Static rendering of the actual React components and application CSS; not an authenticated campaign or native client run." }, null, 2) + "\n");
  console.log("Equipment component previews passed in both themes at desktop and phone widths.");
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
