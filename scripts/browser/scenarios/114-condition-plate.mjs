// The board's hover plate under a pile of conditions. At the Pileup Table,
// which the lead runs, an ogre is prone, restrained by Web, poisoned,
// frightened by Wren's Cause Fear (save ends) and Hasted. Its plate lists all
// five beside the portrait, each painting at least 40px on screen, the SRD's
// four with what they do and Haste with its own summary, rounds and save,
// and the whole plate sits inside the window: on a desktop's short inline
// board, on a phone, at night and by day.
import { check, eventually, openPanelTab, sleep, untilStill } from "../lib.mjs";

const ROWS = [
  ["prone", "Can only crawl"],
  ["restrained", "Speed 0. Attacks against it have advantage"],
  ["poisoned", "Disadvantage on attack rolls and ability checks"],
  ["frightened", "while the source of its fear is in sight"],
  ["hasted", "Haste: +2 AC"],
];

export default {
  name: "condition-plate",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const { id, ogre, wren } = ids.pileup[viewport];
    await t.open(`/campaigns/${id}`);
    await openPanelTab(t, "battle");
    const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
    const frame = board.locator(".board-view").first();
    await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the DM's board" });
    const figure = frame.getByRole("img", { name: new RegExp(`^${ogre.name}`) }).first();
    await eventually(() => figure.isVisible(), { timeoutMs: 20_000, label: `${ogre.name} on the board` });
    await untilStill(page);

    const at = await figure.boundingBox();
    check(at, `${ogre.name} has a place on screen`);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    // Pinned to the page, outside the game's root.
    const plate = page.locator('[role="tooltip"]').locator("visible=true").filter({ hasText: "poisoned" }).first();
    await eventually(() => plate.isVisible(), { timeoutMs: 10_000, label: `the ${ogre.name}'s hover plate` });
    await untilStill(page);

    const rows = plate.locator('ul[aria-label="Conditions"] > li');
    check((await rows.count()) === ROWS.length, `one row per condition (${await rows.count()})`);
    for (const [index, [name, meaning]] of ROWS.entries()) {
      const row = rows.nth(index);
      const text = (await row.textContent()) ?? "";
      check(text.toLowerCase().startsWith(name) && text.includes(meaning), `the ${name} row says what it does (${text.slice(0, 120)})`);
      const art = row.locator("img").first();
      const width = (await art.count()) ? await art.evaluate((node) => node.parentElement.getBoundingClientRect().width) : 0;
      check(width >= 40, `the ${name} painting is shown large (${width}px)`);
    }
    const frightened = (await rows.nth(3).textContent()) ?? "";
    check(frightened.includes("save ends (WIS 13)") && frightened.includes(wren.name), `frightened keeps its save and who laid it (${frightened})`);
    check(((await rows.nth(1).textContent()) ?? "").includes("(2 rd)"), "restrained keeps its rounds");

    const inWindow = async () => {
      const box = await plate.boundingBox();
      const size = page.viewportSize();
      return Boolean(box && size && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height);
    };
    check(await inWindow(), `the plate sits whole inside the window (${JSON.stringify(await plate.boundingBox())})`);
    await t.shot("night");
    await plate.screenshot({ path: t.shotPath("plate-night") }).catch(() => {});

    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    // The theme eases its colours over; the shot waits for them to land.
    await sleep(1_000);
    await untilStill(page);
    check(await plate.isVisible(), "the plate stays open by day");
    // The plate stays dark by day, so its words must stay light: each line's
    // colour is brighter than mid-grey.
    const dim = await rows.evaluateAll((items) =>
      items.flatMap((item) =>
        [...item.querySelectorAll(":scope > span:last-child > span")].map((line) => {
          const [r, g, b] = (getComputedStyle(line).color.match(/[\d.]+/g) ?? []).map(Number);
          return { text: line.textContent?.slice(0, 30), light: 0.2126 * r + 0.7152 * g + 0.0722 * b };
        }),
      ).filter((line) => line.light < 128),
    );
    check(dim.length === 0, `every line on the plate reads light on its dark ground by day (${JSON.stringify(dim)})`);
    await t.shot("day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
    await page.mouse.move(0, 0);
  },
};
