// Issue 1038 at the sheet. A mount has no pack, so its saddle is a row in
// its rider's equipment, and it used to be weighed on the rider. Tamsin
// carries chain mail, a longsword, a military saddle nobody has spoken for
// and saddlebags she packed. The saddle has its own place on the paperdoll,
// "On your mount", and weighs nothing for her; packing it with its button
// puts its 30 lb on her, and the button puts it back. The load's breakdown
// says which lines the mount bears. The place is clean under axe by day and
// by night, its buttons are finger-sized, and it runs on the website and
// inside the app's own screens.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const SADDLE = "Saddle, Military";
const BAGS = "Saddlebags";

export default {
  name: "tack-on-mount",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const campaignId = ids.tackTables[viewport];
    const gear = async () => {
      const table = await (await api.get(`${base}/api/campaigns/${campaignId}`)).json();
      const rider = (table.sheets ?? []).find((sheet) => sheet.name === "Tamsin Reed");
      return Object.fromEntries((rider?.equipment ?? []).map((item) => [item.name, item]));
    };

    await t.open(`/campaigns/${campaignId}`);
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Tamsin Reed" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Tamsin's party card" });
    await t.tap(card);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Worn gear sets your AC" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Tamsin's sheet with her gear" });

    const rowOf = (name) => sheet.locator(`[data-gear-row="${name}"]`).first();
    const place = (id) => sheet.locator(`[data-doll-place="${id}"]`).first();
    // What the Carried tile reads: chain mail 55, longsword 3, saddlebags 8.
    const carried = async () => /(\d+(?:\.\d+)?)\+?\/\d+ lb/.exec((await sheet.textContent()) ?? "")?.[1] ?? null;

    const before = await gear();
    check(before[SADDLE]?.equipped === undefined && before[BAGS]?.equipped === false, "the saddle starts unmarked and the saddlebags packed");
    await eventually(() => place("mount").count(), { label: "the mount's place on the paperdoll" });
    check((await place("mount").getAttribute("aria-label")) === `On your mount: ${SADDLE}.`, `the place names the saddle that is on the mount (${await place("mount").getAttribute("aria-label")})`);
    await eventually(async () => (await carried()) === "66", { label: `the saddle not weighed on its rider (carried ${await carried()})` });

    await place("mount").scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(place("mount"));
    const panel = sheet.locator('[data-doll-panel="mount"]');
    await eventually(() => panel.count(), { label: "the mount's place open" });
    check(/weighs nothing for you/.test((await panel.textContent()) ?? ""), "the open place says its rule");
    const saddle = rowOf(SADDLE).getByRole("button").first();
    const bags = rowOf(BAGS).getByRole("button").first();
    check(((await saddle.textContent()) ?? "").trim() === "On mount", `the saddle's button reads On mount (${await saddle.textContent()})`);
    check((await saddle.getAttribute("aria-label")) === `${SADDLE}: On mount. Take it off your mount.`, "a screen reader hears where the saddle is and what the press does");
    check(((await bags.textContent()) ?? "").trim() === "Packed", `the packed saddlebags read Packed (${await bags.textContent()})`);
    check((await bags.getAttribute("aria-label")) === `${BAGS}: Packed. Put it on your mount.`, "a screen reader hears the saddlebags are packed");
    if (viewport === "phone") {
      const small = await panel.locator("button").evaluateAll((buttons) => buttons.filter((button) => button.offsetHeight < 40 || button.offsetWidth < 40).map((button) => button.textContent));
      check(small.length === 0, `the place's buttons are finger-sized (${small.join(", ") || "all"})`);
    }
    const spill = await sheet.locator("[data-paperdoll]").evaluate((doll) => doll.scrollWidth - doll.clientWidth);
    check(spill <= 0, `the doll fits its sheet with the mount's place (${spill}px over)`);
    await panel.scrollIntoViewIfNeeded().catch(() => undefined);
    await untilStill(page);
    await t.shot("mount-place");
    const night = await axeViolations(page, "[data-paperdoll]");
    check(night.length === 0, `the doll passes axe with the mount's place open: ${JSON.stringify(night).slice(0, 400)}`);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await page.waitForTimeout(800);
    const day = await axeViolations(page, "[data-paperdoll]");
    check(day.length === 0, `the doll passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
    await t.shot("mount-place-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    // Packed, it is dead weight; put back, the mount bears it again.
    await saddle.focus();
    await page.keyboard.press("Enter");
    await eventually(async () => (await gear())[SADDLE]?.equipped === false, { label: "the saddle packed from the keyboard" });
    await eventually(async () => (await carried()) === "96", { label: `the packed saddle weighed on its rider (carried ${await carried()})` });
    await eventually(async () => ((await rowOf(SADDLE).getByRole("button").first().textContent()) ?? "").trim() === "Packed", { label: "the saddle's button reading Packed" });
    check((await gear())["Chain Mail"]?.equipped === true, "packing the saddle left her armor on");
    await untilStill(page);
    await t.shot("saddle-packed");
    await t.tap(rowOf(SADDLE).getByRole("button").first());
    await eventually(async () => (await gear())[SADDLE]?.equipped === true, { label: "the saddle back on the mount" });
    await eventually(async () => (await carried()) === "66", { label: `the saddle borne by the mount again (carried ${await carried()})` });

    // The breakdown says which lines the mount bears.
    const tile = sheet.getByRole("button", { name: /Show what makes up this load/ }).first();
    await tile.scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(tile);
    const load = page.getByRole("dialog").filter({ hasText: "What Tamsin Reed carries" }).locator("visible=true").first();
    await eventually(() => load.count(), { label: "the load's breakdown" });
    const line = load.locator("tr").filter({ hasText: SADDLE }).first();
    const cells = (await line.locator("td").allTextContents()).map((cell) => cell.trim());
    check(/on the mount, not carried/.test((await line.locator("th").textContent()) ?? ""), "the saddle's line says the mount bears it");
    check(cells.join("|") === "1|30 lb|0 lb", `the saddle's line shows what one weighs and that it counts for nothing (${cells.join("|")})`);
    await untilStill(page);
    await t.shot("load-breakdown");
    await page.keyboard.press("Escape");
  },
};
