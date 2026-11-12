// Issue 917: a line a short tag splits ("Two roads," she says. "Pick
// one.") was drawn as two cards for one speaker, the tag stranded between
// them as prose. Each split line is one card now, the tag kept inside it
// upright; a reply from someone else is still a card of its own. Checked by
// night and by day, clean under axe.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await untilStill(page);
}

export default {
  name: "split-line",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    await t.open(`/campaigns/${ids.splitLineTables[viewport]}`);
    const narration = page.locator(`${root}.narration`).filter({ hasText: "Two roads" }).locator("visible=true").last();
    await eventually(() => narration.count(), { timeoutMs: 30_000, label: "the passage with the split lines" });
    await narration.scrollIntoViewIfNeeded();
    // textContent, not innerText: the speaker's name is uppercased by CSS.
    const cards = await narration.locator("p.eyebrow").evaluateAll((names) =>
      names.map((name) => `${name.textContent}: ${name.parentElement?.querySelector("p:not(.eyebrow)")?.textContent ?? ""}`),
    );
    check(
      JSON.stringify(cards) ===
        JSON.stringify(["Marla: We ride at dawn, said Marla, and not a moment later.", "Old Pike: Aye,", "Marla: Two roads, she says. Pick one."]),
      `one card per split line, Old Pike's apart: ${JSON.stringify(cards)}`,
    );
    const prose = await narration.locator(":scope > div > p").allTextContents();
    check(!prose.some((text) => /^\s*(she says\.|said Marla,)\s*$/.test(text)), `no tag stranded between cards: ${JSON.stringify(prose)}`);
    const tag = narration.locator(".speech-tag").first();
    for (const theme of ["dark", "light"]) {
      await inTheme(page, theme);
      const style = await tag.evaluate((element) => getComputedStyle(element).fontStyle);
      check(style === "normal", `the tag is upright by ${theme === "dark" ? "night" : "day"} (${style})`);
      const found = await axeViolations(page, `${root}.narration`);
      check(!found.length, `axe on the passage by ${theme === "dark" ? "night" : "day"}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 400)}`);
      await t.shot(`split-line-${theme}`);
    }
    await inTheme(page, "dark");
  },
};
