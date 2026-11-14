// The GM console's Travel asks what the party rides in ("Riding in", travel
// `aboard`): riders aboard a wagon or a ship make no forced-march saves. The
// field is labelled, blank by default (on foot), a finger's height on a phone,
// and legible in the night and day themes; three hours aboard a wagon come
// back as a ride, not a march. Answered as a host from before the field (no
// `features`), the form leaves it out, since that host would count the ride as
// a march. That pass runs on the website only: the app keeps one page and its
// capabilities for 30 seconds. The seed's Clock Table, one per viewport.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "console-travel-aboard",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.clockTables[viewport];
    const openTravel = async () => {
      await t.open(`/campaigns/${table.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      await openPanelTab(t, "dm");
      const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^world$/i }).locator("visible=true").first();
      await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's World tab" });
      await t.tap(tab);
      const open = page.getByRole("button", { name: /^Travel\b/ }).locator("visible=true").first();
      await eventually(() => open.count(), { label: "the console's Travel" });
      await t.tap(open);
      await untilStill(page);
    };
    const riding = () => page.getByRole("button", { name: "Riding in", exact: true }).locator("visible=true");

    await openTravel();
    await eventually(() => riding().count(), { label: "Riding in, labelled" });
    check(!/wagon|ship|boat/i.test((await riding().first().textContent()) ?? ""), "Riding in starts blank: on foot");
    if (viewport === "phone") {
      const box = await riding().first().boundingBox();
      check(Boolean(box && box.height >= 39.5), `Riding in is a target a finger can reach (${box?.height}px)`);
    }
    await riding().first().scrollIntoViewIfNeeded();
    await t.shot("aboard-night");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("aboard-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    const hours = page.getByLabel("Or hours", { exact: true }).locator("visible=true").first();
    await eventually(() => hours.count(), { label: "the hours" });
    await hours.fill("3");
    await t.tap(riding().first());
    const wagon = page.getByRole("menuitemradio", { name: "Wagon" }).locator("visible=true").first();
    await eventually(() => wagon.count(), { label: "Wagon under Riding in" });
    await t.tap(wagon);
    const run = page.getByRole("button", { name: "Run", exact: true }).locator("visible=true").first();
    const answered = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/dm/invoke`) && response.request().method() === "POST");
    await t.tap(run);
    const body = await (await answered).text();
    check(body.includes('"aboard":"wagon"') && body.includes('"forcedMarch":false'), `three hours aboard a wagon came back as a march: ${body.slice(0, 400)}`);

    if (t.app) return;
    await page.route("**/api/capabilities**", async (route) => {
      const response = await route.fetch();
      const json = await response.json().catch(() => ({}));
      delete json.features;
      await route.fulfill({ response, json });
    });
    await openTravel();
    await eventually(() => page.getByRole("button", { name: "Pace", exact: true }).locator("visible=true").count(), { label: "the Travel form on an older host" });
    check((await riding().count()) === 0, "an older host's Travel asks what the party rides in");
  },
};
