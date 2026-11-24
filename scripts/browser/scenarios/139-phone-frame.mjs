// On a 390px phone the painted frame of a theme (src/components/
// ThemeOrnaments.tsx) lay over the bottom bar's labels and cut them off: the
// overlay reserves no room for itself, and its lower band and corners reached
// past the bar's padding into Story, Battle and the rest. Every painted theme,
// by day and by night, on phones from 360 to 430 wide and a short one, on the
// table and on the enlarged board: no text or icon is painted over. Each
// glyph or icon near the frame is read twice, with the frame and without it,
// so only what the frame really covers counts, not its transparent parts.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { check, eventually, untilStill } from "../lib.mjs";

// The catalog is TypeScript, so its ids are read from its text.
const catalog = readFileSync(new URL("../../../src/lib/appearance-themes.ts", import.meta.url), "utf8");
const THEMES = [...catalog.slice(catalog.indexOf("APPEARANCE_THEMES =")).matchAll(/\bid: "(\w+)"/g)].map((match) => match[1]);
const SIZES = [
  [390, 844],
  [360, 780],
  [412, 915],
  [430, 932],
  // A short phone, or a tall one with its keyboard's room taken.
  [390, 600],
];
// The bar's own labels were cut too, with no frame over them: seven cells
// share the width, and a cell's side padding with the label's wide letter
// spacing left "Table", "Party" and "Story" as "TAB..." at 360 and 390. Read
// at every size above and on a 320px phone.
const NARROW = [320, 640];
const cutLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("nav.cine-bottombar > button > .eyebrow")]
      .filter((label) => label.checkVisibility() && label.scrollWidth > label.clientWidth)
      .map((label) => `"${label.textContent}" has ${label.clientWidth}px of ${label.scrollWidth}`),
  );
// A glyph counts as cut once this share of its pixels changes under the frame.
const COVERED = 0.02;

// What could be covered: every text fragment and icon on the surface that
// meets the frame's painted rails or corners, clipped to what its scrolling
// ancestors and the screen show.
const nearFrame = (page, surface) =>
  page.evaluate((selector) => {
    const host = [...document.querySelectorAll(selector)].find((node) => node.checkVisibility());
    const ornament = host?.querySelector(":scope > .theme-ornaments");
    if (!host || !ornament || getComputedStyle(ornament).display === "none") return null;
    const box = ornament.getBoundingClientRect();
    const frame = getComputedStyle(ornament, "::before");
    const inset = parseFloat(frame.top);
    const band = parseFloat(frame.borderImageWidth);
    const outer = { left: box.left + inset, top: box.top + inset, right: box.right - inset, bottom: box.bottom - inset };
    const zones = [
      { ...outer, bottom: outer.top + band },
      { ...outer, top: outer.bottom - band },
      { ...outer, right: outer.left + band },
      { ...outer, left: outer.right - band },
      ...[...ornament.children].map((corner) => corner.getBoundingClientRect()),
    ];
    const meet = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
    const empty = (r) => r.right - r.left < 1 || r.bottom - r.top < 1;
    const shown = (node, rect) => {
      let r = meet(rect, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
      for (let at = node; at && at !== host; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") r = meet(r, at.getBoundingClientRect());
      }
      return r;
    };
    const found = [];
    const add = (node, rect, name) => {
      const r = shown(node, rect);
      if (!empty(r) && zones.some((zone) => !empty(meet(zone, r)))) found.push({ name: `${name.trim().slice(0, 30)} at ${Math.round(r.left)},${Math.round(r.top)}`, ...r });
    };
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const parent = text.parentElement;
      if (!text.textContent.trim() || parent.closest(".theme-ornaments") || !parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) add(parent, rect, `"${text.textContent}"`);
    }
    for (const icon of host.querySelectorAll("svg, img, .rail-glyph")) {
      if (icon.closest(".theme-ornaments") || !icon.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const owner = icon.closest("button,a");
      add(icon, icon.getBoundingClientRect(), `the icon of ${owner?.getAttribute("aria-label") || owner?.textContent || icon.tagName}`);
    }
    return found;
  }, surface);

const pixels = async (page) => {
  const { data, info } = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, scale: info.width / (await page.evaluate(() => innerWidth)) };
};
const HIDE = "frame-off";
const frameShown = (page, on) =>
  page.evaluate(([id, show]) => {
    document.getElementById(id)?.remove();
    if (show) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = ".theme-ornaments { display: none !important; }";
    document.head.append(style);
  }, [HIDE, on]);

// The share of each glyph's pixels that the frame changes: shot with the
// frame, without it, and with it again; a pixel counts only when both shots
// with the frame agree, so nothing that moved between shots is blamed on it.
async function covered(page, surface) {
  const near = await nearFrame(page, surface);
  if (!near) return null;
  if (!near.length) return [];
  const one = await pixels(page);
  await frameShown(page, false);
  const bare = await pixels(page);
  await frameShown(page, true);
  const two = await pixels(page);
  const at = (shot, x, y) => (y * shot.width + x) * 3;
  const differ = (a, b, i) => Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
  return near
    .map((glyph) => {
      const s = one.scale;
      let changed = 0;
      let total = 0;
      for (let y = Math.floor(glyph.top * s); y < Math.ceil(glyph.bottom * s); y += 1) {
        for (let x = Math.floor(glyph.left * s); x < Math.ceil(glyph.right * s); x += 1) {
          const i = at(one, x, y);
          total += 1;
          if (differ(one, two, i) < 8 && differ(one, bare, i) > 24) changed += 1;
        }
      }
      return { ...glyph, share: total ? changed / total : 0 };
    })
    .filter((glyph) => glyph.share > COVERED);
}

export default {
  name: "phone-frame",
  viewports: ["phone"],
  async run(t) {
    const { page, root, ids } = t;
    const report = [];
    const look = async (surface, label) => {
      await untilStill(page).catch(() => undefined);
      const cut = await covered(page, surface);
      check(cut !== null, `the painted frame is on the ${label}`);
      report.push(`${label}: ${cut.length ? cut.map((glyph) => `${glyph.name} ${Math.round(glyph.share * 100)}%`).join(", ") : "clear"}`);
      return cut;
    };
    const faults = [];
    // The preferences are this origin's, so a page of it comes first.
    await t.open(`/campaigns/${ids.campaignId}`);
    try {
      for (const mode of ["dark", "light"]) {
        for (const theme of THEMES) {
          await page.evaluate(([appearance, brightness]) => {
            window.localStorage.setItem("odm.appearance", appearance);
            window.localStorage.setItem("odm.theme", brightness);
          }, [theme, mode]);
          await t.open(`/campaigns/${ids.campaignId}`);
          await eventually(() => page.evaluate((id) => document.documentElement.dataset.appearance === id, theme), { label: `the ${theme} appearance` });
          const tab = (name) => page.locator(`${root}nav.cine-bottombar button`).filter({ hasText: name }).first();
          await eventually(() => tab(/^table$/i).count(), { timeoutMs: 30_000, label: "the bottom bar" });
          // The story with its composer, and a panel: the bar is the same, the rails' neighbours differ.
          for (const [view, name] of [["story", /^table$/i], ["battle panel", /^battle$/i]]) {
            await t.tap(tab(name));
            for (const [width, height] of view === "story" ? [...SIZES, NARROW] : SIZES.slice(0, 1)) {
              await page.setViewportSize({ width, height });
              const label = `${view}, ${theme} ${mode} ${width}x${height}`;
              const short = await cutLabels(page);
              if (short.length) faults.push(`${label}: a bar label is cut short: ${short.join(", ")}`);
              // The frame's own cover is held from 360 up, as before.
              if (width < 360) continue;
              const cut = await look(".theme-table", label);
              if (cut.length) faults.push(`${label}: ${cut.map((glyph) => glyph.name).join(" | ")}`);
              if (width === 390 && height === 844) await t.shot(`${theme}-${mode}-${view.split(" ")[0]}`);
            }
            await page.setViewportSize({ width: 390, height: 844 });
          }
          // The enlarged board brings its own frame (surface="overlay").
          const enlarge = page.locator(`${root}[aria-label="Enlarge battle map"]`).locator("visible=true").first();
          await eventually(() => enlarge.count(), { timeoutMs: 30_000, label: "the Enlarge battle map button" });
          await t.tap(enlarge);
          await eventually(() => page.locator(".theme-overlay .theme-ornaments").count(), { label: "the enlarged board's frame" });
          const label = `enlarged board, ${theme} ${mode} 390x844`;
          const cut = await look(".theme-overlay", label);
          if (cut.length) faults.push(`${label}: ${cut.map((glyph) => glyph.name).join(" | ")}`);
          if (theme === THEMES[0]) await t.shot(`${theme}-${mode}-enlarged`);
          await t.tap(page.locator(".cine-tabletop-close").first());
          await eventually(async () => (await page.locator(".theme-overlay").count()) === 0, { label: "the enlarged board closing" });
        }
      }
    } finally {
      console.log(`[phone-frame]\n  ${report.join("\n  ")}`);
      await page.evaluate(() => {
        window.localStorage.removeItem("odm.appearance");
        window.localStorage.removeItem("odm.theme");
      });
    }
    check(faults.length === 0, `the painted frame covers no text or icon on a phone, and no bar label is cut short:\n  ${faults.join("\n  ")}`);
  },
};
