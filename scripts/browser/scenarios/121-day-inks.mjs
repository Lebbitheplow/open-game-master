// The day theme's other faint inks, found by reading every text on the table,
// the lobby, the sheet and the builder against what is painted behind it
// (PR 799 and PR 802's audit). The lobby kept its night scrim over the
// painting by day, so its section heads and open seats were dark ink on navy.
// Sky, orange and lime kept Tailwind's night shades: "Show" in the builder and
// every sky notice were pale on cream. Gold dimmed with an alpha for the
// night's glow ("Party backstory") and the hint grey on a darker parchment
// panel came out under 4.5:1. The theme is the player's saved choice.
import { check, eventually, untilStill } from "../lib.mjs";

const read = (locator) => locator.evaluate((node) => {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const parts = (text) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = text;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const style = getComputedStyle(node);
  const stops = [...style.backgroundImage.matchAll(/(?:rgba?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]+/gi)].map((match) => parts(match[0]));
  return { color: parts(style.color), fill: parts(style.backgroundColor), stops };
});
const lit = ([r, g, b]) => {
  const channel = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (one, two) => (Math.max(lit(one), lit(two)) + 0.05) / (Math.min(lit(one), lit(two)) + 0.05);
const over = (top, under) => [0, 1, 2].map((i) => Math.round(top[i] * top[3] + under[i] * (1 - top[3])));
// The darker of the day's parchment panels, where a hint is hardest to read.
const PANEL = [235, 224, 194];

export default {
  name: "day-inks",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const found = [];
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    const visit = async (url, ready) => {
      await t.open(url);
      await setTheme("light");
      await t.open(url);
      await eventually(() => ready.count(), { timeoutMs: 30_000, label: `${url} by day` });
      await untilStill(page).catch(() => undefined);
    };

    // The lobby: a section head on the page, over the painting at its darkest.
    const head = page.locator(`${root}.cine-lobby .lobby-head-title`).locator("visible=true").first();
    await visit(`/campaigns/${ids.lobbyId}`, head);
    const scrim = await read(page.locator(`${root}.cine-lobby .cine-scrim-stack`).first());
    const darkest = scrim.stops.reduce((worst, stop) => (worst && worst[3] <= stop[3] ? worst : stop), null);
    const behindHead = darkest ? over(darkest, [0, 0, 0]) : [0, 0, 0];
    const headInk = (await read(head)).color;
    if (ratio(headInk, behindHead) < 4.5) found.push(`the lobby's section head (${headInk} over ${behindHead})`);
    // The cover's eyebrow sits below the cover by day, not on its rim.
    const cover = await page.locator(`${root}.cine-lobby .lobby-hero-art`).first().boundingBox();
    const heroEyebrow = await page.locator(`${root}.cine-lobby .lobby-hero-art + div > p`).first().boundingBox();
    if (!cover || !heroEyebrow) found.push("the lobby's cover and its eyebrow");
    else if (heroEyebrow.y < cover.y + cover.height) found.push(`the cover's eyebrow overlaps the cover by ${Math.round(cover.y + cover.height - heroEyebrow.y)}px`);
    await t.shot("lobby");

    // Gold an eyebrow dims with an alpha, on a panel.
    const eyebrow = page.locator(`${root}.text-amber-400\\/80`).locator("visible=true").first();
    if (await eyebrow.count()) {
      const { color } = await read(eyebrow);
      const ink = color[3] < 1 ? over(color, PANEL) : color;
      if (ratio(ink, PANEL) < 4.5) found.push(`a dimmed gold eyebrow (${color} on ${PANEL})`);
    } else {
      found.push("no dimmed gold eyebrow in the lobby to read");
    }

    // The sheet's hint grey on its panel.
    const hint = page.locator(`${root}section.panel dt.text-stone-500`).locator("visible=true").first();
    await visit(`/characters/${ids.library}`, hint);
    const hintInk = (await read(hint)).color;
    if (ratio(hintInk, PANEL) < 4.5) found.push(`the sheet's hint grey (${hintInk} on ${PANEL})`);

    // Sky on cream: the builder's "Show" and whatever else is sky there.
    const sky = page.locator(`${root}:is(.text-sky-300, .text-sky-200)`).locator("visible=true").first();
    await visit(`/characters/${ids.library}/edit`, page.locator(`${root}[data-summary-edit]`).locator("visible=true"));
    if (await sky.count()) {
      const { color } = await read(sky);
      const cream = [244, 239, 228];
      if (ratio(color, cream) < 4.5) found.push(`sky text in the builder (${color} on ${cream})`);
    } else if (t.viewport === "phone") {
      found.push("the builder's sky Show is not there to read");
    }

    await setTheme("dark");
    check(found.length === 0, `faint by day:\n  ${found.join("\n  ")}`);
  },
};
