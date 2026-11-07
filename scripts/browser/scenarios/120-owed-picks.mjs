// Issue #833: a pick a class feature opens is asked for wherever it is owed.
// A Draconic sorcerer saved before Dragon Ancestor was a pick has 7th level
// earned: the level-up's pick step offers the dragon. Not taken there, the
// sheet's "Choices owed" lists it and takes it: a pill per dragon, the
// chosen one's rules under the row, and Keep, a finger's height on a phone,
// clean under axe. Answered as a host from before the route (no `features`),
// the sheet only lists the pick (website only: the app keeps one page and
// its capabilities for 30 seconds).
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

async function openSheet(t) {
  const { page, root } = t;
  const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Ysolde Ember" }).locator("visible=true").first();
  for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
    if (await card.count()) break;
    const door = page.locator(selector).locator("visible=true").first();
    if (await door.count()) {
      await t.tap(door);
      await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
    }
  }
  await eventually(() => card.count(), { timeoutMs: 30_000, label: "Ysolde's party card" });
  await t.tap(card);
  const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Choices owed" }).first();
  await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Ysolde's sheet with its owed choices" });
  return sheet;
}

export default {
  name: "owed-picks",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.dragonTables[viewport];

    // The level-up offers the dragon with the 7th level's picks.
    await t.open(`/campaigns/${table.id}`);
    if (viewport === "phone") await openPanelTab(t, "party").catch(() => {});
    const dialog = page.locator('[role="dialog"]').last();
    const dragons = dialog.locator("button").filter({ hasText: /^\s*Gold(?!en)/ }).locator("visible=true");
    await eventually(
      async () => {
        if ((await dragons.count()) && /Dragon Ancestor/.test((await dialog.textContent()) ?? "")) return true;
        const next = dialog.locator("button").filter({ hasText: /^\s*Next\s*$/ }).locator("visible=true");
        if (await next.count()) {
          await t.tap(next.first()).catch(() => {});
          return false;
        }
        const button = page.locator(`${root}button`).filter({ hasText: /Level up to 7/ }).locator("visible=true");
        if (await button.count()) await t.tap(button.first()).catch(() => {});
        return false;
      },
      { timeoutMs: 60_000, label: "the level-up's Dragon Ancestor pick" },
    );
    await dragons.first().scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("level-up-dragon");
    await page.keyboard.press("Escape");
    await eventually(async () => (await dragons.count()) === 0, { label: "the level-up dialog closing" });

    if (!t.app) {
      await page.route("**/api/capabilities**", async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => ({}));
        delete body.features;
        await route.fulfill({ response, json: body });
      });
      await t.open(`/campaigns/${table.id}`);
      const older = await openSheet(t);
      const text = (await older.textContent()) ?? "";
      check(/Dragon Ancestor: 1 to choose/.test(text), "an older host's sheet still lists the dragon as owed");
      check(/Made when a level-up offers the choice\./.test(text), "an older host's sheet says the dragon waits for a level-up that offers it");
      check((await older.getByRole("group", { name: /Dragon Ancestor/ }).count()) === 0, "an older host's sheet offers no picker it cannot save");
      await page.unroute("**/api/capabilities**");
    }

    await t.open(`/campaigns/${table.id}`);
    const sheet = await openSheet(t);
    const group = sheet.getByRole("group", { name: /Dragon Ancestor/ });
    await eventually(() => group.count(), { label: "the owed Dragon Ancestor picker" });
    await group.scrollIntoViewIfNeeded();
    const owedText = (await sheet.textContent()) ?? "";
    check(/Dragon Ancestor: 1 to choose/.test(owedText), "the sheet lists the dragon as owed");
    // The class's own skills wait for the level-up; the dragon is made here.
    check(/Dragon Ancestor: 1 to choose\. Made below, now, without waiting for a level-up\./.test(owedText), "the sheet says the dragon is made right there");
    check(!/Dragon Ancestor[^.]*\. The next level-up takes/.test(owedText), "nothing on the sheet says a level-up takes the pick it offers");
    await t.shot("owed");
    const gold = group.getByRole("button", { name: "Gold", exact: true });
    await t.tap(gold);
    await eventually(async () => (await gold.getAttribute("aria-pressed")) === "true", { label: "Gold chosen" });
    check(/Gold dragon, fire/.test((await group.textContent()) ?? ""), "the chosen dragon's rules show under the row");
    const keep = sheet.getByRole("button", { name: "Keep Gold" });
    if (viewport === "phone") {
      // An untouched pill: the one just tapped is still pressed in (motion-press).
      await untilStill(page);
      for (const [label, button] of [["Red", group.getByRole("button", { name: "Red", exact: true })], ["Keep Gold", keep]]) {
        const measured = await button.boundingBox();
        check(Boolean(measured && measured.height >= 39.5), `${label} is a finger's height on a phone (${measured?.height})`);
      }
    }
    // By night and by day, clean under axe.
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
      const serious = (await axeViolations(page, `${root}[role="dialog"]`)).filter((violation) => violation.impact === "serious" || violation.impact === "critical");
      check(!serious.length, `axe finds nothing serious on the owed picker by ${theme === "dark" ? "night" : "day"} (${serious.map((violation) => violation.id).join(", ")})`);
      await t.shot(`owed-chosen-${theme === "dark" ? "night" : "day"}`);
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await t.tap(keep);
    const stored = async () => {
      const snapshot = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      return (snapshot.sheets ?? []).find((entry) => entry.id === table.hero)?.features ?? [];
    };
    await eventually(async () => (await stored()).some((feature) => feature.name === "Dragon Ancestor: Gold"), { label: "the dragon saved on the sheet" });
    await eventually(async () => (await group.count()) === 0, { label: "the picker gone once the pick is made" });
    await t.shot("owed-kept");
  },
};
