// The character creator audit of 2026-11-13 (cc1113), on the Ancestry step,
// where a player meets what it added: on desktop and on a 390 px phone, by
// day and by night, on the website and in the app's own screens.
//
//   - the fourteen new peoples' cards each show their own portrait (a loaded
//     picture), not a letter or a broken image;
//   - a kenku's skills come only from the four its trait names; a
//     warforged's Specialized Design offers all 39 tools;
//   - a fairy's +2 and +1 are two picks, named for their amount, and its
//     Fairy Magic asks for an ability; an owlfolk picks its size; a shifter
//     its subtype; a hobgoblin its two martial weapons;
//   - with the content pack, a mutated derro names its weapons and its
//     Otherworldly Influence, and a human-chassis gearforged its Adaptable
//     Acumen and the skill it doubles;
//   - a criminal rogue, given thieves' tools by class and background,
//     picks another tool in its place beside its gaming set;
//   - every one of those blocks has named controls, a finger's size on a
//     phone, a focus ring by keyboard, nothing pushed past the step's edge,
//     no sideways scroll, and a clean axe run.
import { check, eventually, untilStill, upTo } from "../lib.mjs";
import { consoleErrors, look, narrowPhone, openDraft, ringOnTab, selectRows, shootBoth } from "../creator-audit.mjs";

const NEW_PEOPLES = [
  ["triton", "Triton"],
  ["serpentfolk", "Serpentfolk"],
  ["kobold", "Kobold"],
  ["aarakocra", "Aarakocra"],
  ["hobgoblin", "Hobgoblin"],
  ["satyr", "Satyr"],
  ["fairy", "Fairy"],
  ["owlfolk", "Owlfolk"],
  ["centaur", "Centaur"],
  ["rabbitfolk", "Rabbitfolk"],
  ["shifter", "Shifter"],
  // Elves and a dwarf of the books' own: the elf's and the dwarf's
  // pictures are theirs until they have their own.
  ["eladrin", "Elf (Eladrin)", ["elf"]],
  ["sea_elf", "Elf (Sea)", ["elf"], "sea elf"],
  ["duergar", "Dwarf (Duergar)", ["dwarf"]],
];

const base = { classId: "fighter", level: 1, name: "Audit" };

// The block of a people's own choices, under its card.
const choicesOf = (step, name) => step.locator("div.rounded-lg").filter({ has: step.page().locator(`p:text-is("${name} choices")`) }).first();

export default {
  name: "creator-ancestry",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root } = t;
    await narrowPhone(t);
    const problems = [];
    const errors = consoleErrors(page);
    try {
      // ---- the new peoples' cards ----
      let step = await openDraft(t, "ancestry", { ...base, raceId: "" });
      const search = step.locator('input[aria-label="Search lineages"]').first();
      // Each found the way a player looks for it ("sea elf" finds Elf (Sea)).
      for (const [id, name, kin = [], query = name] of NEW_PEOPLES) {
        await search.fill(query);
        const card = step.locator(".creator-card").filter({ hasText: name }).locator("visible=true").first();
        const there = await upTo(() => card.count(), 10_000);
        if (!there) {
          problems.push(`${name}: no card in the lineage list`);
          continue;
        }
        await card.scrollIntoViewIfNeeded();
        await untilStill(page).catch(() => {});
        const art = await card.evaluate(async (el) => {
          const img = el.querySelector("img");
          if (!img) return { ok: false, why: "no picture" };
          if (!img.complete) await new Promise((resolve) => img.addEventListener("load", resolve, { once: true }) || setTimeout(resolve, 5_000));
          return { ok: img.naturalWidth > 0, why: `${img.getAttribute("src")?.slice(0, 80)} ${img.naturalWidth}px`, src: img.getAttribute("src") ?? "" };
        });
        if (!art.ok) problems.push(`${name}: the card's portrait did not load (${art.why})`);
        // Its own people's picture (public/assets/placeholders/character-race/
        // <id>-<look>.webp), not the hooded adventurer every unpainted
        // people shares.
        else if (![id.replace(/_/g, "-"), ...kin].some((slug) => art.src.includes(`/${slug}-`))) problems.push(`${name}: the card shows another picture (${art.src.slice(0, 90)})`);
      }
      await search.fill("");
      await search.fill("folk");
      await untilStill(page).catch(() => {});
      await shootBoth(t, step, "ancestry-cards-folk");

      // ---- one people at a time: its choices block ----
      const people = async (raceId, name, extra = {}) => {
        step = await openDraft(t, "ancestry", { ...base, raceId, ...extra });
        const block = choicesOf(step, name);
        await eventually(() => block.count(), { timeoutMs: 20_000, label: `${name}'s choices` });
        await block.scrollIntoViewIfNeeded();
        return block;
      };

      // Kenku: two skills from its four.
      let block = await people("kenku", "Kenku");
      const kenkuSkill = block.getByRole("button", { name: "Skill proficiency 1" });
      const kenkuRows = await selectRows(t, kenkuSkill);
      const kenkuOffered = kenkuRows.texts.filter((text) => !/^Choose/.test(text));
      await shootBoth(t, page.locator("body"), "ancestry-kenku-skill-open");
      await kenkuRows.close();
      check(kenkuOffered.length === 4, `a kenku is offered its four skills, not ${kenkuOffered.length}: ${kenkuOffered.join(", ")}`);
      await look(t, block, "kenku's choices", problems);
      await ringOnTab(t, kenkuSkill, "kenku's skill pick", problems);
      await shootBoth(t, block, "ancestry-kenku");

      // Warforged: every one of the 39 tools.
      block = await people("warforged", "Warforged");
      const tool = block.getByRole("button", { name: "Tool proficiency" });
      const toolRows = await selectRows(t, tool);
      const tools = toolRows.texts.filter((text) => !/^Choose/.test(text));
      await shootBoth(t, page.locator("body"), "ancestry-warforged-tools-open");
      const headings = await page.locator(".kit-select-group").locator("visible=true").allTextContents();
      await toolRows.close();
      check(tools.length === 39, `a warforged is offered 39 tools, not ${tools.length}`);
      // Named as names, and sorted under the SRD's kinds: a flat list of 39
      // lower-case rows hid the lute thirty rows down.
      if (tools.some((text) => !/^[A-Z]/.test(text))) problems.push(`warforged's tools: rows not named as names (${tools.filter((text) => !/^[A-Z]/.test(text)).slice(0, 3).join(", ")})`);
      if (headings.length < 4) problems.push(`warforged's tools: no kinds to find a tool under (${headings.join(", ") || "none"})`);
      await look(t, block, "warforged's choices", problems);
      await shootBoth(t, block, "ancestry-warforged");

      // Fairy: +2 then +1, each named for its amount, and the Fairy Magic ability.
      block = await people("fairy", "Fairy");
      const plusTwo = block.getByRole("button", { name: "Ability increase 1 (+2)" });
      const plusOne = block.getByRole("button", { name: "Ability increase 2 (+1)" });
      check((await plusTwo.count()) === 1 && (await plusOne.count()) === 1, "a fairy's +2 and +1 are two picks, named for their amount");
      const magic = block.getByRole("button", { name: "Fairy Magic ability" });
      check((await magic.count()) === 1, "a fairy is asked which ability casts its Fairy Magic");
      const magicRows = await selectRows(t, magic);
      check(magicRows.texts.some((text) => /Charisma/.test(text)) && magicRows.texts.some((text) => /Wisdom/.test(text)), `Fairy Magic offers the mental abilities: ${magicRows.texts.join(", ")}`);
      await magicRows.pick("Charisma");
      const twoRows = await selectRows(t, plusTwo);
      await twoRows.pick("Dexterity");
      // The pick keeps room to read on a 390 px phone: "what is this?"
      // beside it once squeezed it to "De...".
      const width = (await plusTwo.boundingBox())?.width ?? 0;
      if (width < 120) problems.push(`fairy's +2 pick: squeezed to ${Math.round(width)}px once chosen`);
      const fairyText = (await block.textContent()) ?? "";
      if (/its words only|nothing beyond its words/.test(fairyText)) problems.push("fairy's Fairy Magic ability: the pick reads as granting nothing (its words only)");
      await look(t, block, "fairy's choices", problems);
      await ringOnTab(t, plusOne, "fairy's +1 pick", problems);
      await shootBoth(t, block, "ancestry-fairy");

      // Owlfolk: its size.
      block = await people("owlfolk", "Owlfolk");
      const size = block.getByRole("button", { name: "Size" });
      check((await size.count()) === 1, "an owlfolk is asked its size");
      const sizeRows = await selectRows(t, size);
      if (sizeRows.texts.some((text) => /its words only/.test(text))) problems.push(`owlfolk's Size: the rows read as granting nothing (${sizeRows.texts.join(", ")})`);
      check(sizeRows.texts.some((text) => /Small/.test(text)) && sizeRows.texts.some((text) => /Medium/.test(text)), `the size offers Small and Medium: ${sizeRows.texts.join(", ")}`);
      await sizeRows.pick("Small");
      if (/nothing beyond its words/.test((await block.textContent()) ?? "")) problems.push("owlfolk's Size: the pick says it gives nothing beyond its words");
      await look(t, block, "owlfolk's choices", problems);
      await shootBoth(t, block, "ancestry-owlfolk");

      // Shifter: its subtype.
      block = await people("shifter", "Shifter");
      const subtype = block.getByRole("button", { name: "Shifter subtype" });
      check((await subtype.count()) === 1, "a shifter is asked its subtype");
      const subRows = await selectRows(t, subtype);
      check(subRows.texts.length >= 4, `four subtypes: ${subRows.texts.join(", ")}`);
      await subRows.pick("Beasthide");
      await look(t, block, "shifter's choices", problems);
      await shootBoth(t, block, "ancestry-shifter");

      // Hobgoblin: two martial weapons.
      block = await people("hobgoblin", "Hobgoblin");
      const weapon = block.getByRole("button", { name: "Weapon proficiency 1" });
      check((await weapon.count()) === 1 && (await block.getByRole("button", { name: "Weapon proficiency 2" }).count()) === 1, "a hobgoblin names two weapons");
      const weaponRows = await selectRows(t, weapon);
      await weaponRows.pick("Longsword");
      await look(t, block, "hobgoblin's choices", problems);
      await ringOnTab(t, block.getByRole("button", { name: "Weapon proficiency 2" }), "hobgoblin's second weapon", problems);
      await shootBoth(t, block, "ancestry-hobgoblin");

      // Satyr: its instrument (a tool pick from the ten).
      block = await people("satyr", "Satyr");
      await look(t, block, "satyr's choices", problems);
      await shootBoth(t, block, "ancestry-satyr");

      // ---- a criminal rogue: thieves' tools twice, another tool in its place ----
      step = await openDraft(t, "ancestry", { ...base, classId: "rogue", raceId: "human", backgroundId: "criminal" });
      const toolPanels = step.locator('section[data-builder-target="tools"]');
      await eventually(() => toolPanels.count(), { timeoutMs: 20_000, label: "the criminal's tool panels" });
      const texts = await toolPanels.allTextContents();
      const replacement = texts.findIndex((text) => /tool\b/i.test(text) && !/gaming set/i.test(text.split("\n")[0] ?? ""));
      check(texts.length >= 2, `a criminal rogue picks its gaming set and a tool in place of the doubled thieves' tools (${texts.length} panel(s): ${texts.map((text) => text.slice(0, 50)).join(" | ")})`);
      for (let at = 0; at < texts.length; at += 1) {
        await look(t, toolPanels.nth(at), `criminal's tool panel ${at + 1}`, problems);
      }
      await shootBoth(t, toolPanels.nth(Math.max(0, replacement)), "ancestry-criminal-replacement-tool");
      await shootBoth(t, toolPanels.first(), "ancestry-criminal-gaming-set");

      // ---- the content pack's peoples, when the pack is here ----
      step = await openDraft(t, "ancestry", { ...base, raceId: "" });
      const packSearch = step.locator('input[aria-label="Search lineages"]').first();
      const packPeople = async (query, pattern, shot) => {
        await packSearch.fill(query);
        const card = step.locator(".creator-card").filter({ hasText: pattern }).locator("visible=true").first();
        if (!(await upTo(() => card.count(), 10_000))) return false;
        await t.tap(card);
        const choices = step.locator("div.rounded-lg").filter({ has: page.locator('p:text-matches("choices$")') }).first();
        await eventually(() => choices.count(), { timeoutMs: 20_000, label: `the choices of ${query}` });
        await choices.scrollIntoViewIfNeeded();
        await look(t, choices, `${query}'s choices`, problems);
        await shootBoth(t, choices, shot);
        return choices;
      };
      const mutated = await packPeople("Mutated", /Derro \(Mutated\)/, "ancestry-pack-derro-mutated");
      if (mutated) {
        check((await mutated.getByRole("button", { name: /^Weapon proficiency 1/ }).count()) === 1, "a mutated derro names its martial weapons");
        const human = await packPeople("Human Chassis", /Gearforged \(Human Chassis\)/, "ancestry-pack-gearforged-human");
        check(Boolean(human), "the pack's human-chassis gearforged has a card");
        if (human) {
          check((await human.getByRole("button", { name: /^Skill or tool proficiency 1/ }).count()) === 1, "Adaptable Acumen asks a skill or tool");
          const training = await selectRows(t, human.getByRole("button", { name: /^Skill or tool proficiency 1/ }));
          await shootBoth(t, page.locator("body"), "ancestry-pack-acumen-open");
          await training.pick("Smith's tools");
          check((await human.getByRole("button", { name: "Expertise" }).count()) === 1, "Adaptable Acumen asks the skill it doubles");
        }
        const gnome = await packPeople("Gnome Chassis", /Gearforged \(Gnome Chassis\)/, "ancestry-pack-gearforged-gnome");
        check(Boolean(gnome), "the pack's gnome-chassis gearforged has a card");
      }
      for (const text of errors.seen) problems.push(`console: ${text}`);
    } finally {
      errors.stop();
    }
    check(!problems.length, `the Ancestry step's new controls:\n  ${problems.join("\n  ")}`);
  },
};
