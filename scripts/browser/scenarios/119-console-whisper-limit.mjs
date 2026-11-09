// The console's Whisper box stops at the note send_whisper takes (2,000
// characters, src/lib/dm/whisper-limits.ts) instead of the call being
// refused after the GM wrote past it (0.34.0 report: notes of 1,029 to
// 1,251 characters refused with a line that named the wrong cause). A
// 1,251-character note fits. The seed's Enemy Turn Table, which the
// signed-in player runs.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const scenario = {
  name: "console-whisper-limit",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.enemyTurns[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^story$/i }).locator("visible=true").first();
    await eventually(() => tab.count(), { timeoutMs: 30_000, label: "the console's Story tab" });
    await t.tap(tab);
    const open = page.getByRole("button", { name: /^Whisper\b/ }).locator("visible=true").first();
    await eventually(() => open.count(), { label: "the console's Whisper" });
    await t.tap(open);
    await untilStill(page);

    const box = page.getByRole("textbox", { name: "Message", exact: true }).locator("visible=true").first();
    await eventually(() => box.count(), { label: "the Message box" });
    check((await box.getAttribute("maxlength")) === "2000", "the Message box stops at 2,000 characters");
    await box.fill("a".repeat(1251));
    check((await box.inputValue()).length === 1251, "a 1,251-character note fits");
    await box.fill("b".repeat(2100));
    check((await box.inputValue()).length === 2000, "a note past 2,000 characters stops at the limit");
    await t.shot("whisper");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("whisper-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
  },
};

export default scenario;
