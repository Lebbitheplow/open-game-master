// The board's hover plate under a high-level pile of conditions. At the
// Pileup Table, which the lead runs, an ogre is prone, restrained by Web,
// poisoned, frightened by Wren's Cause Fear (save ends), Hasted, Blessed,
// invisible and Shielded: eight, more than a page on a phone (four) or a
// desktop (six).
//
// Hovered, the plate shows the first page, each painting at least 40px on
// screen with what the condition does, and names the rest; it sits whole
// inside the window and reads light on its dark ground by day. The DM's tap
// opens the figure's dial, whose Details holds the plate open: it takes the
// keyboard, pages through all eight, stays when the pointer leaves, and
// closes on Escape. Desktop and phone, night and day.
import { check, eventually, openPanelTab, sleep, untilStill } from "../lib.mjs";

const ROWS = [
  ["prone", "Can only crawl"],
  ["restrained", "Speed 0. Attacks against it have advantage"],
  ["poisoned", "Disadvantage on attack rolls and ability checks"],
  ["frightened", "while the source of its fear is in sight"],
  ["hasted", "Haste: +2 AC"],
  ["blessed", "Bless: +1d4"],
  ["invisible", "Can't be seen without magic"],
  ["shielded", "Shield: +5 AC"],
];

export default {
  name: "condition-plate",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const { id, ogre, wren } = ids.pileup[viewport];
    const perPage = viewport === "phone" ? 4 : 6;
    await t.open(`/campaigns/${id}`);
    await openPanelTab(t, "battle");
    const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
    const frame = board.locator(".board-view").first();
    await eventually(() => frame.isVisible(), { timeoutMs: 30_000, label: "the DM's board" });
    const figure = frame.getByRole("img", { name: new RegExp(`^${ogre.name}`) }).first();
    await eventually(() => figure.isVisible(), { timeoutMs: 20_000, label: `${ogre.name} on the board` });
    await untilStill(page);

    const inWindow = async (locator) => {
      const box = await locator.boundingBox();
      const size = page.viewportSize();
      return Boolean(box && size && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height);
    };
    // Each row on screen: its name first, what it does, and its painting large.
    const checkRows = async (rows, from) => {
      const count = await rows.count();
      check(count === Math.min(perPage, ROWS.length - from), `rows ${from + 1} on: ${count} shown`);
      for (let index = 0; index < count; index += 1) {
        const [name, meaning] = ROWS[from + index];
        const text = (await rows.nth(index).textContent()) ?? "";
        check(text.toLowerCase().startsWith(name) && text.includes(meaning), `the ${name} row says what it does (${text.slice(0, 120)})`);
        const art = rows.nth(index).locator("img").first();
        const width = (await art.count()) ? await art.evaluate((node) => node.parentElement.getBoundingClientRect().width) : 0;
        check(width >= 40, `the ${name} painting is shown large (${width}px)`);
      }
    };

    // Hovered: the first page, and the rest by name.
    const at = await figure.boundingBox();
    check(at, `${ogre.name} has a place on screen`);
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    // Pinned to the page, outside the game's root.
    const plate = page.locator('[role="tooltip"]').locator("visible=true").filter({ hasText: "poisoned" }).first();
    await eventually(() => plate.isVisible(), { timeoutMs: 10_000, label: `the ${ogre.name}'s hover plate` });
    await untilStill(page);
    const rows = plate.locator('ul[aria-label="Conditions"] > li');
    await checkRows(rows, 0);
    const frightened = (await rows.nth(3).textContent()) ?? "";
    check(frightened.includes("save ends (WIS 13)") && frightened.includes(wren.name), `frightened keeps its save and who laid it (${frightened})`);
    check(((await rows.nth(1).textContent()) ?? "").includes("(2 rd)"), "restrained keeps its rounds");
    const more = (await plate.locator("[data-plate-more]").textContent()) ?? "";
    const named = ROWS.slice(perPage).map(([name]) => name);
    check(more.startsWith(`+${named.length} more:`) && named.every((name) => more.includes(name)), `the rest are named (${more})`);
    check(await inWindow(plate), `the plate sits whole inside the window (${JSON.stringify(await plate.boundingBox())})`);
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
    await sleep(1_000);

    // Held open: the DM's tap opens the dial, and Details holds the plate.
    await t.tap(figure);
    const dial = page.locator(`${root}[role="menu"][aria-label="Actions for ${ogre.name}"]`).first();
    await eventually(() => dial.isVisible(), { timeoutMs: 10_000, label: `the ${ogre.name}'s dial` });
    await untilStill(page);
    // Every sigil on the dial is on the board and clear of the camera
    // buttons: near the right edge it opens left (dial-side.ts).
    const clash = await page.evaluate((name) => {
      const menu = document.querySelector(`[role="menu"][aria-label="Actions for ${name}"]`);
      const frame = menu?.closest(".board-view")?.getBoundingClientRect();
      const cams = [...(menu?.closest(".board-view")?.querySelectorAll(".board-cam button") ?? [])].map((button) => button.getBoundingClientRect());
      const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const sigils = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) => ({ label: item.getAttribute("aria-label"), box: item.getBoundingClientRect() }));
      const names = [...(menu?.querySelectorAll("span.font-display") ?? [])].map((item) => ({ label: item.textContent, box: item.getBoundingClientRect() }));
      const off = (box) => !frame || box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom;
      return [
        ...[...sigils, ...names].filter(({ box }) => off(box) || cams.some((cam) => meets(box, cam))).map(({ label }) => `${label} off the board or under the camera buttons`),
        // A name never runs under a sigil, its own or a neighbour's: the
        // sigils are round, so the name's nearest point against the circle.
        ...names
          .filter((name) =>
            sigils.some(({ box }) => {
              const [cx, cy, r] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2, box.width / 2];
              const nx = Math.max(name.box.left, Math.min(cx, name.box.right));
              const ny = Math.max(name.box.top, Math.min(cy, name.box.bottom));
              return Math.hypot(nx - cx, ny - cy) < r;
            }),
          )
          .map(({ label }) => `${label} under a sigil`),
      ];
    }, ogre.name);
    check(clash.length === 0, `every sigil on the dial is on the board and clear of the camera buttons (${clash.join(", ")}; opens ${await dial.getAttribute("data-dial-side")})`);
    await t.shot("dial");
    await t.tap(dial.getByRole("menuitem", { name: "Details" }));
    const held = page.getByRole("dialog", { name: `${ogre.name}: details` }).first();
    await eventually(() => held.isVisible(), { timeoutMs: 10_000, label: "the plate held open" });
    await untilStill(page);
    check(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"][data-pinned]'))), "the held plate takes the keyboard");
    // The pointer leaving does not close it.
    await page.mouse.move(2, 2);
    await sleep(300);
    check(await held.isVisible(), "the held plate stays when the pointer leaves");
    const heldRows = held.locator('ul[aria-label="Conditions"] > li');
    await checkRows(heldRows, 0);
    check((await held.locator("[data-plate-more]").count()) === 0, "held, the rest are a page away, not a list of names");
    const status = held.locator('[aria-live="polite"]');
    check(((await status.textContent()) ?? "") === "Page 1 of 2", `page 1 of 2 (${await status.textContent()})`);
    check(await held.getByRole("button", { name: "Previous conditions" }).isDisabled(), "no page before the first");
    // Thumb-sized on a phone, 32px from sm up.
    const least = viewport === "phone" ? 40 : 32;
    for (const name of ["Close", "Previous conditions", "Next conditions"]) {
      const box = await held.getByRole("button", { name }).boundingBox();
      check(box && box.width >= least && box.height >= least, `${name} is at least ${least}px (${JSON.stringify(box)})`);
    }
    check(await inWindow(held), `the held plate sits whole inside the window (${JSON.stringify(await held.boundingBox())})`);
    await t.shot("held-page-1");
    const next = held.getByRole("button", { name: "Next conditions" });
    const nextBefore = await next.boundingBox();
    await t.tap(next);
    await eventually(async () => ((await status.textContent()) ?? "") === "Page 2 of 2", { label: "page 2" });
    // The new page's rows pop in; they are measured once they land.
    await sleep(500);
    await untilStill(page);
    await checkRows(heldRows, perPage);
    check(await next.isDisabled(), "no page after the last");
    const nextAfter = await next.boundingBox();
    check(
      nextBefore && nextAfter && Math.abs(nextBefore.x - nextAfter.x) < 1 && Math.abs(nextBefore.y - nextAfter.y) < 1,
      `the arrows stay under the pointer as the page turns (${JSON.stringify([nextBefore, nextAfter])})`,
    );
    check(await inWindow(held), `page 2 sits whole inside the window (${JSON.stringify(await held.boundingBox())})`);
    await untilStill(page);
    await t.shot("held-page-2");
    await held.screenshot({ path: t.shotPath("held-plate") }).catch(() => {});
    await page.keyboard.press("Escape");
    await eventually(async () => !(await held.isVisible().catch(() => false)), { label: "Escape closes the held plate" });
  },
};
