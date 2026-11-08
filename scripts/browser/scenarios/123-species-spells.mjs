// Spells on a workshop species' options (issue #833), from the Workshop to a
// character, on desktop and phone, on the website and in the app's own
// screens. The species is the issue's own Half-Dragon: Topaz knows Mage
// Hand, Detect Thoughts from 3rd level and Misty Step from 5th; Celestial
// knows Light.
//
//   - in Homebrew, the Topaz option shows its spells, each with the level
//     it arrives at, and for a spell of 1st level or higher how often it is
//     cast without a slot and whether slots cast it too; a cantrip shows
//     neither; one row changed is kept by the save; the species' own
//     "Spells it casts" sits beside the choice; every control is a finger's
//     size on a phone, named, and clean under axe; day and night;
//   - in the character builder the Topaz pick says what spells it gives;
//   - the finished fighter's sheet shows Mage Hand in a book of the
//     species' spells, though the fighter casts nothing of its own;
//   - at the table a tiefling fighter's Darkness is a spell card that
//     spends Infernal Legacy's use, not a slot.
import { axeViolations, check, currentStep, eventually, sleep, untilStill, upTo } from "../lib.mjs";

const MIN = 39.5;
async function smallTargets(scope) {
  return scope.evaluate((root, min) => {
    const found = [];
    for (const control of root.querySelectorAll('button, [role="button"], input:not([type="hidden"])')) {
      const target = control.closest("label") ?? control;
      if (!(target instanceof HTMLElement) || !target.offsetWidth || !target.offsetHeight) continue;
      const reach = getComputedStyle(target, "::after");
      const reached = reach.content !== "none" && reach.position === "absolute";
      const stepper = target.closest(".kit-stepper");
      const width = Math.max(target.offsetWidth, reached ? parseFloat(reach.width) : 0);
      const height = Math.max(stepper instanceof HTMLElement ? stepper.offsetHeight : target.offsetHeight, reached ? parseFloat(reach.height) : 0);
      const typed = control.matches("input:not([type=checkbox]):not([type=radio])");
      const wide = stepper ? 33 : min;
      if (height >= min && (typed || width >= wide)) continue;
      found.push(`${control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 40) || control.tagName} ${Math.round(width)}x${Math.round(height)}`);
    }
    return found;
  }, MIN);
}

const visible = (page, root, text) => page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

const HALF_DRAGON = (name) => ({
  kind: "race",
  name,
  data: {
    desc: "Folk with a dragon close in the family.",
    size: "Medium",
    speed: { walk: 30 },
    asi: [{ attributes: ["Strength"], value: 2 }],
    languages: ["Common", "Draconic"],
    traits: "**_Scaled Hide._** Your scales turn the first blow of a fight.",
    variants: {
      label: "Draconic ancestry",
      options: [
        { name: "Topaz", spells: { ability: "cha", spells: [{ spell: "Mage Hand", level: 1 }, { spell: "Detect Thoughts", level: 3 }, { spell: "Misty Step", level: 5 }] } },
        { name: "Celestial", spells: { ability: "wis", spells: [{ spell: "Light", level: 1 }] } },
      ],
    },
  },
});

export default {
  name: "species-spells",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api, ids } = t;
    const tag = `${t.viewport[0]}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-3)}`;
    const species = `Half-Dragon ${tag}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Spells ${tag}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    let entryId = null;
    let characterId = null;
    const pick = async (trigger, row) => {
      await t.tap(trigger);
      const item = page.getByRole("menuitemradio", { name: row }).locator("visible=true").first();
      await eventually(() => item.count(), { timeoutMs: 10_000, label: `the row ${row}` });
      await t.tap(item);
      await eventually(async () => (await page.getByRole("menuitemradio").locator("visible=true").count()) === 0, { timeoutMs: 10_000, label: `the menu closed after ${row}` });
    };
    const day = async (on) => {
      await page.evaluate((light) => {
        document.documentElement.dataset.theme = light ? "light" : "dark";
      }, on);
      await untilStill(page);
    };
    try {
      const brewed = await api.post(`${base}/api/homebrew`, { data: HALF_DRAGON(species) });
      check(brewed.ok(), `the species was kept (${brewed.status()})`);
      entryId = (await brewed.json()).entry.id;

      // ---- the editor ----
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Species/ }));
      const row = page.locator(`${root}ul button`, { hasText: species }).locator("visible=true").first();
      await eventually(() => row.isVisible(), { timeoutMs: 15_000, label: "the species in the list" });
      await t.tap(row);
      const editor = page.getByRole("dialog").last();
      const own = editor.getByRole("button", { name: /^Spells it casts/ });
      await eventually(() => own.isVisible(), { timeoutMs: 20_000, label: "the species' own Spells it casts" });
      check(/none/.test(await own.innerText()), "the species gives no spells of its own");

      const topaz = editor.locator('[data-species-option="topaz"]');
      await t.tap(topaz.getByRole("button", { name: /^Topaz/ }).first());
      const spells = topaz.locator("[data-species-spells]");
      await eventually(() => spells.isVisible(), { timeoutMs: 10_000, label: "Topaz's spells" });
      const mageHand = spells.locator('[data-species-spell="Mage Hand"]');
      const thoughts = spells.locator('[data-species-spell="Detect Thoughts"]');
      check(/cantrip, at will/.test(await mageHand.innerText()), "Mage Hand reads as a cantrip");
      check((await mageHand.getByRole("button", { name: /How often/ }).count()) === 0, "a cantrip has no uses to pick");
      check(/level 2 spell/.test(await thoughts.innerText()), "Detect Thoughts reads as a level 2 spell");
      check((await thoughts.locator('input[aria-label="Character level Detect Thoughts arrives at"]').inputValue()) === "3", "Detect Thoughts arrives at 3rd level");
      const often = thoughts.getByRole("button", { name: "How often Detect Thoughts is cast without a spell slot" });
      check(/once a long rest/.test(await often.innerText()), `the default is once a long rest (${await often.innerText()})`);
      check((await thoughts.getByRole("switch", { name: "Spell slots cast it too" }).getAttribute("aria-checked")) === "false", "slots do not cast it by default");
      check(/Charisma/.test(await spells.getByRole("button", { name: "Spellcasting ability" }).innerText()), "the group is cast with Charisma");
      await pick(often, "2 times a long rest");
      if (t.touch) {
        const small = await smallTargets(spells);
        check(!small.length, `the spell rows' controls are a finger's size: ${small.join("; ")}`);
      }
      const violations = await axeViolations(page, `${root}[role="dialog"] [data-species-option="topaz"] [data-species-spells]`.trim());
      const serious = violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
      check(!serious.length, `the spell rows pass axe: ${serious.map((violation) => violation.id).join(", ")}`);
      await spells.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await untilStill(page);
      await t.shot("editor-night");
      await day(true);
      await t.shot("editor-day");
      await day(false);

      await t.tap(editor.locator('[data-tour="homebrew-save"]'));
      await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/homebrew?kind=race`)).json().catch(() => ({ entries: [] }));
          const kept = (body.entries ?? []).find((entry) => entry.id === entryId);
          const rowKept = kept?.data.variants?.options?.[0]?.spells?.spells?.find((entry) => entry.spell === "Detect Thoughts");
          return rowKept?.uses === 2;
        },
        { timeoutMs: 15_000, label: "Detect Thoughts kept at 2 times a long rest" },
      );
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        await upTo(async () => (await page.getByRole("dialog").count()) === 0, 300);
      }

      // ---- the builder's pick ----
      await t.open("/characters/new");
      const startFresh = visible(page, root, /^Start fresh$/);
      if (await startFresh.count()) await t.tap(startFresh.first());
      const fighter = page.locator(`${root}section[data-active] .creator-card`).filter({ hasText: /^\s*Fighter/ }).locator("visible=true").first();
      await eventually(() => fighter.count(), { timeoutMs: 30_000, label: "the fighter card" });
      await t.tap(fighter);
      const fill = page.locator(`${root}section[data-active] [data-quick-fill]`).locator("visible=true");
      await eventually(() => fill.count(), { timeoutMs: 10_000, label: "Fill what's left" });
      await t.tap(fill.first());
      await eventually(() => page.locator(`${root}[data-quick-readback]`).count(), { timeoutMs: 20_000, label: "the read-back" });
      await t.tap(visible(page, root, /^Keep them$/).first());
      const ancestry = page.locator(`${root}button[aria-label^="Go to step 2:"]`).locator("visible=true");
      await eventually(async () => (await ancestry.count()) && ancestry.first().isEnabled(), { timeoutMs: 15_000, label: "the Ancestry diamond" });
      await t.tap(ancestry.first());
      await eventually(async () => /^Step 2:/.test(await currentStep(page, root)), { timeoutMs: 10_000, label: "the Ancestry step" });
      const step = page.locator(`${root}section[data-active]`);
      const card = step.locator(".creator-card").filter({ hasText: species }).locator("visible=true").first();
      await step.getByRole("searchbox", { name: "Search lineages" }).or(step.locator('input[aria-label="Search lineages"]')).first().fill(species);
      await eventually(() => card.count(), { timeoutMs: 20_000, label: "the species' card" });
      await t.tap(card);
      const variant = step.locator('[data-builder-target="variant"]').locator("visible=true").first();
      await eventually(() => variant.count(), { timeoutMs: 10_000, label: "the ancestry picker" });
      await pick(variant.getByRole("button", { name: "Draconic ancestry" }), /^Topaz/);
      const summary = variant.locator("[data-variant-summary]");
      await eventually(
        async () => /spells: Mage Hand \(cantrip\); Detect Thoughts from 3rd level, 2 times a long rest; Misty Step from 5th level, once a long rest \(Charisma\)/.test(await summary.innerText()),
        { timeoutMs: 10_000, label: "what Topaz gives, its spells included" },
      );
      await variant.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await untilStill(page);
      await t.shot("builder-night");
      await day(true);
      await t.shot("builder-day");
      await day(false);

      // ---- the character's sheet: its species' spells, a fighter's too ----
      const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/characters" && response.request().method() === "POST", { timeout: 60_000 });
      for (let number = 2; number <= 6; number += 1) {
        const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
        await eventually(
          async () => {
            if (number === 6 && !(await page.locator(`${root}section[data-active] [data-finish-summary]`).count())) return false;
            if (number < 6 && new RegExp(`^Step ${number + 1}:`).test(await currentStep(page, root))) return true;
            if (await next.isEnabled()) await t.tap(next);
            if (number === 6) return true;
            await upTo(async () => new RegExp(`^Step ${number + 1}:`).test(await currentStep(page, root)), 800);
            return new RegExp(`^Step ${number + 1}:`).test(await currentStep(page, root));
          },
          { timeoutMs: 30_000, label: number === 6 ? "the save on the summary" : `Continue from step ${number}` },
        );
      }
      check((await saved).ok(), "the character was kept");
      const hero = await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/characters`)).json().catch(() => ({ characters: [] }));
          return (body.characters ?? []).find((character) => character.sheet?.race === `homebrew:${entryId}`) ?? null;
        },
        { timeoutMs: 15_000, label: "the character in the library" },
      );
      characterId = hero.id;
      // The save sends the builder on to the hero's page by itself; opening the
      // sheet while that navigation is still in flight interrupts one or the
      // other (CI: "Navigation ... is interrupted by another navigation to
      // .../ready"). Let the builder leave first.
      await page.waitForURL((url) => !url.pathname.startsWith("/characters/new"), { timeout: 15_000 }).catch(() => {});
      await t.open(`/characters/${characterId}`);
      const book = page.locator(`${root}[data-species-spell-book]`).locator("visible=true").first();
      await eventually(() => book.count(), { timeoutMs: 30_000, label: "the species' spell book on a fighter's sheet" });
      await eventually(async () => /Mage Hand/.test(await book.innerText()), { timeoutMs: 10_000, label: "Mage Hand in the species' book" });
      check(!/Detect Thoughts/.test(await book.innerText()), "Detect Thoughts waits for 3rd level");
      await book.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await untilStill(page);
      await t.shot("sheet-night");
      await day(true);
      await t.shot("sheet-day");
      await day(false);

      // ---- the Hand: a tiefling fighter's darkness as a spell card ----
      await t.open(`/campaigns/${ids.speciesSpells[t.viewport].id}`);
      const tab = page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }).locator("visible=true");
      if (await tab.count()) await t.tap(tab.first());
      const darkness = page.locator(`${root}.hand-fan button.hand-card[aria-label^="Darkness,"]`).locator("visible=true");
      await eventually(() => darkness.count(), { timeoutMs: 30_000, label: "the Darkness card" });
      const face = (await darkness.first().textContent()) ?? "";
      check(/Free 1\/1/.test(face), `the card spends the free use, not a slot (${face})`);
      // The fight's banner fades first, so the shot shows the cards.
      await sleep(3_500);
      await darkness.first().scrollIntoViewIfNeeded();
      await untilStill(page);
      await t.shot("hand-night");
      await day(true);
      await t.shot("hand-day");
      await day(false);
    } finally {
      if (characterId) await api.delete(`${base}/api/characters/${characterId}`).catch(() => {});
      if (entryId) await api.delete(`${base}/api/homebrew/${entryId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
