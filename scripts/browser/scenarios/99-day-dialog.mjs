// A dialog by day sits on a solid sheet. The day panel is glass, which is right
// on the page and wrong over the overlay's dark veil: the veil read through and
// turned every dialog grey. This opens the character sheet by day, on the
// website in a page loaded that way, so no theme is switched under an open card.
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const scenario = {
  name: "day-dialog",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, api } = t;
    const snapshot = await (await api.get(`${base}/api/campaigns/${ids.campaignId}`)).json();
    const hero = snapshot.sheets.find((sheet) => sheet.userId === snapshot.me.id) ?? snapshot.sheets[0];
    await t.open(`/campaigns/${ids.campaignId}`);
    await page.evaluate(() => window.localStorage.setItem("odm.theme", "light"));
    try {
      await t.open(`/campaigns/${ids.campaignId}`);
      // The app shell starts from its own theme, so there it is set here.
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await openPanelTab(t, "party");
      const card = page.locator(`${root}[data-party-card="${hero.id}"]`).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the hero's party card" });
      await untilStill(page);
      await t.tap(card.getByRole("button", { name: `Options for ${hero.name}` }));
      await t.tap(page.getByRole("menuitem", { name: "View sheet" }));
      const dialog = page.getByRole("dialog").filter({ hasText: hero.name }).first();
      await eventually(() => dialog.count(), { label: "the hero's sheet" });
      await untilStill(page);
      await t.shot("sheet-day");
      const fill = await dialog.evaluate((node) => getComputedStyle(node).backgroundColor);
      check(fill === "rgb(251, 246, 233)", `the dialog sits on a solid sheet (${fill})`);
      const found = await axeViolations(page, '[role="dialog"]');
      check(!found.length, `axe on the dialog by day: ${found.map((entry) => entry.id).join(", ")}`);
      await page.keyboard.press("Escape");
    } finally {
      await page.evaluate(() => window.localStorage.removeItem("odm.theme"));
    }
  },
};

export default scenario;
