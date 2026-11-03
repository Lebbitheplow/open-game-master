// Issue 793: the GM console's Rest asks what the party ate only at a table that
// counts food and water. With the supplies variant off the field is not there;
// with it on it is labelled, empty by default, reachable by a finger at phone
// width and legible in the night and day themes. A meal too short to name
// anything comes back refused with no time passed. The seed's Clock Table, one
// per viewport, with the variant put back off for the scenarios after this one.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "console-meal",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.clockTables[viewport];
    const campaign = `${base}/api/campaigns/${table.id}`;
    const variant = async (supplies) => {
      const response = await api.patch(`${campaign}/settings`, { data: { variantRules: { supplies } } });
      check(response.ok(), `the rule answered ${response.status()}: ${await response.text()}`);
    };
    const instant = async () => (await (await api.get(`${campaign}/dm/clock`)).json()).clock.instant;
    const openRest = async () => {
      await t.open(`/campaigns/${table.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      await openPanelTab(t, "dm");
      const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^party$/i }).locator("visible=true").first();
      await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's Party tab" });
      await t.tap(tab);
      const open = page.getByRole("button", { name: /^Rest\b/ }).locator("visible=true").first();
      await eventually(() => open.count(), { label: "the console's Rest" });
      await t.tap(open);
      await untilStill(page);
    };
    const meal = () => page.getByLabel("Meal from the story", { exact: true }).locator("visible=true");

    try {
      await variant(false);
      await openRest();
      check((await meal().count()) === 0, "the meal shows at a table that does not count food and water");

      await variant(true);
      await openRest();
      await eventually(() => meal().count(), { label: "the meal, labelled" });
      check((await meal().first().inputValue()) === "", "the meal starts empty");
      if (viewport === "phone") {
        const box = await meal().first().boundingBox();
        check(Boolean(box && box.height >= 39.5), `the meal is a target a finger can reach (${box?.height}px)`);
      }
      await t.shot("meal-night");
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("meal-day");
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

      const at = await instant();
      await meal().first().fill("ab");
      const rest = page.getByRole("button", { name: "Rest", exact: true }).locator("visible=true").first();
      await eventually(() => rest.count(), { label: "the Rest picker" });
      await t.tap(rest);
      const long = page.getByRole("menuitemradio", { name: "Long rest" }).locator("visible=true").first();
      await eventually(() => long.count(), { label: "Long rest under Rest" });
      await t.tap(long);
      const run = page.getByRole("button", { name: "Run", exact: true }).locator("visible=true").first();
      const answered = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/dm/invoke`) && response.request().method() === "POST");
      await t.tap(run);
      await answered;
      await eventually(() => page.getByText(/at least 3 characters/).locator("visible=true").count(), { label: "the refusal" });
      check((await instant()) === at, "a meal too short moved the clock");
    } finally {
      await variant(false);
    }
  },
};
