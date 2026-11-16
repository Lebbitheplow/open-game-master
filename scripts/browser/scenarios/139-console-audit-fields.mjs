// The 2026-11-15 rules audit's new GM console fields and the workshop's new
// chip, where a person meets them. Each field shows on a host that offers it,
// labelled, at its default (nothing picked, off or empty), a finger's height
// on a phone, clean under axe and legible in the night and day themes:
//   Learn a spell: "A wizard copies it from" (scrollCopy), a scroll or a book;
//   Cast at a player: "Their pet" (petSaves);
//   Hazard: "Enemies caught in it" (enemyHazards), "Frigid water" and its
//   "Minutes in the water" (frigidWater), "Set it on the board" and its
//   square (setTraps);
//   Break something: "Manacles on" (manaclesBound);
//   Enemy attacks and Pet attacks: "Ran straight at the target first"
//   (chargeRuns); Enemy attacks: "At their pet" (petStrikes);
//   the workshop item editor's check bonuses: "picking locks" (itemLockBonus).
// The party panel shows the wizard's cat with the net's restrained on it (P01).
// Answered as a host from before them (no `features`), each is left out, since
// that host would strip what it asks unread. That pass runs on the website
// only: the app keeps one page and its capabilities for 30 seconds. Nothing is
// run: the seed's Audit Fields Table, one per viewport, stays as it was.
import { axeViolations, check, eventually, openPanelTab, untilStill, upTo } from "../lib.mjs";

// Each form, the console tab that holds it, and its new fields. `empty` is
// what a pick shows before anything is picked; `options` what it offers.
const FORMS = [
  {
    key: "learn-spell",
    tab: "party",
    plate: "Learn a spell",
    anchor: { kind: "text", label: "Spell" },
    fields: [{ kind: "select", label: "A wizard copies it from", empty: /^Not set$/, options: ["A spell scroll they carry", "Another spellbook or a teacher"] }],
  },
  {
    key: "cast-at-player",
    tab: "combat",
    plate: "Cast at a player",
    anchor: { kind: "select", label: "Save" },
    fields: [{ kind: "text", label: "Their pet" }],
  },
  {
    key: "hazard",
    tab: "combat",
    plate: "Hazard",
    anchor: { kind: "select", label: "Trap severity" },
    fields: [
      { kind: "option", label: "Frigid water", within: "Hazard" },
      { kind: "chips", label: "Enemies caught in it", shot: "hazard" },
      { kind: "switch", label: "Set it on the board", shot: "hazard-board" },
      { kind: "number", label: "Its square: column" },
      { kind: "number", label: "Its square: row" },
      { kind: "number", label: "Minutes in the water" },
    ],
  },
  {
    key: "break-something",
    tab: "world",
    plate: "Break something",
    anchor: { kind: "select", label: "Material" },
    fields: [{ kind: "select", label: "Manacles on", empty: /^Pick who$/ }],
  },
  {
    key: "enemy-attack",
    tab: "combat",
    plate: "Enemy attacks",
    anchor: { kind: "text", label: "Attack" },
    fields: [
      { kind: "switch", label: "Ran straight at the target first" },
      { kind: "text", label: "At their pet" },
    ],
  },
  {
    key: "pet-attack",
    tab: "combat",
    plate: "Pet attacks",
    anchor: { kind: "text", label: "Attack" },
    fields: [{ kind: "switch", label: "Ran straight at the target first" }],
  },
];

const ROLE = { select: "button", text: "textbox", switch: "switch", number: "spinbutton", chips: "group" };

const scenario = {
  name: "console-audit-fields",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.auditFields[viewport];
    const control = (field) => page.getByRole(ROLE[field.kind], { name: field.label, exact: true }).locator("visible=true");
    const formScope = `${root}[data-tour="dm-console-tabs"] + .motion-tab`;
    const phone = viewport === "phone";

    // The night and the day theme, each checked under axe where `scope` is
    // given, and each shot.
    const bothThemes = async (name, scope) => {
      await untilStill(page);
      if (scope) {
        const night = await axeViolations(page, scope);
        check(!night.length, `axe on ${name}: ${night.map((entry) => `${entry.id}: ${entry.help} (${entry.nodes.join(", ")})`).join("; ").slice(0, 600)}`);
      }
      await t.shot(`${name}-night`);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await untilStill(page);
      if (scope) {
        const day = await axeViolations(page, scope);
        check(!day.length, `axe on ${name} by day: ${day.map((entry) => `${entry.id}: ${entry.help} (${entry.nodes.join(", ")})`).join("; ").slice(0, 600)}`);
      }
      await t.shot(`${name}-day`);
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page);
    };

    // A target a finger can reach on a phone. The kit's switch draws a 24px
    // track and takes a press from 8px above and below it on a touch screen
    // (globals.css .kit-switch::before), so its press area is measured. A
    // number's figure sits inside the stepper's border, 2px short of the
    // 40px stepper a finger presses (kit.css .kit-stepper).
    const fingerSized = async (locator, label, kind) => {
      if (!phone) return;
      const height =
        kind === "switch"
          ? await locator.evaluate((node) => parseFloat(getComputedStyle(node, "::before").height))
          : kind === "number"
            ? await locator.evaluate((node) => node.closest(".kit-stepper")?.getBoundingClientRect().height ?? 0)
            : (await locator.boundingBox())?.height ?? 0;
      check(height >= 39.5, `${label} is a target a finger can reach (${height}px)`);
    };

    const openTable = async () => {
      await t.open(`/campaigns/${table.id}`);
      await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    };
    const openForm = async (form) => {
      await openPanelTab(t, "dm");
      const tab = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: new RegExp(`^${form.tab}$`, "i") }).locator("visible=true").first();
      await eventually(() => tab.count(), { timeoutMs: 30_000, label: `the console's ${form.tab} tab` });
      await t.tap(tab);
      const plate = page.getByRole("button", { name: new RegExp(`^${form.plate}\\b`) }).locator("visible=true").first();
      await eventually(() => plate.count(), { label: `the console's ${form.plate}` });
      await t.tap(plate);
      await untilStill(page);
      await eventually(() => control(form.anchor).count(), { label: `${form.plate}'s ${form.anchor.label}` });
    };
    const pickMenu = async (label) => {
      await t.tap(control({ kind: "select", label }).first());
      const menu = page.getByRole("menu").locator("visible=true").last();
      await eventually(() => menu.count(), { label: `${label}'s choices` });
      return menu;
    };
    const closeMenu = async (label) => {
      await page.keyboard.press("Escape");
      await eventually(async () => (await page.getByRole("menu").locator("visible=true").count()) === 0, { label: `${label}'s choices closed` });
    };

    // ---- the party panel: the cat the net holds ----
    await openTable();
    // The fight's title card ("Battle", SceneTitle.tsx) plays over the page
    // as it loads, and covered the party panel in the phone's shot.
    const titleCard = page.locator(".announce").locator("visible=true");
    await upTo(async () => (await titleCard.count()) > 0, 5_000);
    await eventually(async () => (await titleCard.count()) === 0, { timeoutMs: 30_000, label: "the fight's title card gone" });
    await openPanelTab(t, "party");
    const held = page.locator(`${root}[title^="${table.pet}: restrained"]`).locator("visible=true").first();
    await eventually(() => held.count(), { timeoutMs: 30_000, label: `${table.pet}'s restrained under ${table.heroName}` });
    const heldFor = (await held.getAttribute("title")) ?? "";
    check(/\(.+\)$/.test(heldFor), `the chip says what is left of it (${heldFor})`);
    await held.scrollIntoViewIfNeeded();
    await bothThemes("party-pet", null);

    // ---- every form on a host that offers its fields ----
    for (const form of FORMS) {
      await openForm(form);
      for (const field of form.fields) {
        if (field.kind === "option") {
          const menu = await pickMenu(field.within);
          const option = menu.getByRole("menuitemradio", { name: field.label, exact: true });
          await eventually(() => option.count(), { label: `${field.label} under ${field.within}` });
          await t.tap(option.first());
          await eventually(async () => ((await control({ kind: "select", label: field.within }).first().textContent()) ?? "").includes(field.label), { label: `${field.within} reads ${field.label}` });
          continue;
        }
        const target = control(field);
        await eventually(() => target.count(), { label: `${form.plate}: ${field.label}, labelled` });
        const node = target.first();
        if (field.kind === "select") {
          const shown = ((await node.textContent()) ?? "").trim();
          check(field.empty.test(shown), `${field.label} starts with nothing picked (${shown})`);
          await fingerSized(node, field.label, field.kind);
          if (field.options) {
            const menu = await pickMenu(field.label);
            for (const name of field.options) {
              check(await menu.getByRole("menuitemradio", { name, exact: true }).count(), `${field.label} offers ${name}`);
            }
            await closeMenu(field.label);
          }
        } else if (field.kind === "text" || field.kind === "number") {
          check((await node.inputValue()) === "", `${field.label} starts empty`);
          await fingerSized(node, field.label, field.kind);
        } else if (field.kind === "switch") {
          check((await node.getAttribute("aria-checked")) === "false", `${field.label} starts off`);
          await fingerSized(node, field.label, field.kind);
        } else if (field.kind === "chips") {
          const chips = node.getByRole("button");
          check((await chips.count()) === 2, `${field.label} offers both goblins (${await chips.count()})`);
          for (const chip of await chips.all()) {
            check((await chip.getAttribute("aria-pressed")) === "false", `${field.label} starts with nobody caught`);
            await fingerSized(chip, `${field.label}'s ${await chip.textContent()}`, field.kind);
          }
        }
      }
      // A shot for each part of a long form; one for the rest.
      const parts = form.fields.filter((field) => field.shot);
      for (const part of parts.length ? parts : [form.fields[0]]) {
        await control(part).first().evaluate((node) => node.scrollIntoView({ block: "center" }));
        await bothThemes(part.shot ?? form.key, formScope);
      }
    }

    // ---- the workshop's item editor: picking locks ----
    const stamp = `${viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Locks ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    const openItem = async () => {
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Items/ }));
      await t.tap(page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first());
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.locator('[data-tour="homebrew-save"]').isVisible(), { timeoutMs: 20_000, label: "the item form" });
      await t.tap(editor.getByRole("button", { name: "Kind", exact: true }));
      const magic = page.getByRole("menu").getByText("Magic item", { exact: true }).first();
      await eventually(() => magic.isVisible(), { timeoutMs: 5_000, label: "Magic item under Kind" });
      await t.tap(magic);
      const group = editor.getByRole("button", { name: /^What it adds to checks/ });
      await eventually(() => group.count(), { label: "What it adds to checks" });
      if ((await group.getAttribute("aria-expanded")) !== "true") await t.tap(group);
      await eventually(() => editor.getByRole("button", { name: "sleight of hand", exact: true }).count(), { label: "the check bonus chips" });
      await untilStill(page);
      return editor;
    };
    const lockChip = (editor) => editor.getByRole("button", { name: "picking locks", exact: true });
    try {
      const editor = await openItem();
      const chip = lockChip(editor);
      await eventually(() => chip.count(), { label: "the picking locks chip" });
      check((await chip.getAttribute("aria-pressed")) === "false", "picking locks starts unpicked");
      await fingerSized(chip, "picking locks", "chip");
      await t.tap(chip);
      const bonus = editor.getByRole("spinbutton", { name: "picking locks", exact: true });
      await eventually(() => bonus.count(), { label: "the lock bonus once picked" });
      check((await bonus.inputValue()) === "2", `the lock bonus starts at +2, as a skill's does (${await bonus.inputValue()})`);
      await eventually(() => editor.getByText(/\+2 picking locks/).count(), { label: "the group's summary names the lock" });
      await chip.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await bothThemes("workshop-locks", '[role="dialog"]');

      if (t.app) return;

      // ---- a host from before these fields ----
      await page.route("**/api/capabilities**", async (route) => {
        const response = await route.fetch();
        const json = await response.json().catch(() => ({}));
        delete json.features;
        await route.fulfill({ response, json });
      });
      const older = await openItem();
      check((await lockChip(older).count()) === 0, "an older host's item editor offers picking locks");

      await openTable();
      for (const form of FORMS) {
        await openForm(form);
        for (const field of form.fields) {
          if (field.kind === "option") {
            const menu = await pickMenu(field.within);
            check((await menu.getByRole("menuitemradio", { name: field.label, exact: true }).count()) === 0, `an older host is offered ${field.label} under ${field.within}`);
            await closeMenu(field.within);
            continue;
          }
          check((await control(field).count()) === 0, `an older host's ${form.plate} asks ${field.label}`);
        }
      }
    } finally {
      await page.unroute("**/api/capabilities**").catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};

export default scenario;
