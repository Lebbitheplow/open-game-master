// The table header's paintings stood 2px above the middle of their buttons:
// the wrapper round each was an inline span, so the painting sat on a text
// line and the line's descender room lay under it. A round button hid it; a
// theme's arch or shield showed it at once. The same pass found Voice's name
// run into its border on an oval (a square fitting's percentages on a wide
// button), and the phone bar cutting "Battle" and "Story" to "Batt…" and
// "Stor…" with More's name on a line of its own. Here, on a round theme, an
// arched one and a shield:
//
// - every painting in the header is at the middle of its button, to the pixel;
// - Voice with its name is not an oval, and the name keeps clear of the edge;
// - on a phone no bar name is cut, and they all stand on one line.
import { check, eventually, untilStill } from "../lib.mjs";

const THEMES = ["arcane", "gothic", "kingdoms"];
// Half a pixel of rounding, no more: the fault was 1.5 to 2.
const OFF = 0.6;

const headerPaintings = (page, root) =>
  page.evaluate((root) => {
    const found = [];
    for (const painting of document.querySelectorAll(`${root}header.session-header .session-glyph`)) {
      const control = painting.closest("button, a");
      if (!control || !control.checkVisibility()) continue;
      const a = painting.getBoundingClientRect();
      const b = control.getBoundingClientRect();
      const lone = !control.innerText.trim();
      found.push({
        name: control.getAttribute("aria-label") ?? "",
        dy: (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2,
        dx: lone ? (a.left + a.right) / 2 - (b.left + b.right) / 2 : 0,
      });
    }
    return found;
  }, root);

export default {
  name: "header-icons-centred",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    try {
      for (const theme of THEMES) {
        await page.evaluate((appearance) => {
          window.localStorage.setItem("odm.appearance", appearance);
          window.localStorage.setItem("odm.theme", "dark");
        }, theme);
        await t.open(`/campaigns/${ids.campaignId}`);
        await eventually(() => page.evaluate((id) => document.documentElement.dataset.appearance === id, theme), { label: `the ${theme} appearance` });
        await eventually(() => page.locator(`${root}header.session-header .session-glyph`).count(), { timeoutMs: 30_000, label: "the header's paintings" });
        await untilStill(page).catch(() => undefined);

        const paintings = await headerPaintings(page, root);
        check(paintings.length >= 2, `the ${theme} header shows its painted controls (${paintings.length})`);
        const off = paintings.filter((one) => Math.abs(one.dy) > OFF || Math.abs(one.dx) > OFF);
        check(!off.length, `${theme}: a header painting is off the middle of its button: ${off.map((one) => `${one.name} ${one.dx.toFixed(1)},${one.dy.toFixed(1)}`).join("; ")}`);

        if (viewport === "desktop") {
          const voice = await page.evaluate((root) => {
            const button = document.querySelector(`${root}header.session-header [data-tour="header-voice"]`);
            const name = [...(button?.querySelectorAll("span") ?? [])].find((span) => span.checkVisibility() && span.textContent.trim() && !span.querySelector("*"));
            if (!button || !name) return null;
            const box = button.getBoundingClientRect();
            const text = name.getBoundingClientRect();
            // The corner's two radii in pixels, as drawn: radii too long for
            // their side shrink together, so a pill's huge radius is half the
            // height both ways and a 50% corner is an oval's.
            const corner = getComputedStyle(button).borderTopLeftRadius.split(" ");
            const px = (part, side) => (part.endsWith("%") ? (parseFloat(part) / 100) * side : parseFloat(part));
            const rx = px(corner[0], box.width);
            const ry = px(corner[1] ?? corner[0], box.height);
            const fit = Math.min(1, box.width / (2 * rx || 1), box.height / (2 * ry || 1));
            return { width: box.width, height: box.height, room: box.right - text.right, across: rx * fit, down: ry * fit };
          }, root);
          check(voice, `${theme}: Voice shows its name on a desk`);
          check(Math.abs(voice.across - voice.down) <= 1, `${theme}: Voice's corner is an oval's (${voice.across.toFixed(1)} across, ${voice.down.toFixed(1)} down on ${voice.width.toFixed(0)}x${voice.height.toFixed(0)})`);
          check(voice.room >= 8, `${theme}: Voice's name runs into its right edge (${voice.room.toFixed(1)}px of room)`);
        } else {
          const bar = await page.evaluate((root) => {
            const names = [...document.querySelectorAll(`${root}nav.cine-bottombar > button > .eyebrow`)].filter((name) => name.checkVisibility());
            return names.map((name) => ({ text: name.textContent.trim(), cut: name.scrollWidth > name.clientWidth + 1, foot: name.getBoundingClientRect().bottom }));
          }, root);
          check(bar.length >= 4, `the phone's bar shows its names (${bar.length})`);
          const cut = bar.filter((name) => name.cut);
          check(!cut.length, `${theme}: a bar name is cut short: ${cut.map((name) => name.text).join(", ")}`);
          const feet = bar.map((name) => name.foot);
          check(Math.max(...feet) - Math.min(...feet) <= 1, `${theme}: the bar's names do not stand on one line (${bar.map((name) => `${name.text} ${name.foot.toFixed(1)}`).join(", ")})`);
        }
        if (theme === "gothic") await t.shot(`header-${theme}`);
      }
    } finally {
      await page.evaluate(() => {
        window.localStorage.removeItem("odm.appearance");
        window.localStorage.removeItem("odm.theme");
      }).catch(() => undefined);
    }
  },
};
