// Issue 230: the travel formation. The lead arranges who walks first in the
// Party panel, saves it, and the order shows there in force; the order is
// campaign state the DM reads every turn (src/lib/dm/formation-logic.ts).
import { check, eventually, untilStill } from "../lib.mjs";

// The section's words as written: the buttons are uppercased by CSS, which
// innerText would report.
const words = (section) => section.evaluate((node) => node.textContent.replace(/\s+/g, " "));

export default {
  name: "travel-formation",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    const section = page.locator(`${root}section[aria-label="Travel formation"]`).locator("visible=true").first();
    // The desktop rail shows the roster beside the board; a phone opens the
    // Party tab first.
    if (!(await section.count())) {
      const tab = page
        .locator(`${root}button, ${root}[role="tab"]`)
        .filter({ hasText: /^\s*party\s*$/i })
        .locator("visible=true");
      await eventually(() => tab.count(), { label: "the Party tab" });
      await t.tap(tab.first());
    }
    await section.waitFor({ state: "visible", timeout: 30_000 });
    await section.scrollIntoViewIfNeeded();
    await t.tap(section.locator("button").filter({ hasText: /Arrange the formation|Rearrange the formation/i }).first());
    // The editor starts from the order in force (an earlier viewport may
    // have saved one); whoever walks second goes to the front.
    const names = () => section.locator("li .truncate").allTextContents();
    await eventually(async () => (await names()).length >= 2, { label: "the party in the editor" });
    const [first, second] = await names();
    await t.tap(section.locator(`button[aria-label="Move ${second} toward the front"]`).first());
    const landing = await section
      .locator('li.formation-row[data-moved="true"]')
      .first()
      .evaluate((moved) => moved.getAnimations().length)
      .catch(() => 0);
    check(landing > 0, `${second} animates as they move to the front`);
    await eventually(async () => (await names())[0] === second, { label: `${second} moving to the front` });
    const ahead = new RegExp(`${second}.*${first}`);
    await t.shot("editing");
    const saved = page.waitForResponse((response) => response.url().includes("/party/formation") && response.request().method() === "POST");
    await t.tap(section.locator("button").filter({ hasText: /^\s*Save now\s*$/i }).first());
    const response = await saved;
    check(response.ok(), `Save now answered ${response.status()}: ${(await response.text()).slice(0, 200)}`);
    await eventually(async () => {
      const text = await words(section);
      return ahead.test(text) && /Rearrange the formation/.test(text);
    }, { timeoutMs: 20_000, label: `the saved order, ${second} in front, without a reload` });
    // The rows stagger in; the picture waits for them, and every row lands.
    // A row re-rendered mid-entrance cancels its animation, and a cancelled
    // animation rejects `finished` (an AbortError): it has stopped all the
    // same, and the row that replaced it brings its own entrance.
    await section.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
    await untilStill(page);
    const shown = await section.locator("li.formation-row").evaluateAll((rows) => rows.map((row) => Number(getComputedStyle(row).opacity)));
    check(shown.length >= 2 && shown.every((opacity) => opacity > 0.95), `every saved row is shown (${shown.join(", ")})`);
    await t.shot("saved");
    // A reload reads the same order back from the party record.
    await t.open(`/campaigns/${ids.campaignId}`);
    if (!(await section.count())) {
      const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*party\s*$/i }).locator("visible=true");
      await t.tap(tab.first());
    }
    await section.waitFor({ state: "visible", timeout: 30_000 });
    check(ahead.test(await words(section)), "the order holds after a reload");
  },
};
