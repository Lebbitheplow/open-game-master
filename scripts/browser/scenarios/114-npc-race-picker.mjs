// The NPC form's Race, beside Gender: the pair picks the stand-in face, so
// an elf archer in the Cast draws the elf archer plate (PR 710's art), and
// the card in the list follows the record. A finger-sized select, named for
// screen readers, clean under axe, legible night and day, phone and desktop.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "npc-race-picker",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Race faces", description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["world", "cast"].map((tool) => ({ id: `workshop-${tool}`, version: 1, how: "ended" })) } });
    try {
      const saved = await api.post(`${base}/api/campaigns/${id}/dm/npcs`, {
        data: { draft: { name: "Ilya Thornwood", role: "archer", gender: "Female", race: "wood_elf", attitude: "friendly", trait: "Keeps watch on the north road." } },
      });
      check(saved.ok(), `the NPC was saved (${saved.status()})`);
      const npc = (await saved.json()).npc;
      check(npc.race === "wood_elf", `the record holds the race (${npc.race})`);

      await t.open(`/workshop/${id}?system=cast`);
      const card = page.locator(`${root}button`, { hasText: "Ilya Thornwood" }).locator("visible=true").first();
      await card.waitFor({ state: "visible", timeout: 30_000 });
      await t.tap(card);
      const dialog = page.getByRole("dialog", { name: "Ilya Thornwood" });
      await eventually(() => dialog.count(), { timeoutMs: 30_000, label: "Ilya's editor open" });
      const race = dialog.getByRole("button", { name: "Race" }).locator("visible=true").first();
      await race.waitFor({ state: "visible", timeout: 20_000 });
      check(/Elf \(Wood\)/.test((await race.innerText()) ?? ""), `the picker shows the stored race (${await race.innerText()})`);
      // A finger-sized target where fingers are: the kit's select, as Gender's.
      if (t.touch) {
        const box = await race.boundingBox();
        check(box && box.height >= 40, `a finger-sized select on a phone (${box?.height})`);
      }
      await race.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await untilStill(page);
      const found = await axeViolations(page, `${root}[role="dialog"]`);
      check(!found.length, `axe on the NPC form: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
      await t.shot("race-night");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      await t.shot("race-day");
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

      // The list's card behind the form draws the face the record picks.
      const face = await page
        .locator(`${root}img[src*="enemy-npc/archer-elf-feminine"]`)
        .count();
      check(face > 0, "the Cast list draws Ilya as the elf archer");
    } finally {
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
