// The review's "Match to SRD 5.1" (src/app/workshop/pdf-import/PdfMatches.tsx)
// on an Old-School module with no model: a creature the SRD has no name for
// and one whose name only ends in an SRD one each start on a suggestion,
// the workshop waits until both are confirmed, one is changed to keep the
// book's own numbers, "Accept the rest" confirms the other, and the
// workshop is made. The step is clean under axe by day and night. The SRD
// to match to is the content pack: with none (CI's browser run) the step
// never shows and the book is made at once, which is checked instead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { oldSchoolPdf } from "../../lib/pdf-fixture.mjs";
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const TREE = path.resolve(import.meta.dirname, "..", "..", "..");
const hasPack = () => fs.existsSync(process.env.CONTENT_DB_PATH ?? path.join(TREE, "data", "content", "open5e.sqlite"));

let bookFile = "";
async function book() {
  if (!bookFile) {
    bookFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-pdf-os-")), "the-glass-tower.pdf");
    fs.writeFileSync(bookFile, await oldSchoolPdf());
  }
  return bookFile;
}

export default {
  name: "pdf-matches",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, api } = t;
    await t.open("/workshop");
    const importer = page.locator('[data-testid="pdf-import"]').first();
    await importer.waitFor({ state: "visible", timeout: 30_000 });
    await importer.locator('input[type="file"]').setInputFiles(await book());

    const review = page.locator('[data-testid="pdf-review"]').first();
    await review.waitFor({ state: "visible", timeout: 120_000 });
    await untilStill(page);
    const matches = review.locator('[data-testid="pdf-matches"]');
    const make = review.locator("button", { hasText: "Make the workshop" });
    const stamp = `${t.viewport[0]}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const madeWorkshop = async () => {
      await review.locator("input").first().fill(`Glass Tower ${stamp}`);
      await make.click();
      const made = await eventually(
        async () => {
          const listed = await api.get(`${base}/api/workshops`);
          const body = await listed.json().catch(() => ({}));
          return (body.workshops ?? []).find((workshop) => workshop.title === `Glass Tower ${stamp}`) ?? null;
        },
        { label: "the imported workshop exists", timeoutMs: 30_000 },
      );
      // The lead's shelf is shared with later scenarios (empty-states reads
      // it as empty), so the workshop made here goes again.
      const removed = await api.delete(`${base}/api/workshops/${made.id}`);
      check(removed.ok(), `the imported workshop is removed again (HTTP ${removed.status()})`);
      return made;
    };
    if (!hasPack()) {
      check((await matches.count()) === 0, "with no content pack there is no SRD to match to, so no match step");
      check(await make.isEnabled(), "and nothing holds the workshop back");
      check(Boolean(await madeWorkshop()), "the book became a workshop with no content pack");
      return;
    }
    check((await matches.count()) === 1, "the review asks for the creatures' SRD 5.1 matches");
    const rows = matches.locator("[data-match]");
    check((await rows.count()) === 2, `two creatures to match (got ${await rows.count()})`);
    const golem = rows.filter({ hasText: "Glass Golem" }).first();
    const ooze = rows.filter({ hasText: "Starved Grey Ooze" }).first();
    const golemPick = await golem.locator("select").inputValue();
    check(/Golem$/.test(golemPick), `the golem starts on an SRD golem (got "${golemPick}")`);
    check((await ooze.locator("select").inputValue()) === "Gray Ooze", "the ooze starts on the SRD's Gray Ooze");

    check(await make.isDisabled(), "the workshop waits until every match is confirmed");

    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await untilStill(page);
      const serious = (await axeViolations(page, '[data-testid="pdf-matches"]')).filter((violation) => violation.impact === "serious" || violation.impact === "critical");
      check(!serious.length, `axe finds nothing serious on the match step by ${theme === "dark" ? "night" : "day"} (${serious.map((violation) => violation.id).join(", ")})`);
      await t.shot(`pdf-matches-${theme === "dark" ? "night" : "day"}`);
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    // The golem keeps the book's own numbers: choosing is confirming.
    await golem.locator("select").selectOption("__keep");
    await eventually(() => golem.getByRole("button", { name: /confirmed$/ }).count().then((count) => count > 0), { label: "the golem's choice is confirmed", timeoutMs: 15_000 });
    check(await make.isDisabled(), "one match is still waiting");
    // The search finds any SRD creature by part of its name.
    await ooze.getByRole("button", { name: /Search every SRD 5\.1 creature/ }).click();
    await ooze.getByPlaceholder("A creature's name").fill("ochre");
    check((await ooze.locator("button", { hasText: "Ochre Jelly" }).count()) === 1, "the search finds the Ochre Jelly");
    await ooze.getByPlaceholder("A creature's name").press("Escape");
    check((await ooze.getByPlaceholder("A creature's name").count()) === 0, "Escape closes the search");
    // Confirming keeps the keyboard on the same button.
    const confirm = ooze.getByRole("button", { name: /Confirm Gray Ooze/ });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await eventually(() => ooze.getByRole("button", { name: /confirmed$/ }).evaluate((button) => button === document.activeElement).catch(() => false), {
      label: "focus stays on the row's button once confirmed",
      timeoutMs: 15_000,
    });
    await eventually(() => make.isEnabled(), { label: "every match confirmed", timeoutMs: 15_000 });

    check(Boolean(await madeWorkshop()), "the book became a workshop once its matches were confirmed");
  },
};
