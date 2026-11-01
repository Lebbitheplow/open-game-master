// Issue 650: typing @ in the composer offers the table's names, the party,
// the people the story has named and the places on the map, and writes the
// chosen one the way the table spells it. A player at a table a person runs:
// a prepared person the GM never named (Iarno) is not offered, since his
// seat is never sent him. A key picks on a desktop and a tap on a phone, the
// box keeps its focus (and a phone its keyboard), Enter picks instead of
// sending, Escape puts the menu away for that @, and the list hangs above the
// box, animated, legible night and day, and clean under axe. The Ask box
// above the composer answers @ the same way. A GM's Narrate holds the whole
// cast and marks the person not introduced yet; its pill says Narrate.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "name-menu",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport, touch } = t;
    await t.open(`/campaigns/${ids.nameTables[viewport]}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table" });
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: /^table$/i }).locator("visible=true").first();
    if (await tableTab.count()) {
      await t.tap(tableTab);
    }
    const box = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
    await eventually(() => box.count(), { timeoutMs: 20_000, label: "the composer" });
    await t.tap(box);
    const list = page.locator(`${root}[role="listbox"][aria-label="Names at this table"]`);
    const shown = async () => (await list.locator('[role="option"]').allTextContents()).map((text) => text.trim());
    const focused = () => box.evaluate((element) => document.activeElement === element);

    await box.pressSequentially("I wave to @");
    await eventually(() => list.count(), { label: "the name menu" });
    const offered = await shown();
    for (const name of ["Rowan Ashby", "Bree Underhill", "Sildar Hallwinter", "Phandalin", "Thundertree's Côte"]) {
      check(offered.includes(name), `${name} is offered (${offered.join(", ")})`);
    }
    check(!offered.some((name) => name.includes("Iarno")), `a person the story never named is not offered (${offered.join(", ")})`);
    const headings = await list.locator(".palette-group").allTextContents();
    check(headings.join("|") === "Party|People|Places", `the groups in order (${headings.join("|")})`);
    check(await focused(), "the box keeps its focus while the menu is up");
    check(Boolean(await box.getAttribute("aria-activedescendant")), "the box points at the lit row");

    // Motion: the list springs in (unless the reader asked for none).
    const motion = await page.locator(`${root}.name-menu`).evaluate((element) => ({
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      name: getComputedStyle(element).animationName,
    }));
    check(motion.reduced || motion.name === "name-menu-in", `the menu animates in (${JSON.stringify(motion)})`);

    // Above the box, inside the screen, once it has settled.
    await untilStill(page);
    const where = { list: await list.boundingBox(), well: await page.locator(`${root}[data-tour="composer-input"]`).locator("visible=true").first().boundingBox() };
    check(where.list && where.well && where.list.y + where.list.height <= where.well.y + 1 && where.list.y >= 0, `the list hangs above the box (${JSON.stringify(where)})`);
    const rows = await list.locator('[role="option"]').evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height));
    check(rows.every((height) => height >= 40), `every row is a finger's height (${rows.join(", ")})`);
    await untilStill(page);
    const found = await axeViolations(page, `${root}[role="listbox"][aria-label="Names at this table"]`);
    check(!found.length, `axe on the name menu: ${found.map((entry) => entry.id).join(", ")}`);
    await t.shot("night");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const day = await axeViolations(page, `${root}[role="listbox"][aria-label="Names at this table"]`);
    check(!day.length, `axe on the name menu by day: ${day.map((entry) => entry.id).join(", ")}`);
    await t.shot("day");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));

    // A query without its accent or apostrophe finds the place.
    await box.pressSequentially("thundertrees co");
    await eventually(async () => (await shown()).join("|") === "Thundertree's Côte", { label: "the place found without its accent" });
    if (touch) {
      await t.tap(list.locator('[role="option"]').first());
    } else {
      await box.press("Enter");
    }
    await eventually(async () => (await box.inputValue()) === "I wave to Thundertree's Côte ", { label: "the place written as the table spells it" });
    check((await list.count()) === 0, "the menu closes once a name is written");
    check(await focused(), "the box keeps its focus after the pick");

    // Arrows walk the list; Enter writes the lit row and sends nothing.
    await box.pressSequentially("and @");
    await eventually(() => list.count(), { label: "the menu again" });
    if (!touch) {
      await box.press("ArrowDown");
      const lit = (await list.locator('[role="option"][aria-selected="true"]').textContent())?.trim();
      check(lit === "Rowan Ashby", `the arrow lights the next row (${lit})`);
      await box.press("Enter");
      await eventually(async () => (await box.inputValue()).endsWith("and Rowan Ashby "), { label: "the lit row written by Enter" });
    } else {
      await t.tap(list.locator('[role="option"]').filter({ hasText: "Rowan Ashby" }).first());
      await eventually(async () => (await box.inputValue()).endsWith("and Rowan Ashby "), { label: "the tapped row written" });
    }

    // Escape puts the menu away for this @; typing on does not bring it back.
    await box.pressSequentially("@sil");
    await eventually(() => list.count(), { label: "the menu for @sil" });
    await box.press("Escape");
    await eventually(async () => (await list.count()) === 0, { label: "Escape closes the menu" });
    await box.pressSequentially("d");
    await page.waitForTimeout(200);
    check((await list.count()) === 0, "typing on after Escape leaves it closed");
    check((await box.inputValue()).endsWith("@sild"), "Escape kept the text as typed");
    await box.fill("");

    // The Ask box just above answers @ the same way, in the asker's voice.
    const askToggle = page.locator(`${root}[data-tour="ask-dm"]`).locator("visible=true").first();
    if ((await askToggle.getAttribute("aria-expanded")) !== "true") {
      await t.tap(askToggle);
    }
    const ask = page.locator(`${root}textarea[aria-label^="Ask the GM"]`).locator("visible=true").first();
    await eventually(() => ask.count(), { label: "the Ask box" });
    await t.tap(ask);
    await ask.pressSequentially("Who is @");
    await eventually(() => list.count(), { label: "the name menu in the Ask box" });
    const asked = await shown();
    check(asked.includes("Sildar Hallwinter") && !asked.some((name) => name.includes("Iarno")), `the Ask box offers what the table knows (${asked.join(", ")})`);
    await ask.pressSequentially("sil");
    if (touch) {
      await t.tap(list.locator('[role="option"]').first());
    } else {
      await ask.press("Enter");
    }
    await eventually(async () => (await ask.inputValue()) === "Who is Sildar Hallwinter ", { label: "the name written into the question" });
    await ask.fill("");

    // Behind the screen: the GM narrates, and Narrate offers the whole cast,
    // the person not yet introduced marked so naming him is a choice.
    await t.open(`/campaigns/${ids.nameTables[`${viewport}Gm`]}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the GM's table" });
    if (await tableTab.count()) {
      await t.tap(tableTab);
    }
    const narrate = page.locator(`${root}[data-tour="composer-input"] textarea`).locator("visible=true").first();
    await eventually(() => narrate.count(), { timeoutMs: 20_000, label: "the GM's composer" });
    // The GM's own pill says Narrate, as the GM's tour does; it read Direct,
    // the party lead's word for steering an AI table.
    const pill = (await page.locator(`${root}button[data-mode="narrate"]`).locator("visible=true").first().textContent())?.trim();
    check(pill === "Narrate", `the GM's mode pill says Narrate (${pill})`);
    await t.tap(narrate);
    await narrate.pressSequentially("@ia");
    await eventually(() => list.count(), { label: "the GM's name menu" });
    const unmet = list.locator('[role="option"]').filter({ hasText: "Iarno Albrek" }).first();
    await eventually(() => unmet.count(), { label: "the prepared person offered in Narrate" });
    check(/Not introduced yet/.test((await unmet.textContent()) ?? ""), "the not yet introduced is marked");
    await untilStill(page);
    await t.shot("gm");
    await narrate.fill("");
    await narrate.pressSequentially("@sild");
    await eventually(async () => (await shown()).some((name) => name.startsWith("Sildar Hallwinter")), { label: "a person already met offered" });
    check(!/Not introduced/.test((await shown()).join(" ")), "someone the party met is not marked");
    await narrate.fill("");
  },
};

export default scenario;
