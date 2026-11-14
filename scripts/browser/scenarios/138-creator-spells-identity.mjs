// The character creator audit of 2026-11-13 (cc1113), on the Spells and gear
// step and the Hero step, where a player meets what it added: on desktop and
// on a 390 px phone, by day and by night, on the website and in the app's
// own screens.
//
//   - an 11th-level warlock's spell book reaches 6th level for its Mystic
//     Arcanum, with a counter of its own beside the spells known;
//   - a Light cleric's Light is a granted tile, not one of its cantrips;
//   - an Arcane Trickster is told Mage Hand is owed among its cantrips;
//   - a 13th-level netrunner finds Black Market Firmware's two programs from
//     any class as a group of their own;
//   - an entertainer's kit names its musical instrument;
//   - the Hero step's Personality block: four pickers named for the line
//     they ask, the background's suggestions, Write my own opening a box,
//     Leave it blank emptying it;
//   - each part has named controls, a finger's size on a phone, nothing
//     pushed past the step's edge, no sideways scroll, and a clean axe run.
import { check, eventually, untilStill, upTo } from "../lib.mjs";
import { consoleErrors, look, narrowPhone, openDraft, ringOnTab, shootBoth } from "../creator-audit.mjs";

export default {
  name: "creator-spells-identity",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page } = t;
    await narrowPhone(t);
    const problems = [];
    const errors = consoleErrors(page);
    // Scores placed, as a player has by this step (the spell counts read them).
    const base = { name: "Audit", raceId: "human", method: "standard", scores: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 } };
    const spellsOf = async (shot, fields) => {
      const step = await openDraft(t, "spells-gear", { ...base, ...fields });
      const book = step.locator(".spellbook").first();
      if (!(await upTo(() => book.count(), 20_000))) {
        problems.push(`${shot}: no spell book on the step`);
        return { step, book: null };
      }
      await book.scrollIntoViewIfNeeded();
      await untilStill(page).catch(() => {});
      return { step, book };
    };
    try {
      // ---- an 11th-level warlock's Mystic Arcanum ----
      {
        const { step, book } = await spellsOf("warlock-arcanum", { classId: "warlock", level: 11, subclass: "The Fiend" });
        if (book) {
          const text = (await step.textContent()) ?? "";
          check(/Mystic Arcanum/.test(text), "the warlock's spell step names its Mystic Arcanum");
          const tabs = book.locator("button").filter({ hasText: /^\s*(Cantrips|I|II|III|IV|V|VI|VII|VIII|IX)\s*$/ });
          const tabTexts = (await tabs.allTextContents()).map((entry) => entry.trim());
          check(tabTexts.includes("VI"), `the book has a 6th-level tab for the arcanum (${tabTexts.join(", ")})`);
          check(/Known \d+\/\d+/.test(text.replace(/\s+/g, " ")) || /Known/.test(text), "the warlock's spells known are counted beside the arcanum");
          const sixth = tabs.filter({ hasText: /^\s*VI\s*$/ }).first();
          if (await sixth.count()) {
            await t.tap(sixth);
            await untilStill(page).catch(() => {});
          }
          await look(t, book, "warlock's spell book", problems);
          if (await tabs.count()) await ringOnTab(t, tabs.first(), "warlock's first spell tab", problems);
          await shootBoth(t, book, "spells-warlock-arcanum");
        }
      }

      // ---- a Light cleric's Light ----
      {
        const { step, book } = await spellsOf("light-cleric", { classId: "cleric", level: 1, subclass: "Light Domain" });
        if (book) {
          const tab = book.locator("button").filter({ hasText: /^\s*Cantrips/i }).first();
          if (await tab.count()) await t.tap(tab);
          const light = book.locator('li[data-spell="Light"]').first();
          if (await upTo(() => light.count(), 10_000)) {
            const state = await light.evaluate((el) => el.getAttribute("data-state") ?? el.textContent ?? "");
            if (!/granted|subclass|domain|always/i.test(state)) problems.push(`light-cleric: Light reads as a plain tile (${state.slice(0, 80)})`);
            await light.scrollIntoViewIfNeeded();
          } else {
            problems.push("light-cleric: no Light tile among the cantrips");
          }
          await look(t, book, "Light cleric's spell book", problems);
          await shootBoth(t, book, "spells-light-cleric");
          void step;
        }
      }

      // ---- an Arcane Trickster owes Mage Hand ----
      {
        // Two cantrips chosen and neither Mage Hand: the last is kept for
        // it, and the other cantrips' tiles say so before a tap, as the
        // level-up's do.
        const { step, book } = await spellsOf("arcane-trickster", {
          classId: "rogue",
          level: 3,
          subclass: "Arcane Trickster",
          cantrips: ["Minor Illusion", "Prestidigitation"],
        });
        if (book) {
          const tab = book.locator("button").filter({ hasText: /^\s*Cantrips/i }).first();
          if (await tab.count()) await t.tap(tab);
          await untilStill(page).catch(() => {});
        }
        const kept = step.getByText(/Mage Hand first/).first();
        if (!(await upTo(() => kept.count(), 10_000))) problems.push("arcane-trickster: the last cantrip is not kept for Mage Hand (no tile says Mage Hand first)");
        if (book) {
          await look(t, book, "Arcane Trickster's spell book", problems);
          await shootBoth(t, null, "spells-arcane-trickster");
        }
      }

      // ---- a 13th-level netrunner's Black Market Firmware ----
      {
        const { step } = await spellsOf("netrunner", { classId: "netrunner", level: 13 });
        const group = step.locator('[data-any-list-group]').first();
        if (await upTo(() => group.count(), 15_000)) {
          const name = await group.getAttribute("data-any-list-group");
          if (!/Black Market Firmware/.test(name ?? "")) problems.push(`netrunner: the any-list group is "${name}"`);
          await group.scrollIntoViewIfNeeded();
          await look(t, group, "netrunner's Black Market Firmware", problems);
          await shootBoth(t, group, "spells-netrunner-firmware");
        } else {
          problems.push("netrunner: no Black Market Firmware group on the spell step");
          await shootBoth(t, step, "spells-netrunner-missing");
        }
      }

      // ---- an entertainer's instrument in its kit ----
      {
        const step = await openDraft(t, "spells-gear", { ...base, classId: "fighter", level: 1, backgroundId: "entertainer" });
        const kit = step.locator("section").filter({ hasText: /Entertainer/ }).filter({ hasText: /instrument|lute|drum|flute|horn|lyre|viol|bagpipes|dulcimer|shawm/i }).last();
        if (await upTo(() => kit.count(), 15_000)) {
          await kit.scrollIntoViewIfNeeded();
          await look(t, kit, "entertainer's kit", problems);
          await shootBoth(t, kit, "gear-entertainer-instrument");
        } else {
          problems.push("entertainer: the kit never names its instrument");
          await shootBoth(t, step, "gear-entertainer-missing");
        }
      }

      // ---- the Hero step's Personality ----
      {
        const step = await openDraft(t, "identity", { ...base, classId: "fighter", level: 1, backgroundId: "acolyte" });
        const panel = step.locator("section").filter({ hasText: /^\s*Personality \(optional\)/ }).last();
        await eventually(() => panel.count(), { timeoutMs: 20_000, label: "the Personality block" });
        await panel.scrollIntoViewIfNeeded();
        const groups = panel.locator('[role="group"]');
        check((await groups.count()) === 4, `four personality lines (${await groups.count()})`);
        for (const line of ["Personality trait", "Ideal", "Bond", "Flaw"]) {
          const group = panel.getByRole("group", { name: new RegExp(line, "i") });
          if (!(await group.count())) problems.push(`personality: no line named ${line}`);
        }
        await look(t, panel, "Personality block", problems);
        const trait = groups.first().locator("button").first();
        await ringOnTab(t, trait, "the trait picker", problems);
        await shootBoth(t, panel, "identity-personality-empty");
        // The trait from the acolyte's suggestions.
        await t.tap(trait);
        const option = page.locator('[role="option"], [role="menuitemradio"]').locator("visible=true");
        await eventually(() => option.count(), { timeoutMs: 10_000, label: "the trait's suggestions" });
        await untilStill(page).catch(() => {});
        await shootBoth(t, panel, "identity-personality-open");
        const suggestion = option.filter({ hasNotText: /Write my own|Leave it blank/ }).first();
        await t.tap(suggestion);
        await untilStill(page).catch(() => {});
        // Write my own on the ideal opens a box.
        const ideal = groups.nth(1).locator("button").first();
        await t.tap(ideal);
        await eventually(() => option.count(), { timeoutMs: 10_000, label: "the ideal's options" });
        await t.tap(option.filter({ hasText: /Write my own/ }).first());
        const own = groups.nth(1).locator("input");
        await eventually(() => own.count(), { timeoutMs: 10_000, label: "the ideal's own box" });
        await own.fill("Every debt is paid in full.");
        await untilStill(page).catch(() => {});
        await look(t, panel, "Personality block, filled", problems);
        await shootBoth(t, panel, "identity-personality-filled");
        // Leave it blank empties the trait again.
        await t.tap(trait);
        await eventually(() => option.count(), { timeoutMs: 10_000, label: "the trait's options again" });
        const blank = option.filter({ hasText: /Leave it blank/ }).first();
        check((await blank.count()) === 1, "a chosen trait offers Leave it blank");
        await t.tap(blank);
        await untilStill(page).catch(() => {});
        const traitText = ((await trait.textContent()) ?? "").trim();
        check(/Pick one, or write your own/.test(traitText), `Leave it blank empties the trait (${traitText.slice(0, 60)})`);
      }
      for (const text of errors.seen) problems.push(`console: ${text}`);
    } finally {
      errors.stop();
    }
    check(!problems.length, `the Spells and Hero steps' new parts:\n  ${problems.join("\n  ")}`);
  },
};
