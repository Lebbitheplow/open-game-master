// The interface's language (PR #1016): Settings > Language to French fetches
// the French catalog as its own chunk (src/lib/i18n/catalog-loader.ts, kept
// out of every page's first load) and the page switches over; a reload is
// rendered in French by the server from the cookie and hydrates without React
// throwing the French HTML away (locale.tsx CatalogGate); Automatic
// brings English back. In the apps the shell applies the device's choice.
// Spanish goes the same road with its own catalog (issue 1125): Español
// turns the page to Spanish, a reload stays Spanish, Automatic is English.
import { check, eventually } from "../lib.mjs";

export default {
  name: "interface-language",
  viewports: ["desktop", "phone"],
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
    const auto = page.locator(`${root}button[aria-pressed]`).filter({ hasText: /Automatique|Automático|Automatic/ }).first();
    await t.tap(auto);
    await eventually(async () => /^en/.test(await page.evaluate(() => document.documentElement.lang)), { timeoutMs: 20_000, label: "English back on Automatic" });

    const spanish = page.locator(`${root}button[aria-pressed]`).filter({ hasText: "Español" }).first();
    check((await spanish.count()) === 1, "the Language section offers Español");
    await t.tap(spanish);
    await eventually(async () => (await page.evaluate(() => document.documentElement.lang)) === "es", { timeoutMs: 20_000, label: "html lang turns es once the catalog is in" });
    await eventually(async () => /Idioma/.test(await page.locator(root || "body").first().innerText()), { timeoutMs: 20_000, label: "the section heading reads Idioma" });
    check(!/Langue/.test(await page.locator(root || "body").first().innerText()), "no French left on a Spanish page");
    // The four choices sit on one even grid, at a phone's width too.
    await spanish.scrollIntoViewIfNeeded();
    const boxes = await page.locator(`${root}[role="group"] button[aria-pressed]`).filter({ hasText: /Automático|English|Français|Español/ }).evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map((box) => ({ width: Math.round(box.width), height: Math.round(box.height) })));
    check(boxes.length === 4 && boxes.every((box) => Math.abs(box.width - boxes[0].width) <= 1 && box.height >= 40), `four language buttons of one size, finger-high: ${JSON.stringify(boxes)}`);
    await t.shot("spanish-live");
    if (!t.app) {
      await page.reload();
      await eventually(async () => /Idioma/.test(await page.locator("body").innerText()), { timeoutMs: 20_000, label: "Spanish after a reload" });
      const ssr = await (await page.request.get(page.url())).text();
      check(/lang="es"/.test(ssr), "the server renders <html lang=es> from the cookie");
      await t.shot("spanish-reload");
    }
    const hydrationEs = errors.filter((text) => /hydrat|did not match|Minified React error #4(18|19|23|25)/i.test(text));
    check(hydrationEs.length === 0, `no hydration error in Spanish: ${hydrationEs.join(" | ")}`);
    await t.tap(page.locator(`${root}button[aria-pressed]`).filter({ hasText: /Automático|Automatic/ }).first());
    await eventually(async () => /^en/.test(await page.evaluate(() => document.documentElement.lang)), { timeoutMs: 20_000, label: "English back on Automatic after Spanish" });
  },
};
