// The corners of every painted theme, by day and by night, on a desk and a
// phone. Three faults, all seen in the desktop app:
//
// - A theme that paints one separate corner piece had the other three
//   corners turned by 90, 180 and 270 degrees, so Forge's ember gem lay on
//   its side at the top right. They are mirrored now, as the rulebook's
//   corners are. A corner cropped from the frame (cornerScale; no shipped
//   theme since Arcane, Gothic, Hearth and High Kingdoms got their own
//   pieces) shows that corner of the frame as painted and is neither turned
//   nor mirrored.
// - The flat corner brackets (.ornate) of a panel: Forge drew closed boxes
//   (its 2px reached all four sides), Gothic and Hearth asked for a double
//   line at 1px (one stroke), and on a card that is also .texture-noise the
//   grain's 5% opacity fell on the top-left bracket, which all but vanished.
// - Arcane, Gothic, Hearth and High Kingdoms drew their lobby corner at the
//   rail's scale, about 30px, where the other painted themes show a 196px
//   piece, and it was missed altogether.
import { readFileSync } from "node:fs";
import { check, eventually, untilStill } from "../lib.mjs";

// The catalog is TypeScript, so its ids and corner crops are read from its text.
const catalog = readFileSync(new URL("../../../src/lib/appearance-themes.ts", import.meta.url), "utf8");
const entries = catalog.slice(catalog.indexOf("APPEARANCE_THEMES ="), catalog.indexOf("] as const satisfies"));
const THEMES = entries.split(/\n  \{\n/).slice(1).map((block) => ({
  id: block.match(/\bid: "(\w+)"/)[1],
  cropped: /cornerScale: \d/.test(block),
  painted: /\bcorner: "/.test(block),
}));

// Top-left as painted, then flipped across, down, and both.
const MIRRORS = [[1, 0, 0, 1], [-1, 0, 0, 1], [-1, 0, 0, -1], [1, 0, 0, -1]];
const UPRIGHT = [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]];

export default {
  name: "theme-corners",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const faults = [];
    await t.open(`/campaigns/${ids.lobbyId}`);
    try {
      for (const mode of ["dark", "light"]) {
        for (const theme of THEMES) {
          await page.evaluate(([appearance, brightness]) => {
            window.localStorage.setItem("odm.appearance", appearance);
            window.localStorage.setItem("odm.theme", brightness);
          }, [theme.id, mode]);
          await t.open(`/campaigns/${ids.lobbyId}`);
          await eventually(() => page.evaluate((id) => document.documentElement.dataset.appearance === id, theme.id), { label: `the ${theme.id} appearance` });
          const label = `${theme.id} ${mode}`;

          if (theme.painted) {
            const shell = page.locator(`${root}.theme-lobby-shell`).first();
            await eventually(() => shell.count(), { timeoutMs: 30_000, label: "the lobby enclosure" });
            await untilStill(page).catch(() => undefined);
            const corners = await shell.evaluate((node) => [...node.querySelectorAll(":scope > .theme-ornaments > span")].map((span) => {
              const style = getComputedStyle(span);
              const m = new DOMMatrix(style.transform);
              // The shadow's offset as drawn on the page: its own y offset,
              // turned over by the corner's flip.
              const y = parseFloat(style.filter.match(/drop-shadow\((?:rgba?\([^)]*\)\s*)?(-?[\d.]+)px\s+(-?[\d.]+)px/)?.[2] ?? "0");
              return { matrix: [m.a, m.b, m.c, m.d].map((n) => Math.round(n)), shadow: Math.sign(y * m.d), width: span.getBoundingClientRect().width };
            }));
            const rail = await shell.evaluate((node) => parseFloat(getComputedStyle(node.querySelector(":scope > .theme-ornaments"), "::before").borderImageWidth));
            const want = theme.cropped ? UPRIGHT : MIRRORS;
            const got = corners.map((c) => c.matrix);
            if (got.length !== 4 || got.some((m, i) => m.join() !== want[i].join())) {
              faults.push(`${label}: the corners should be ${theme.cropped ? "upright crops of the frame" : "mirrored, not turned"} (${JSON.stringify(got)})`);
            }
            // A corner drawn at the rail's own scale (30px on a 26px rail) read as
            // no corner at all, so every lobby corner is a piece several rails wide.
            // A crop of the frame is sized from the rail by design.
            const small = theme.cropped ? [] : corners.filter((c) => !(c.width >= rail * 4));
            if (!(rail > 0) || small.length) faults.push(`${label}: a lobby corner is too small to read beside its ${rail}px rail (${JSON.stringify(corners.map((c) => Math.round(c.width)))})`);
            if (corners.some((c) => c.shadow < 0)) faults.push(`${label}: a corner's shadow falls up the page (${JSON.stringify(corners.map((c) => c.shadow))})`);
            await t.shot(`${theme.id}-${mode}-lobby`);
          }

          // A flat panel with brackets and grain, as the login card is.
          const brackets = await page.evaluate(() => {
            const card = document.createElement("div");
            card.className = "panel ornate texture-noise";
            card.style.cssText = "position:fixed;left:0;top:0;width:200px;height:120px";
            document.body.append(card);
            const side = (pseudo) => {
              const s = getComputedStyle(card, pseudo);
              return { opacity: Number(s.opacity), style: s.borderTopStyle === "none" ? s.borderBottomStyle : s.borderTopStyle, top: parseFloat(s.borderTopWidth), right: parseFloat(s.borderRightWidth), bottom: parseFloat(s.borderBottomWidth), left: parseFloat(s.borderLeftWidth) };
            };
            const result = { before: side("::before"), after: side("::after") };
            card.remove();
            return result;
          });
          const { before, after } = brackets;
          if (before.opacity < 1) faults.push(`${label}: the top-left bracket is at ${before.opacity} opacity`);
          if (before.right || before.bottom || !before.top || !before.left) faults.push(`${label}: the top-left bracket is not an L (${JSON.stringify(before)})`);
          if (after.top || after.left || !after.bottom || !after.right) faults.push(`${label}: the bottom-right bracket is not an L (${JSON.stringify(after)})`);
          for (const [name, side] of [["top-left", before], ["bottom-right", after]]) {
            if (side.style === "double" && Math.max(side.top, side.bottom) < 3) faults.push(`${label}: the ${name} bracket asks for a double line at ${Math.max(side.top, side.bottom)}px, which draws one`);
          }
        }
      }
    } finally {
      await page.evaluate(() => {
        window.localStorage.removeItem("odm.appearance");
        window.localStorage.removeItem("odm.theme");
      });
    }
    check(faults.length === 0, `every theme's corners face the right way and keep their brackets:\n  ${faults.join("\n  ")}`);
  },
};
