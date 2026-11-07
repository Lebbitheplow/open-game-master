// A workshop class with a spell list of its own (issue #833), on desktop and
// phone, on the website and in the app's own screens: the class form's
// "Spell list" offers "Its own", which opens a picker over every spell the
// server knows (the SRD's, and the author's homebrew beside them); the picks
// are kept with the class, and the builder offers that class exactly those
// spells, the homebrew one included, and nothing off the list.
import { check, currentStep, eventually, untilStill, upTo } from "../lib.mjs";

export default {
  name: "workshop-spell-lists",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    // Plain names, so the screenshots read as a table would: one left by a
    // stopped run is cleared first (the workshop keeps one entry per name).
    const className = "Runesmith";
    const spellName = "Emberglass Dart";
    for (const kind of ["class", "spell"]) {
      const shelf = await (await api.get(`${base}/api/homebrew?kind=${kind}`)).json().catch(() => ({ entries: [] }));
      for (const entry of shelf.entries ?? []) {
        if (entry.name === className || entry.name === spellName) await api.delete(`${base}/api/homebrew/${entry.id}?purge=1`).catch(() => {});
      }
    }
    const active = `${root}section[data-active]`;
    const setTheme = (mode) =>
      page.evaluate((choice) => {
        window.localStorage.setItem("odm.theme", choice);
        document.documentElement.dataset.theme = choice;
        document.documentElement.style.colorScheme = choice;
      }, mode);
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Spell lists ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    let spellId = null;
    let classEntryId = null;
    try {
      // ---- the class form ----
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Classes/ }));
      const fresh = page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first();
      await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: "New" });
      await t.tap(fresh);
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.getByText("Hit die", { exact: true }).isVisible(), { timeoutMs: 20_000, label: "the class form" });
      await editor.getByLabel("Name", { exact: true }).fill(className);

      // A full caster, then a list of its own: one more choice on the list
      // the form already had.
      await t.tap(editor.getByRole("button", { name: "Spellcasting", exact: true }));
      await t.tap(page.getByRole("menuitemradio", { name: /^Full caster/ }).locator("visible=true").first());
      const listSelect = editor.getByRole("button", { name: "Spell list", exact: true });
      await eventually(() => listSelect.isVisible(), { timeoutMs: 5_000, label: "the spell list choice" });
      await t.tap(listSelect);
      await t.tap(page.getByRole("menuitemradio", { name: "Its own: pick the spells" }).locator("visible=true").first());
      const picker = editor.locator('[data-testid="custom-spell-list"]');
      await eventually(() => picker.isVisible(), { timeoutMs: 5_000, label: "the class's own spell list" });
      check(await editor.getByRole("button", { name: "Gets its spells", exact: true }).isVisible(), "the form asks how it holds its spells");
      // "Add a class's list" reads whole beside the search, a finger's
      // height on a phone.
      const fillSelect = picker.getByRole("combobox", { name: "Add a class's list" });
      check(await fillSelect.isVisible(), "the class's list picker shows");
      const fillBox = await fillSelect.boundingBox();
      if (t.viewport === "phone") check((fillBox?.height ?? 0) >= 40, `the class's list picker is ${fillBox?.height}px tall on a phone`);

      // A cantrip of the author's own, which names no class, made while the
      // form is open: the search finds it at once (it asks the server as
      // the author types), and it is on the list only because it is picked.
      const brewed = await api.post(`${base}/api/homebrew`, {
        data: { kind: "spell", name: spellName, data: { desc: "A shard of glowing glass.", level: 0, school: "evocation", classes: [] } },
      });
      check(brewed.ok(), "the homebrew cantrip is kept");
      spellId = (await brewed.json()).entry.id;

      // A half caster learns no cantrips: the picker says so and offers none.
      await t.tap(editor.getByRole("button", { name: "Spellcasting", exact: true }));
      await t.tap(page.getByRole("menuitemradio", { name: /^Half caster/ }).locator("visible=true").first());
      await eventually(() => picker.locator('[data-testid="no-cantrips-hint"]').isVisible(), { timeoutMs: 5_000, label: "the half caster's no-cantrips hint" });
      const halfSearch = picker.getByLabel("Find a spell to add to the class's list");
      await halfSearch.fill("fire");
      const halfResults = picker.getByRole("list", { name: "Spells to add" }).getByRole("button");
      await eventually(() => halfResults.filter({ hasText: "Fireball" }).count(), { timeoutMs: 15_000, label: "a levelled fire spell offered to a half caster" });
      check((await halfResults.filter({ hasText: "Fire Bolt" }).count()) === 0, "a half caster's picker offered a cantrip");
      await halfSearch.fill("");
      await t.tap(editor.getByRole("button", { name: "Spellcasting", exact: true }));
      await t.tap(page.getByRole("menuitemradio", { name: /^Full caster/ }).locator("visible=true").first());
      await eventually(async () => (await picker.locator('[data-testid="no-cantrips-hint"]').count()) === 0, { timeoutMs: 5_000, label: "the full caster's picker" });

      // Picked from the SRD's and the author's homebrew, found by name.
      const search = picker.getByLabel("Find a spell to add to the class's list");
      for (const [typed, name] of [["fire bo", "Fire Bolt"], ["shield", "Shield"], ["emberglass dart", spellName]]) {
        await search.fill(typed);
        const result = picker.getByRole("list", { name: "Spells to add" }).getByRole("button").filter({ hasText: name }).first();
        await eventually(() => result.isVisible(), { timeoutMs: 15_000, label: `${name} offered` });
        await t.tap(result);
        await eventually(() => picker.getByRole("button", { name: `Take ${name} off the list` }).isVisible(), { timeoutMs: 5_000, label: `${name} on the list` });
      }
      await search.fill("");
      check(/3 spells on the list/.test((await picker.textContent()) ?? ""), "the list counts its three spells");
      await untilStill(page);
      await listSelect.scrollIntoViewIfNeeded();
      await t.shot("custom-spell-list");
      // The picks and the two ways to add, which sit lower on a phone.
      await picker.getByRole("combobox", { name: "Add a class's list" }).scrollIntoViewIfNeeded();
      await t.shot("custom-spell-list-picks");
      // And by day, the theme a player may have saved.
      await setTheme("light");
      await untilStill(page);
      await t.shot("custom-spell-list-day");
      await setTheme("dark");

      const keep = editor.locator('[data-tour="homebrew-save"]');
      await t.tap(keep);
      const kept = await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/homebrew?kind=class`)).json().catch(() => ({ entries: [] }));
          return (body.entries ?? []).find((entry) => entry.name === className) ?? null;
        },
        { timeoutMs: 15_000, label: "the class on the shelf" },
      );
      classEntryId = kept.id;
      check(kept.data.spellListFrom === "custom", `the class keeps a list of its own (${kept.data.spellListFrom})`);
      check(JSON.stringify([...(kept.data.spellList ?? [])].sort()) === JSON.stringify(["Fire Bolt", "Shield", spellName].sort()), `the list keeps its picks (${kept.data.spellList})`);
      check(kept.data.spellStyle === "prepared", "a new list prepares its spells by default");
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        await upTo(async () => (await page.getByRole("dialog").count()) === 0, 300);
      }

      // ---- the server's pool for the class: its list, nothing else ----
      const classId = `homebrew-${classEntryId}`;
      const pool = await (await api.get(`${base}/api/content/spells?class=${classId}&level=1&limit=200`)).json();
      const pooled = (pool.results ?? []).map((row) => row.name);
      check(pooled.includes(spellName), `the class's search answers its homebrew cantrip (${pooled.join(", ")})`);

      // ---- the builder offers the class its own spells ----
      await t.open("/characters/new");
      const startFresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
      if (await upTo(() => startFresh.count(), 1_500)) await t.tap(startFresh.first());
      // The class list is long; its own search finds the class.
      const classSearch = page.locator(`${active} input[placeholder^="Search"]`).locator("visible=true").first();
      await eventually(() => classSearch.count(), { timeoutMs: 30_000, label: "the class search" });
      await classSearch.fill(className);
      const card = page.locator(`${active} .creator-card`).filter({ hasText: className }).locator("visible=true").first();
      await eventually(() => card.count(), { timeoutMs: 30_000, label: "the class's card in the builder" });
      await t.tap(card);
      // On to the spell step, the build's fill taking what each step owes.
      const spellsStep = async () => /spell/i.test(await currentStep(page, root));
      const fill = page.locator(`${active} [data-quick-fill]`).locator("visible=true");
      for (let step = 0; step < 6 && !(await spellsStep()); step += 1) {
        if (await upTo(() => fill.count(), 1_500)) {
          await t.tap(fill.first());
          await eventually(() => page.locator(`${root}[data-quick-readback]`).count(), { timeoutMs: 20_000, label: "the read-back" });
          await t.tap(page.locator(`${root}button`).filter({ hasText: /^Keep them$/ }).first());
          await eventually(async () => (await page.locator(`${root}[data-quick-readback]`).locator("visible=true").count()) === 0, { timeoutMs: 10_000, label: "the read-back closing" });
          if (await spellsStep()) break;
        }
        const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
        if (await next.isEnabled().catch(() => false)) await t.tap(next);
        await upTo(spellsStep, 2_000);
      }
      check(await spellsStep(), `the builder reached its spell step (${await currentStep(page, root)})`);
      const stepText = async () => (await page.locator(active).first().textContent()) ?? "";
      await eventually(async () => (await stepText()).includes(spellName), { timeoutMs: 20_000, label: "the homebrew cantrip offered on the spell step" });
      const shown = await stepText();
      check(shown.includes("Fire Bolt"), "Fire Bolt, on the list, is offered");
      check(!shown.includes("Sacred Flame") && !shown.includes("Ray of Frost"), "a cantrip off the list is not offered");
      check(!shown.includes("homebrew-"), "the step names the class, never its id");
      check(/Prepared: .* level 1 \+ INT \+\d = \d/.test(shown), "the class prepares spells, counted as a cleric's: level + Intelligence");
      await untilStill(page);
      await t.shot("builder-own-list");
      await setTheme("light");
      await untilStill(page);
      await t.shot("builder-own-list-day");
      await setTheme("dark");
    } finally {
      if (classEntryId) await api.delete(`${base}/api/homebrew/${classEntryId}?purge=1`).catch(() => {});
      if (spellId) await api.delete(`${base}/api/homebrew/${spellId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
