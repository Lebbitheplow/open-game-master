// The GM console's Move the party asks whether the party goes aboard a boat or
// a cart (move_party `aboard`): what lies on its deck comes along to the new
// place (fork PR 1019: a raft's compass stayed at the sandbank). The switch is
// labelled, off by default, a finger's height on a phone, and legible in the
// night and day themes; switched on, the move is sent with `aboard`. Answered
// as a host from before the field (no `features`), the form leaves it out,
// since that host would leave the deck's things behind. That pass runs on the
// website only: the app keeps one page and its capabilities for 30 seconds.
// The seed's Clock Table, one per viewport.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "console-move-aboard",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.clockTables[viewport];
    const openMove = async () => {
      await t.open(`/campaigns/${table.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
      await openPanelTab(t, "dm");
      const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^world$/i }).locator("visible=true").first();
      await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's World tab" });
      await t.tap(tab);
      const open = page.getByRole("button", { name: /^Move the party\b/ }).locator("visible=true").first();
      await eventually(() => open.count(), { label: "the console's Move the party" });
      await t.tap(open);
      await untilStill(page);
    };
    const aboard = () => page.getByRole("switch", { name: "Aboard a boat or cart", exact: true }).locator("visible=true");

    await openMove();
    await eventually(() => aboard().count(), { label: "Aboard a boat or cart, labelled" });
    check((await aboard().first().getAttribute("aria-checked")) === "false", "Aboard a boat or cart starts off");
    if (viewport === "phone") {
      // The kit's switch is drawn 24px high; on a phone its ::before widens
      // the target a finger presses (globals.css .kit-switch::before).
      const reach = await aboard().first().evaluate((element) => Math.max(element.getBoundingClientRect().height, parseFloat(getComputedStyle(element, "::before").height) || 0));
      check(reach >= 39.5, `Aboard a boat or cart is a target a finger can reach (${reach}px)`);
    }
    await aboard().first().scrollIntoViewIfNeeded();
    await t.shot("move-aboard-night");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("move-aboard-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    const place = page.getByLabel("Place", { exact: true }).locator("visible=true").first();
    await eventually(() => place.count(), { label: "the place" });
    await place.fill("Driftwood Isle");
    await t.tap(aboard().first());
    await eventually(async () => (await aboard().first().getAttribute("aria-checked")) === "true", { label: "the switch turned on" });
    const run = page.getByRole("button", { name: "Run", exact: true }).locator("visible=true").first();
    const answered = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${table.id}/dm/invoke`) && response.request().method() === "POST");
    await t.tap(run);
    const response = await answered;
    const sent = response.request().postData() ?? "";
    check(sent.includes('"aboard":true'), `the move went without aboard: ${sent.slice(0, 400)}`);
    check(response.ok(), `the move was refused: ${(await response.text()).slice(0, 400)}`);

    if (t.app) return;
    await page.route("**/api/capabilities**", async (route) => {
      const fetched = await route.fetch();
      const json = await fetched.json().catch(() => ({}));
      delete json.features;
      await route.fulfill({ response: fetched, json });
    });
    await openMove();
    await eventually(() => page.getByRole("switch", { name: "They can see it", exact: true }).locator("visible=true").count(), { label: "the Move form on an older host" });
    check((await aboard().count()) === 0, "an older host's Move the party asks about a boat or cart");
  },
};
