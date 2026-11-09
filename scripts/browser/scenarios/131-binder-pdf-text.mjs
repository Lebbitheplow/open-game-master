// A rules PDF attached to a lore entry is read by the page with pdf.js and
// its words sent with it, so the GM's rules search reads the book's words.
// The server's own reader returned glyph codes for most published books
// (their fonts are subset with codes of their own), and the rules search
// was fed those. On the website and in the app's own screens.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adventurePdf } from "../../lib/pdf-fixture.mjs";
import { check, eventually, untilStill } from "../lib.mjs";

let bookFile = "";
async function book() {
  if (!bookFile) {
    bookFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-binder-")), "house-book.pdf");
    fs.writeFileSync(bookFile, await adventurePdf());
  }
  return bookFile;
}

export default {
  name: "binder-pdf-text",
  viewports: ["desktop"],
  async run(t) {
    const { page, base, api } = t;
    const stamp = `${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Binder ${stamp}`, description: "" } });
    const workshopId = (await made.json()).workshop?.id;
    check(Boolean(workshopId), "a workshop to write lore in");
    await t.open(`/workshop/${workshopId}?system=lore`);
    await page.getByText("New entry", { exact: false }).first().click();
    await page.getByPlaceholder(/^Title/).fill(`House rules book ${stamp}`);
    await page.getByPlaceholder(/What is established about it/).fill("The table's house book.");
    await page.getByPlaceholder(/^Tags/).fill("rules");
    await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(await book());
    await eventually(() => page.getByText("Replace the PDF").count().then((count) => count > 0), { label: "the PDF uploaded", timeoutMs: 60_000 });
    await page.getByRole("button", { name: /^(Add|Save)$/ }).first().click();
    await untilStill(page);
    const entry = await eventually(
      async () => {
        const listed = await api.get(`${base}/api/campaigns/${workshopId}/lore`);
        const body = await listed.json().catch(() => ({}));
        return (body.entries ?? body.lore ?? []).find((row) => row.title === `House rules book ${stamp}`) ?? null;
      },
      { label: "the entry saved", timeoutMs: 20_000 },
    );
    const read = await api.get(`${base}/api/campaigns/${workshopId}/lore/${entry.id}/attachment-text`);
    const state = await read.json();
    check(state.read === true, "the page's reading of the PDF arrived with it");
    check(state.feedsRules === true, "the entry feeds the rules search");
    // The lead's shelf is shared with later scenarios (empty-states reads it as
    // empty, world-pack-omissions counts its hand-built monsters), so the
    // workshop made here goes again, as pdf-import's does.
    const removed = await api.delete(`${base}/api/workshops/${workshopId}`);
    check(removed.ok(), `the binder's workshop is removed again (HTTP ${removed.status()})`);
  },
};
