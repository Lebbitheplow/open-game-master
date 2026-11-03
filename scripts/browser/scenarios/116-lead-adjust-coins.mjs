// A character's silver and copper were tracked and could not be seen or
// changed: the sheet printed whole gold, and the lead's Adjust dialog edited
// whole gold only. Here the lead raises Pip's silver in the dialog, the save
// lands on the sheet's coin under a gold piece (viewports share one world, so
// each pass works from what it finds), the full sheet reads the coins, and
// the new fields pass axe and are a finger's height on a phone.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "lead-adjust-coins",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    await t.open(`/campaigns/${ids.commandTableId}`);
    const card = page.locator(`${root}[data-party-card="${ids.pip}"]`).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's party card" });
    await untilStill(page);

    const sheetOf = async () => {
      const table = await (await api.get(`${base}/api/campaigns/${ids.commandTableId}`)).json();
      return (table.sheets ?? []).find((sheet) => sheet.id === ids.pip);
    };
    const purseOf = (sheet) => sheet.gold * 100 + sheet.copper;
    const before = await sheetOf();

    await t.tap(card.getByRole("button", { name: /^Options for / }));
    await t.tap(page.getByRole("menuitem", { name: "Adjust stats" }));
    const dialog = page.getByRole("dialog", { name: /^Adjust / });
    await eventually(() => dialog.count(), { label: "the Adjust dialog" });
    const raiseSilver = dialog.getByRole("button", { name: "Raise Silver" });
    const raiseCopper = dialog.getByRole("button", { name: "Raise Copper" });
    await eventually(() => raiseSilver.count(), { label: "a stepper for silver" });
    check(await raiseCopper.count(), "a stepper for copper");
    await raiseSilver.scrollIntoViewIfNeeded();
    await untilStill(page);
    if (t.viewport === "phone") {
      const box = await raiseSilver.locator("xpath=..").boundingBox();
      check(Boolean(box && box.height >= 39.5), `the silver stepper is a finger's height on a phone (${box?.height}px)`);
    }

    await t.tap(raiseSilver);
    await t.tap(raiseCopper);
    await untilStill(page);
    await t.shot("adjust-coins");

    const serious = (list) => list.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const found = serious(await axeViolations(page, '[role="dialog"]'));
    check(!found.length, `axe finds nothing serious in the dialog (${found.map((violation) => violation.id).join(", ")})`);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = serious(await axeViolations(page, '[role="dialog"]'));
    check(!day.length, `and nothing serious by day (${day.map((violation) => violation.id).join(", ")})`);
    await t.shot("adjust-coins-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    const saved = page.waitForResponse((response) => response.url().includes(`/sheets/${ids.pip}`) && response.request().method() === "PATCH");
    await t.tap(dialog.getByRole("button", { name: "Save" }));
    check((await saved).ok(), "the correction saves");
    await eventually(async () => !(await dialog.count()), { label: "the dialog closing" });

    const after = await sheetOf();
    check(purseOf(after) === purseOf(before) + 11, `one silver and one copper more (${purseOf(before)} to ${purseOf(after)} cp)`);
    check(after.copper >= 0 && after.copper <= 99, `the coin under a gold piece stays whole (${after.copper})`);

    await t.tap(card.getByTitle("View full character sheet"));
    const sheet = page.getByRole("dialog").last();
    const tile = sheet.getByText("Coin", { exact: true }).locator("visible=true").first();
    await eventually(() => tile.count(), { label: "the sheet's Coin tile" });
    const sp = Math.floor(after.copper / 10);
    const cp = after.copper % 10;
    const wanted = [after.gold ? `${after.gold} gp` : "", sp ? `${sp} sp` : "", cp ? `${cp} cp` : ""].filter(Boolean).join(" ");
    await eventually(() => sheet.getByText(wanted, { exact: true }).count(), { label: `the sheet reading ${wanted}` });
    await tile.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("sheet-coin");
  },
};

export default scenario;
