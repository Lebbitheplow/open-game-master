// A new campaign starts in the server's language (src/lib/language/
// server-language.ts): a host that answers French in /api/capabilities opens
// the creator on Français, and its Table language picker shows flags.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "server-language-creator",
  viewports: ["desktop"],
  // The stand-in host answer is a browser-level route, which the app's
  // patched fetch bypasses.
  app: false,
  async run(t) {
    const { page, root, api, base } = t;
    // Saved defaults would stand over the server's language.
    await api.delete(`${base}/api/profile/campaign-defaults`);
    await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, language: "french" } });
    });
    await t.open("/");
    const tile = page.locator(`${root}[data-tour="tile-new-campaign"], [data-tour="tile-new-campaign"]`).locator("visible=true").first();
    await eventually(() => tile.count(), { timeoutMs: 30_000, label: "the New campaign tile" });
    await t.tap(tile);
    const dialog = page.getByRole("dialog").filter({ has: page.locator(".cc-shell, .wizard-continue") }).first();
    await eventually(() => dialog.locator("button.wizard-continue").count(), { timeoutMs: 30_000, label: "the creator" });
    const picker = dialog.locator('button[aria-label="Table language"]').first();
    await eventually(async () => (await picker.count()) > 0 || /Français/.test(await dialog.innerText()), { label: "the table language shown" });
    await eventually(async () => /Français/.test(await dialog.innerText()), { label: "the new campaign starts in French" });
    if (await picker.count()) {
      check((await picker.locator("svg").count()) >= 1, "the Table language picker shows the flag");
    }
    await picker.scrollIntoViewIfNeeded().catch(() => {});
    await untilStill(page);
    await t.shot("creator-french");
    await page.unroute(/\/api\/capabilities(\?|$)/);
  },
};
