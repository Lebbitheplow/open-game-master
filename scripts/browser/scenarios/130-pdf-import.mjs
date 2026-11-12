// "Import an adventure PDF" (the adventure import, src/lib/pdf-import/*),
// end to end in a real browser, on the website and in the app's own
// screens, at desktop and phone width: the page reads a book with pdf.js
// (its worker started from /pdfjs, which the apps carry), sends the pages
// and the pictures worth keeping, the server reads the layout, and the
// review shows what the book became, the map's picture among it. Imported,
// it is a new workshop of the importer's own. The review is clean under axe
// by day and night.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adventurePdf } from "../../lib/pdf-fixture.mjs";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

let bookFile = "";
async function book() {
  if (!bookFile) {
    bookFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-pdf-book-")), "the-sunken-mill.pdf");
    fs.writeFileSync(bookFile, await adventurePdf());
  }
  return bookFile;
}

export default {
  name: "pdf-import",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api } = t;
    await t.open("/workshop");
    const importer = page.locator('[data-testid="pdf-import"]').first();
    await importer.waitFor({ state: "visible", timeout: 30_000 });
    await importer.locator('input[type="file"]').setInputFiles(await book());

    // The page reads the book, then the server does; the review follows.
    const review = page.locator('[data-testid="pdf-review"]').first();
    await review.waitFor({ state: "visible", timeout: 120_000 });
    await untilStill(page);
    const title = await review.locator("input").first().inputValue();
    check(title === "The Sunken Mill", `the workshop is named from the book's title (got "${title}")`);
    for (const group of ["Creatures", "Places", "Roll tables", "Maps", "Pictures", "Storyboard cards"]) {
      check((await review.locator("section button", { hasText: group }).count()) > 0, `the review lists the book's ${group.toLowerCase()}`);
    }

    // The map came across as a picture the review can show.
    await review.locator("section button", { hasText: "Maps" }).first().click();
    await review.locator('[data-record^="map:"] button[aria-expanded]').first().click();
    const shown = await eventually(
      () => review.locator('[data-record^="map:"] img').first().evaluate((image) => image.complete && image.naturalWidth > 0).catch(() => false),
      { label: "the map's picture shows in the review", timeoutMs: 20_000 },
    );
    check(shown, "the map's picture shows in the review");

    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
      const serious = (await axeViolations(page, '[data-testid="pdf-review"]')).filter((violation) => violation.impact === "serious" || violation.impact === "critical");
      check(!serious.length, `axe finds nothing serious on the review by ${theme === "dark" ? "night" : "day"} (${serious.map((violation) => violation.id).join(", ")})`);
      await t.shot(`pdf-review-${theme === "dark" ? "night" : "day"}`);
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    const stamp = `${t.viewport[0]}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    await review.locator("input").first().fill(`Sunken Mill ${stamp}`);
    await review.locator("button", { hasText: "Make the workshop" }).click();
    const made = await eventually(
      async () => {
        const listed = await api.get(`${base}/api/workshops`);
        const body = await listed.json().catch(() => ({}));
        return (body.workshops ?? []).find((workshop) => workshop.title === `Sunken Mill ${stamp}`) ?? null;
      },
      { label: "the imported workshop exists", timeoutMs: 30_000 },
    );
    check(Boolean(made), "the book became a workshop of the importer's own");
    // The lead's shelf is shared with later scenarios (empty-states reads it
    // as empty), so the workshop made here goes again.
    const removed = await api.delete(`${base}/api/workshops/${made.id}`);
    check(removed.ok(), `the imported workshop is removed again (HTTP ${removed.status()})`);
  },
};
