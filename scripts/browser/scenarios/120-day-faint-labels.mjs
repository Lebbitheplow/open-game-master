// Three small labels that could hardly be read by day. A card's cost pill took
// the plain tag's dark ink from a day rule that outranked its own, so "ACTION"
// was dark on dark. The Hand's reaction prompt kept the night's pale sky text
// on a washed-out wash. The lead's rail label, and light ember text like "Lead
// only", kept an ember made for the night. The theme is the player's saved
// choice, applied as the page loads.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

// [red, green, blue, alpha] from a computed colour.
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
  return { color: parts(style.color), fill: parts(style.backgroundColor) };
});
const solid = (colour) => colour[3] === 1;
const lit = ([r, g, b]) => {
  const channel = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (one, two) => (Math.max(lit(one), lit(two)) + 0.05) / (Math.min(lit(one), lit(two)) + 0.05);
const reads = ({ color, fill }, label) => check(solid(fill) && ratio(color, fill) >= 4.5, `${label} reads by day (${color} on ${fill})`);

export default {
  name: "day-faint-labels",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    const phone = t.viewport === "phone";
    const setTheme = (mode) => page.evaluate((choice) => {
      window.localStorage.setItem("odm.theme", choice);
      // What applyTheme does: the app's screens do not reload between pages.
      document.documentElement.dataset.theme = choice;
      document.documentElement.style.colorScheme = choice;
    }, mode);
    const bench = ids.bench2[t.viewport].paladin;
    await t.open(`/campaigns/${bench.id}`);
    await setTheme("light");
    await t.open(`/campaigns/${bench.id}`);
    const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "the Hand" },
    );

    // The cost pills, one of each kind the seat holds.
    for (const cost of ["action", "bonus", "reaction"]) {
      const pill = hand.locator(`.hand-cost[data-cost="${cost}"]`).first();
      await eventually(() => pill.count(), { timeoutMs: 20_000, label: `a ${cost} pill` });
      reads(await read(pill), `the ${cost} pill`);
    }

    // The reaction prompt, its line and its card.
    const prompt = hand.locator(".hand-react").first();
    await eventually(() => prompt.isVisible(), { timeoutMs: 20_000, label: "the reaction prompt" });
    const behind = (await read(prompt)).fill;
    check(solid(behind) && lit(behind) > 0.6, `the prompt is a light, solid wash by day (${behind})`);
    const line = await read(prompt.locator(".hand-react-title").first());
    check(ratio(line.color, behind) >= 4.5, `the prompt's line reads by day (${line.color} on ${behind})`);
    reads(await read(prompt.locator(".hand-react-chip").first()), "the prompt's card");
    await page.waitForTimeout(6000);
    await untilStill(page).catch(() => undefined);
    await prompt.evaluate((node) => node.setAttribute("data-day", "prompt"));
    const faults = await axeViolations(page, '[data-day="prompt"]');
    check(faults.length === 0, `the prompt passes axe by day: ${JSON.stringify(faults).slice(0, 500)}`);
    await t.shot("hand");

    // The lead's label in the side rail, in a seat that has one.
    if (!phone) {
      await t.open(`/campaigns/${ids.bench2[t.viewport].revert.id}`);
      const lead = page.locator(`${root}.cine-rail`).getByRole("button", { name: "Lead", exact: true }).locator("visible=true").first();
      await eventually(() => lead.isVisible(), { timeoutMs: 30_000, label: "the rail's Lead" });
      await page.waitForTimeout(6000);
      await untilStill(page).catch(() => undefined);
      const { color } = await read(lead);
      const parchment = [241, 235, 222];
      check(ratio(color, parchment) >= 4.5, `the rail's Lead reads by day (${color} on ${parchment})`);
      await t.shot("lead");
      // The panel behind it: light ember text elsewhere, here its "Lead only" ribbon.
      await t.tap(lead);
      const ribbon = page.getByText("Lead only", { exact: true }).locator("visible=true").first();
      await eventually(() => ribbon.isVisible(), { timeoutMs: 15_000, label: "the Lead only ribbon" });
      const ribbonInk = (await read(ribbon)).color;
      check(ratio(ribbonInk, parchment) >= 4.5, `"Lead only" reads by day (${ribbonInk} on ${parchment})`);
      await page.mouse.move(4, 500);
      await untilStill(page).catch(() => undefined);
      await t.shot("lead-panel");
    }
    await setTheme("dark");
  },
};
