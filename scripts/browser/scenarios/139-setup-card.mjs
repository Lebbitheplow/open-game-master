// The title screen's "Finish setting up your server" card is the first thing
// a new host reads. On a phone its words stood nine lines tall in a column
// 70px wide: they asked for no width of their own, so they gave way to
// nothing beside the two buttons and the row never wrapped. By day the card
// took the day's vellum and dark ink while the painting under it stays
// night, so it was a grey wash with words that barely read. The words now
// keep a width, the buttons go under them on a phone and stay beside them on
// a wide window, and the card is a night panel in either theme.
import { check, eventually, untilStill } from "../lib.mjs";

// [red, green, blue, alpha] from a computed colour, the first stop of a gradient included.
const read = (locator) => locator.evaluate((node) => {
  const style = getComputedStyle(node);
  // A canvas reads any colour the browser reports: Tailwind's come as oklab, not rgb.
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const parts = (text) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = text;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const firstStop = /(?:rgba?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]+/i.exec(style.backgroundImage)?.[0];
  return { color: parts(style.color), image: firstStop ? parts(firstStop) : null, fill: parts(style.backgroundColor) };
});
const lit = ([r, g, b]) => {
  const channel = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (one, two) => (Math.max(lit(one), lit(two)) + 0.05) / (Math.min(lit(one), lit(two)) + 0.05);
// A see-through colour over what is behind it.
const over = (top, under) => [0, 1, 2].map((i) => Math.round(top[i] * top[3] + under[i] * (1 - top[3])));
// The painting's own night, which the card's see-through panel lies on.
const NIGHT = [13, 11, 28];

export default {
  name: "setup-card",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, viewport } = t;
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      // What applyTheme does: the app's screens do not reload between pages.
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    const card = page.locator(`${root}[role="status"]`).filter({ hasText: "Finish setting up your server" }).locator("visible=true").first();
    const words = card.locator(":scope > span").filter({ hasText: "Finish setting up your server" }).first();
    const title = card.getByText("Finish setting up your server", { exact: true });
    const sentence = card.getByText(/^No storyteller is answering yet/);
    const setUp = card.getByRole("link", { name: "Set it up" });
    const notNow = card.getByRole("button", { name: "Not now" });
    const box = (locator) => locator.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });

    for (const theme of ["dark", "light"]) {
      await t.open("/");
      await setTheme(theme);
      await t.open("/");
      await eventually(() => card.isVisible(), { timeoutMs: 30_000, label: "the setup card" });
      await untilStill(page).catch(() => undefined);

      const [whole, text, first, second] = await Promise.all([box(card), box(words), box(setUp), box(notNow)]);
      if (viewport === "phone") {
        check(text.width >= whole.width / 2, `on a phone the words have at least half the card (${Math.round(text.width)} of ${Math.round(whole.width)}px, ${theme})`);
        check(first.top >= text.bottom - 1 && second.top >= text.bottom - 1, `on a phone the buttons stand under the words (words end at ${Math.round(text.bottom)}, buttons start at ${Math.round(first.top)}, ${theme})`);
      } else {
        check(first.left >= text.right - 1 && first.top < text.bottom, `on a wide window the buttons stay beside the words (${theme})`);
      }
      check(first.height >= 40 && second.height >= 40, `both buttons are at least 40px tall (${Math.round(first.height)} and ${Math.round(second.height)}, ${theme})`);

      // A night panel in either theme: the painting under it does not turn.
      const surface = await read(card);
      const top = surface.image ?? surface.fill;
      const panel = over(top, NIGHT);
      check(lit(panel) < 0.05, `the card is a night panel (${top}, ${theme})`);
      for (const [name, ink] of [["its title", title], ["its sentence", sentence]]) {
        const { color } = await read(ink);
        check(ratio(color, panel) >= 4.5, `${name} reads on the card (${color} on ${panel}, ${theme})`);
      }
      const quiet = await read(notNow);
      const behind = over(quiet.fill, panel);
      check(ratio(quiet.color, behind) >= 4.5, `Not now reads on the card (${quiet.color} on ${behind}, ${theme})`);
      await t.shot(theme);
    }
    await setTheme("dark");
  },
};
