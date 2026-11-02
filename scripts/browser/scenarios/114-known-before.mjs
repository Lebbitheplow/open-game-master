// Issue 731: a person the whole party already knows when the story begins.
// In the workshop's NPC editor, "Before the story" asks it in one labelled
// picker; choosing a grade opens a labelled line for how the party knows
// them, marked as needed until it says something, and the save keeps both.
// The section is gone for a person hostile to the party. Finger-sized on a
// phone, legible by night and by day, clean under axe. At a table that began
// with such a person, both heroes' bonds with her show on the Bonds tab at
// Cordial, her line beneath.
import { axeViolations, check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const QUESTION = "Does the whole party already know them when the story begins?";

const scenario = {
  name: "known-before",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, api, base, root, ids, viewport } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Known ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    try {
      await t.open(`/workshop/${id}?system=cast`);
      const someone = page.locator('[data-tour="cast-new"]').locator("visible=true").first();
      await eventually(() => someone.count(), { timeoutMs: 30_000, label: "Someone new in the cast" });
      await t.tap(someone);
      const section = page.locator(`${root}[data-tour="cast-known-before"]`).locator("visible=true").first();
      await eventually(() => section.count(), { timeoutMs: 20_000, label: "Before the story in the NPC editor" });
      check((await section.textContent())?.includes(QUESTION), "the question is written out where it is asked");
      const picker = section.getByRole("button", { name: QUESTION });
      check(await picker.count(), "the picker is named for screen readers");
      check(/meet in the story/i.test((await picker.textContent()) ?? ""), "strangers by default");
      const pickerBox = await picker.boundingBox();
      check(pickerBox && pickerBox.height >= (t.touch ? 40 : 32), `a finger-sized picker (${pickerBox?.height})`);

      await section.scrollIntoViewIfNeeded();
      await untilStill(page);
      await section.screenshot({ path: t.shotPath("default"), animations: "disabled" }).catch(() => {});
      await t.tap(picker);
      const friends = page.getByRole("menuitemradio", { name: /^Friends/ }).locator("visible=true").first();
      await eventually(() => friends.count(), { label: "the grades listed" });
      check(/Cordial/.test((await friends.textContent()) ?? ""), "each grade says where the bonds open");
      await t.tap(friends);
      const how = section.getByRole("textbox", { name: "How the party knows them" });
      await eventually(() => how.count(), { label: "the line for how they know each other" });
      check((await how.getAttribute("aria-invalid")) === "true", "marked as needed while empty");
      check(/Needed\./.test((await section.textContent()) ?? ""), "and says so in words");
      const howBox = await how.boundingBox();
      check(howBox && howBox.height >= (t.touch ? 40 : 32), `a finger-sized line (${howBox?.height})`);
      await how.fill("She hired you twice to guard her caravans.");
      check((await how.getAttribute("aria-invalid")) === "false", "no longer marked once it says something");
      await untilStill(page);
      const found = await axeViolations(page, `${root}[data-tour="cast-known-before"]`);
      check(!found.length, `axe on Before the story: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
      await section.screenshot({ path: t.shotPath("editor"), animations: "disabled" }).catch(() => {});
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      const day = await axeViolations(page, `${root}[data-tour="cast-known-before"]`);
      check(!day.length, `axe on Before the story by day: ${day.map((entry) => entry.id).join(", ")}`);
      await section.screenshot({ path: t.shotPath("editor-day"), animations: "disabled" }).catch(() => {});
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // Saved with the person, and read back.
      await page.getByPlaceholder("Their name").locator("visible=true").first().fill("Maren Dusk");
      await t.tap(page.locator(`${root}[data-tour="cast-save"]`).locator("visible=true").first());
      await eventually(
        async () => {
          const list = await (await api.get(`${base}/api/campaigns/${id}/dm/npcs`)).json();
          const maren = (list.npcs ?? []).find((npc) => npc.name === "Maren Dusk");
          return maren?.knownBefore?.grade === "friend" && maren.knownBefore.how === "She hired you twice to guard her caravans.";
        },
        { timeoutMs: 20_000, label: "the tie saved with her" },
      );

      // Nobody hostile to the party is their friend from the start.
      const attitude = page.getByRole("button", { name: "Attitude to the party" }).locator("visible=true").first();
      await t.tap(attitude);
      await t.tap(page.getByRole("menuitemradio", { name: /Hostile to the party/ }).locator("visible=true").first());
      await eventually(async () => (await page.locator(`${root}[data-tour="cast-known-before"]`).locator("visible=true").count()) === 0, {
        label: "Before the story gone for a hostile person",
      });
    } finally {
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }

    // A table that began with her: both heroes know her, at Cordial, and why.
    await t.open(`/campaigns/${ids.knownTables[viewport]}`);
    await openPanelTab(t, "party");
    const bondsTab = page.locator(`${root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
    await eventually(() => bondsTab.count(), { timeoutMs: 30_000, label: "the Bonds sub-tab" });
    await t.tap(bondsTab);
    const rows = page.locator(`${root}[data-bond-row="Maren Dusk"]`).locator("visible=true");
    await eventually(() => rows.count().then((count) => count === 2), { timeoutMs: 20_000, label: "her bond under both heroes" });
    for (const text of await rows.allTextContents()) {
      check(/Cordial/.test(text), `opened at Cordial (${text.slice(0, 120)})`);
      check(text.includes("She hired you twice to guard her caravans."), "her line beneath it");
    }
    await untilStill(page);
    const bondAxe = await axeViolations(page, `${root}[data-bond-row="Maren Dusk"]`);
    check(!bondAxe.length, `axe on a known-before bond: ${bondAxe.map((entry) => entry.id).join(", ")}`);
    await t.shot("bonds");

    // A GM marks their own table's people in the console's Cast tab (the
    // lobby has no cast editor), which offers the section until the GM's
    // first narration: this table has begun and its GM has not narrated.
    await openPanelTab(t, "dm");
    const castTab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: /^cast$/i }).locator("visible=true").first();
    await eventually(() => castTab.count(), { timeoutMs: 30_000, label: "the console's Cast tab" });
    await t.tap(castTab);
    // The console's Cast opens on a new person's form.
    const consoleSection = page.locator(`${root}[data-tour="cast-known-before"]`).locator("visible=true").first();
    await eventually(() => consoleSection.count(), {
      timeoutMs: 30_000,
      label: "Before the story in the console before the first narration",
    });
    await consoleSection.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("console");
  },
};

export default scenario;
