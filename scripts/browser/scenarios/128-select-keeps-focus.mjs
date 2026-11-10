// A kit Select gives focus back to its trigger when its list closes, but
// never takes it from the field the player has already moved to. The list
// unmounts a few frames after a choice, and a field focused in that gap lost
// its focus to the trigger: on a busy runner journey-artifact-to-shop chose
// where its cloak is worn, typed "25 gp" into Cost, and the keys after the
// first few went to the Worn on trigger, so the item never saved at 25 gp.
//
// The choice and the next field's focus are made in one step, inside the
// gap, so the race is the same every run. A keyboard-only choice, with focus
// left where the list put it, still lands back on the trigger.
import { check, eventually } from "../lib.mjs";

export default {
  name: "select-keeps-focus",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api } = t;
    const stamp = Date.now().toString(36);
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-homebrew", version: 1, how: "ended" }] } });
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Select focus ${stamp}`, description: "" } });
    check(made.ok(), "a workshop");
    const workshopId = (await made.json()).workshop.id;
    const item = await api.post(`${base}/api/homebrew`, { data: { kind: "item", name: `Focus trinket ${stamp}`, data: {} } });
    check(item.ok(), "an item to edit");
    const itemId = (await item.json()).entry.id;
    try {
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const tile = page.getByText(`Focus trinket ${stamp}`, { exact: true }).locator("visible=true").first();
      await eventually(() => tile.count(), { timeoutMs: 30_000, label: "the item on the shelf" });
      await t.tap(tile);
      const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Kind", exact: true }) });
      await eventually(() => editor.isVisible(), { timeoutMs: 30_000, label: "the item's editor" });
      const kind = editor.getByRole("button", { name: "Kind", exact: true });
      const cost = editor.getByLabel("Cost", { exact: true });
      const menu = page.getByRole("menu");

      // The choice, then the next field, before the list has gone.
      await kind.focus();
      await page.keyboard.press("Enter");
      await eventually(() => menu.isVisible(), { label: "the Kind list" });
      // The choice, then (as soon as the trigger reads it, while the list is
      // still leaving) the next field, as a quick hand or a busy page does.
      const moved = await page.evaluate(async () => {
        const row = [...document.querySelectorAll('[role="menuitemradio"]')].find((node) => node.textContent?.trim() === "Magic item");
        const field = [...document.querySelectorAll("input")].find((node) => node.labels?.[0]?.textContent?.trim().startsWith("Cost"));
        const trigger = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === "Kind");
        if (!row || !field || !trigger) return "no row, field or trigger";
        row.click();
        for (let frame = 0; frame < 60 && trigger.getAttribute("aria-expanded") !== "false"; frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        field.focus();
        return document.activeElement === field ? "" : `focus went to ${document.activeElement?.tagName}`;
      });
      check(!moved, `Magic item chosen, then Cost focused (${moved})`);
      await eventually(async () => (await menu.count()) === 0, { label: "the Kind list gone" });
      await page.waitForTimeout(400);
      check(await cost.evaluate((node) => node === document.activeElement), `Cost keeps the focus once the list has gone (it went to ${await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName)})`);
      await page.keyboard.type("25 gp");
      check((await cost.inputValue()) === "25 gp", `every key reached Cost (${await cost.inputValue()})`);
      check((await kind.innerText()).includes("Magic item"), "and the choice was made");

      // Keys alone: the focus comes back to the trigger.
      const rarity = editor.getByRole("button", { name: "Rarity", exact: true });
      await rarity.focus();
      await page.keyboard.press("Enter");
      await eventually(() => menu.isVisible(), { label: "the Rarity list" });
      // A row is highlighted before Enter takes it: the list's rows spring in
      // one after another, and a key before them lands on nothing.
      await eventually(async () => {
        await page.keyboard.press("ArrowDown");
        return (await menu.locator("[data-highlighted]").count()) > 0;
      }, { label: "a Rarity row highlighted" });
      await page.keyboard.press("Enter");
      await eventually(async () => (await menu.count()) === 0, { label: "the Rarity list gone" });
      await eventually(() => rarity.evaluate((node) => node === document.activeElement), { timeoutMs: 3_000, label: "the focus back on the Rarity trigger" });
    } finally {
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
      await api.delete(`${base}/api/homebrew/${itemId}`).catch(() => {});
    }
  },
};
