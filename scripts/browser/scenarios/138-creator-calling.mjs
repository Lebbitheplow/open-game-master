// The character creator audit of 2026-11-13 (cc1113), on the Class step's
// choices, where a player meets what it added: on desktop and on a 390 px
// phone, by day and by night, on the website and in the app's own screens.
//
//   - a subclass's own pick list, at the level its feature arrives: a Totem
//     Warrior's animals, a Storm Herald's environment, a Divine Soul's
//     affinity, a Genie's kind, and with the content pack an Animal Lords
//     warlock's lord and a Smuggler's Legerdemain;
//   - a Four Elements monk at 3rd sees the disciplines it cannot take yet,
//     shown and closed with the reason;
//   - a variant human who took Fighting Initiate picks two fighting styles;
//   - a gadgeteer picks its gadgets;
//   - every one of those panels has named controls, a finger's size on a
//     phone, a focus ring by keyboard, nothing pushed past the step's edge,
//     no sideways scroll, and a clean axe run.
import { check, eventually, untilStill, upTo } from "../lib.mjs";
import { consoleErrors, look, narrowPhone, openDraft, ringOnTab, shootBoth } from "../creator-audit.mjs";

const panelOf = (step, title) => step.locator("section").filter({ has: step.page().locator(".ribbon, h2, h3, span", { hasText: title }) }).last();

export default {
  name: "creator-calling",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page } = t;
    await narrowPhone(t);
    const problems = [];
    const errors = consoleErrors(page);
    // One build on the Class step, one panel looked at.
    const panel = async (shot, fields, title, { optional = false } = {}) => {
      const step = await openDraft(t, "calling", { name: "Audit", raceId: "human", ...fields });
      const found = panelOf(step, title);
      const there = await upTo(() => found.count(), 15_000);
      if (!there) {
        if (!optional) problems.push(`${shot}: no panel "${title}" on the Class step`);
        return null;
      }
      await found.scrollIntoViewIfNeeded();
      await untilStill(page).catch(() => {});
      await look(t, found, shot, problems);
      const first = found.locator("button[aria-pressed]:not([disabled])").first();
      if (await first.count()) await ringOnTab(t, first, `${shot}'s first pick`, problems);
      const text = (await found.textContent()) ?? "";
      if (/nothing beyond its words|its words only/.test(text)) problems.push(`${shot}: a pick reads as granting nothing ("nothing beyond its words")`);
      await shootBoth(t, found, `calling-${shot}`);
      return found;
    };
    try {
      await panel("totem-animals", { classId: "barbarian", level: 3, subclass: "Path of the Totem Warrior" }, /Totem/);
      await panel("storm-herald", { classId: "barbarian", level: 3, subclass: "Path of the Storm Herald" }, /Storm|environment/i);
      await panel("divine-soul", { classId: "sorcerer", level: 1, subclass: "Divine Soul" }, /affinity/i);
      await panel("genie-kind", { classId: "warlock", level: 1, subclass: "The Genie" }, /Genie|kind/i);
      await panel("animal-lords", { classId: "warlock", level: 1, subclass: "Animal Lords" }, /lord/i, { optional: true });
      const smuggler = await panel("smuggler", { classId: "rogue", level: 3, subclass: "Smuggler" }, /Legerdemain/i, { optional: true });
      if (smuggler) {
        // Each spell says something of its own, or nothing: the same rule
        // line on all eight cards told a player nothing about any of them.
        const lines = (await smuggler.locator("button[aria-pressed] span.text-sm").allTextContents()).map((text) => text.trim()).filter(Boolean);
        const repeated = lines.length > 2 && new Set(lines).size === 1;
        if (repeated) problems.push(`smuggler: every Legerdemain card says the same line ("${lines[0].slice(0, 60)}")`);
      }

      // Four Elements at 3rd: the disciplines it cannot take yet are shown, closed.
      const monk = await panel("four-elements", { classId: "monk", level: 3, subclass: "Way of the Four Elements" }, /discipline/i);
      if (monk) {
        const closed = monk.locator("button[aria-pressed][disabled]");
        const count = await closed.count();
        check(count > 0, "a 3rd-level Four Elements monk sees the disciplines it cannot take yet");
        check(/Not yet:/.test((await closed.first().textContent()) ?? ""), "a closed discipline says why");
      }

      // Fighting Initiate on a variant human fighter: two styles.
      await panel("fighting-initiate", { classId: "fighter", level: 1, raceId: "variant_human", feats: ["Fighting Initiate"] }, /Fighting style \(pick 2\)/);

      // A gadgeteer's gadgets.
      await panel("gadgeteer", { classId: "gadgeteer", level: 1 }, /gadget/i);
      for (const text of errors.seen) problems.push(`console: ${text}`);
    } finally {
      errors.stop();
    }
    check(!problems.length, `the Class step's new panels:\n  ${problems.join("\n  ")}`);
  },
};
