// The interface's language (PR #1016): Settings > Language to French fetches
// the French catalog as its own chunk (src/lib/i18n/catalog-loader.ts, kept
// out of every page's first load) and the page switches over; a reload is
// rendered in French by the server from the cookie and hydrates without React
// throwing the French HTML away (locale.tsx CatalogGate); Follow the browser
// brings English back. In the apps the shell applies the device's choice.
import { check, eventually } from "../lib.mjs";

export default {
  name: "interface-language",
  viewports: ["desktop"],
  async run(t) {
    const { page, root } = t;
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(String(error)));
    await t.open("/settings");
    const french = page.locator(`${root}button[aria-pressed]`).filter({ hasText: "Français" }).first();
    await eventually(() => french.count(), { timeoutMs: 30_000, label: "the Language section" });
    check(/en/.test(await page.evaluate(() => document.documentElement.lang)), "English to start");
    await t.tap(french);
    await eventually(async () => (await page.evaluate(() => document.documentElement.lang)) === "fr-FR", { timeoutMs: 20_000, label: "html lang turns fr-FR once the catalog is in" });
    await eventually(async () => /Langue/.test(await page.locator(root || "body").first().innerText()), { timeoutMs: 20_000, label: "the section heading reads Langue" });
    await t.shot("french-live");
    if (!t.app) {
      await page.reload();
      await eventually(async () => /Langue/.test(await page.locator("body").innerText()), { timeoutMs: 20_000, label: "French after a reload" });
      const ssr = await (await page.request.get(page.url())).text();
      check(/lang="fr-FR"/.test(ssr), "the server renders <html lang=fr-FR> from the cookie");
      await t.shot("french-reload");
    }
    const hydration = errors.filter((text) => /hydrat|did not match|Minified React error #4(18|19|23|25)/i.test(text));
    check(hydration.length === 0, `no hydration error: ${hydration.join(" | ")}`);
    const auto = page.locator(`${root}button[aria-pressed]`).filter({ hasText: /Suivre le navigateur|Follow the browser/ }).first();
    await t.tap(auto);
    await eventually(async () => /^en/.test(await page.evaluate(() => document.documentElement.lang)), { timeoutMs: 20_000, label: "English back on Follow the browser" });
  },
};
