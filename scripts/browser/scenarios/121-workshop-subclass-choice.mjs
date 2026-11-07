// A workshop subclass whose player picks an option (issue #833: "custom
// subclasses could offer similar selectable options, such as bloodlines,
// elemental affinities"), from the Workshop to the builder, on desktop and
// phone, on the website and in the app's own screens:
//
//   - made in Homebrew: a sorcerer subclass, "Let the player choose" asked
//     for, its label, two options added by name with the species choice's
//     rows, Storm's element and resistance picked with the kit's controls;
//     by day and night, clean under axe, a finger's size on a phone; kept
//     with its choice;
//   - answered as a host from before the field (no `features`), the editor
//     offers no such section (website only: the app keeps one page and its
//     capabilities for 30 seconds);
//   - in the character builder, a level 1 sorcerer on the subclass is asked
//     for the Bloodline, each card saying what its option gives, and Storm
//     is taken.
import { axeViolations, check, eventually, untilStill, upTo } from "../lib.mjs";

const MIN = 39.5;

async function smallTargets(scope) {
  return scope.evaluate((root, min) => {
    const found = [];
    for (const control of root.querySelectorAll('button, [role="button"], input:not([type="hidden"]), textarea')) {
      const target = control.closest("label") ?? control;
      if (!(target instanceof HTMLElement) || !target.offsetWidth || !target.offsetHeight) continue;
      const reach = getComputedStyle(target, "::after");
      const reached = reach.content !== "none" && reach.position === "absolute";
      const stepper = target.closest(".kit-stepper");
      const width = Math.max(target.offsetWidth, reached ? parseFloat(reach.width) : 0);
      const height = Math.max(stepper instanceof HTMLElement ? stepper.offsetHeight : target.offsetHeight, reached ? parseFloat(reach.height) : 0);
      const typed = control.matches("input:not([type=checkbox]):not([type=radio]), textarea");
      const wide = stepper ? 33 : min;
      if (height >= min && (typed || width >= wide)) continue;
      found.push(`${control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 40) || control.tagName} ${Math.round(width)}x${Math.round(height)}`);
    }
    return found;
  }, MIN);
}

async function themed(t, scope, name) {
  const { page } = t;
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await untilStill(page);
    const serious = (await axeViolations(page, scope)).filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    check(!serious.length, `axe finds nothing serious on the ${name} by ${theme === "dark" ? "night" : "day"} (${serious.map((violation) => violation.id).join(", ")})`);
    await t.shot(`${name}-${theme === "dark" ? "night" : "day"}`);
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
}

export default {
  name: "workshop-subclass-choice",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport[0]}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const subclass = `Storm-Blooded ${stamp}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Choice ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    let entryId = null;
    // Pick from a kit select: its trigger, then the row.
    const pick = async (trigger, row) => {
      await t.tap(trigger);
      const item = page.getByRole("menuitemradio", { name: row }).locator("visible=true").first();
      await eventually(() => item.count(), { timeoutMs: 10_000, label: `the row ${row}` });
      await t.tap(item);
      await eventually(async () => (await page.getByRole("menuitemradio").locator("visible=true").count()) === 0, { timeoutMs: 10_000, label: `the menu closed after ${row}` });
    };
    const openEditor = async () => {
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Subclasses/ }));
      const fresh = page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first();
      await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: "New" });
      await t.tap(fresh);
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.getByRole("button", { name: /Add a feature/ }).isVisible(), { timeoutMs: 20_000, label: "the subclass form" });
      return editor;
    };
    const closeDialogs = async () => {
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        await upTo(async () => (await page.getByRole("dialog").count()) === 0, 300);
      }
    };
    try {
      // ---- an older host: no section to write a field it would drop ----
      if (!t.app) {
        await page.route("**/api/capabilities**", async (route) => {
          const response = await route.fetch();
          const body = await response.json().catch(() => ({}));
          delete body.features;
          await route.fulfill({ response, json: body });
        });
        const older = await openEditor();
        await untilStill(page);
        check((await older.getByRole("button", { name: /^Let the player choose \(bloodline/ }).count()) === 0, "an older host's editor offers no subclass choice");
        await page.unroute("**/api/capabilities**");
        await closeDialogs();
      }

      // ---- made in Homebrew ----
      const editor = await openEditor();
      await editor.getByLabel("Name", { exact: true }).fill(subclass);
      await pick(editor.getByRole("button", { name: "Class", exact: true }), "Sorcerer");
      await t.tap(editor.getByRole("button", { name: /Add a feature/ }));
      await editor.getByLabel("Feature name").last().fill("Elemental Affinity");
      const choose = editor.getByRole("button", { name: /^Let the player choose \(bloodline/ });
      await eventually(() => choose.isVisible(), { timeoutMs: 10_000, label: "Let the player choose" });
      await choose.scrollIntoViewIfNeeded();
      await untilStill(page);
      await t.shot("choice-default");
      await t.tap(choose);
      const section = editor.locator("[data-subclass-choice]");
      const label = section.getByLabel("What the player chooses");
      await eventually(() => label.isVisible(), { timeoutMs: 10_000, label: "the choice's label field" });
      await label.fill("Bloodline");
      const newName = section.getByLabel("New option's name");
      const add = section.getByRole("button", { name: /^Add option$/ });
      for (const name of ["Storm", "Frost"]) {
        await newName.fill(name);
        await eventually(() => add.isEnabled(), { timeoutMs: 10_000, label: `Add option, for ${name}` });
        await t.tap(add);
        await eventually(() => section.locator(`[data-subclass-option="${name.toLowerCase()}"]`).count(), { timeoutMs: 10_000, label: `the option ${name}` });
      }
      const storm = section.locator('[data-subclass-option="storm"]');
      // The row just added (Frost) opened; Storm's fields are under its header.
      if (!(await storm.getByRole("button", { name: "Its element" }).isVisible().catch(() => false))) {
        await t.tap(storm.locator("button").first());
      }
      await pick(storm.getByRole("button", { name: "Its element" }), "lightning");
      await t.tap(storm.locator("button[aria-pressed]").filter({ hasText: /^lightning$/ }));
      await eventually(async () => /lightning is its element; resists lightning damage/.test(await storm.innerText()), { timeoutMs: 10_000, label: "what Storm gives, on its header" });
      if (t.touch) {
        const small = await smallTargets(section);
        check(!small.length, `the choice's controls are a finger's size: ${small.join("; ")}`);
      }
      await storm.scrollIntoViewIfNeeded();
      await themed(t, "[data-subclass-choice]", "choice-editor");
      const keep = editor.locator('[data-tour="homebrew-save"]');
      await t.tap(keep);
      const kept = await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/homebrew?kind=archetype`)).json().catch(() => ({ entries: [] }));
          return (body.entries ?? []).find((entry) => entry.name === subclass) ?? null;
        },
        { timeoutMs: 15_000, label: "the subclass on the shelf" },
      );
      entryId = kept.id;
      const [choice] = kept.data.choices ?? [];
      check(choice?.label === "Bloodline" && choice.level === 1, `the choice was kept (${JSON.stringify(choice)})`);
      check((choice?.options ?? []).map((option) => option.id).join() === "storm,frost", "the options were kept with their ids");
      check(choice?.options?.[0]?.damageType === "lightning", "Storm's element was kept");
      check(Boolean(choice?.id), `the choice keeps an id (${choice?.id})`);
      // Each choice is its own row, keyed by its id: a second choice's
      // half-typed option name stays with it when the first is removed.
      await t.tap(section.getByRole("button", { name: /^Add another choice$/ }));
      const second = section.getByRole("group", { name: /^Choice \d$/ });
      await eventually(() => second.count(), { timeoutMs: 10_000, label: "a second choice" });
      await second.getByLabel("New option's name").fill("Zephyr");
      await t.tap(section.getByRole("button", { name: /^Remove Bloodline$/ }));
      const left = section.getByRole("group", { name: /^Choice \d$/ });
      await eventually(async () => (await section.getByRole("group", { name: "Bloodline" }).count()) === 0, { timeoutMs: 10_000, label: "the first choice removed" });
      check((await left.getByLabel("New option's name").inputValue()) === "Zephyr", "the remaining choice keeps what was typed in it");
      await closeDialogs();

      // ---- chosen in the builder ----
      await t.open("/characters/new");
      const startFresh = page.locator(`${root}button`).filter({ hasText: /^Start fresh$/ }).locator("visible=true");
      if (await startFresh.count()) await t.tap(startFresh.first());
      await page.locator(`${root}section[data-active] [data-builder-target="class"]`).locator("visible=true").first().waitFor({ state: "visible", timeout: 30_000 });
      const sorcerer = page.locator(`${root}section[data-active] .creator-card`).filter({ hasText: /^\s*Sorcerer/ }).locator("visible=true").first();
      await eventually(() => sorcerer.count(), { timeoutMs: 20_000, label: "the sorcerer card" });
      await t.tap(sorcerer);
      const picker = page.locator(`${root}section[data-active] [data-builder-target="subclass"] button[aria-haspopup="listbox"]`).locator("visible=true").first();
      await eventually(() => picker.count(), { timeoutMs: 15_000, label: "the subclass list" });
      await t.tap(picker);
      const option = page.locator(`${root}[role="option"]`).filter({ hasText: subclass }).locator("visible=true").first();
      await eventually(() => option.count(), { timeoutMs: 15_000, label: "the workshop subclass offered" });
      await t.tap(option);
      const group = page.locator(`${root}section[data-active]`).getByRole("group", { name: "Bloodline" }).locator("visible=true").first();
      await eventually(() => group.count(), { timeoutMs: 15_000, label: "the Bloodline asked for" });
      const stormCard = group.getByRole("button", { name: /^Storm/ });
      check(/lightning is its element/.test((await stormCard.textContent()) ?? ""), "Storm's card says what it gives");
      await t.tap(stormCard);
      await eventually(async () => (await stormCard.getAttribute("aria-pressed")) === "true", { label: "Storm chosen" });
      if (t.touch) {
        const box = await group.getByRole("button", { name: /^Frost/ }).boundingBox();
        check(Boolean(box && box.height >= MIN), `an option is a finger's height on a phone (${box?.height})`);
      }
      await group.scrollIntoViewIfNeeded();
      await themed(t, `${root}section[data-active] [role="group"][aria-label="Bloodline"]`.trim(), "builder-pick");
    } finally {
      if (entryId) await api.delete(`${base}/api/homebrew/${entryId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
