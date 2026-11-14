// The character creator audit of 2026-11-13 (cc1113), where a finished
// character is read and levelled: the library's character page, the sheet
// at the table, and the table's level-up. On desktop and on a 390 px phone,
// by day and by night, on the website and in the app's own screens. The
// characters are the seed's (scripts/browser/seed.mjs creatorAudit), and no
// level is taken, so every viewport opens the same ones.
//
//   - Hoot, an owlfolk Metallurgist who picked Small, from the Crime
//     Syndicate Member background: the page and the sheet show the size,
//     the Athletics that holds only in the Mystic Metal suit (and that it
//     holds now), the pack background's feature with what it does, the
//     Personality lines; the sheet owes the owlfolk's language of choice
//     and lets its owner change the personality;
//   - Morrow, a warlock reaching 11th: the level-up's spells ask for the
//     6th-level Mystic Arcanum;
//   - Brisk, a fighter reaching 5th with Fighting Initiate and no style for
//     it: taking bard instead asks for its musical instrument, and staying
//     a fighter asks for the feat's style;
//   - each part has named controls, a finger's size on a phone, nothing
//     pushed past its edge, no sideways scroll, and a clean axe run.
import fs from "node:fs";
import path from "node:path";
import { check, eventually, openPanelTab, untilStill, upTo } from "../lib.mjs";
import { consoleErrors, look, narrowPhone, ringOnTab, shootBoth } from "../creator-audit.mjs";

// Hoot's Metallurgist subclass (Black Flag) and Crime Syndicate Member
// background are content-pack rows: with no pack (CI's browser run) the
// suit's Athletics line and the background's feature have nothing to show,
// and the page's ask for the background answers 404.
const TREE = path.resolve(import.meta.dirname, "..", "..", "..");
const hasPack = () => fs.existsSync(process.env.CONTENT_DB_PATH ?? path.join(TREE, "data", "content", "open5e.sqlite"));

async function openSheet(t, name) {
  const { page, root } = t;
  const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: name }).locator("visible=true").first();
  for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
    if (await card.count()) break;
    const door = page.locator(selector).locator("visible=true").first();
    if (await door.count()) {
      await t.tap(door);
      await upTo(() => card.count(), 800);
    }
  }
  await eventually(() => card.count(), { timeoutMs: 30_000, label: `${name}'s party card` });
  await t.tap(card);
  const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: name }).last();
  await eventually(() => sheet.count(), { timeoutMs: 20_000, label: `${name}'s sheet` });
  await untilStill(page).catch(() => {});
  return sheet;
}

// The level-up dialog, walked with Next until `ready` shows.
async function levelUpTo(t, level, ready, label) {
  const { page, root } = t;
  const dialog = page.locator('[role="dialog"]:visible').last();
  await eventually(
    async () => {
      if (!(await dialog.count())) {
        // The level-up moment plays first; the party card's button opens
        // the dialog if it has gone.
        const button = page.locator(`${root}button`).filter({ hasText: new RegExp(`Level up to ${level}`) }).locator("visible=true");
        if (await button.count()) await t.tap(button.first()).catch(() => {});
        return false;
      }
      return ready(dialog);
    },
    { timeoutMs: 60_000, label },
  );
  return dialog;
}

const nextIn = (dialog) => dialog.locator("button").filter({ hasText: /^\s*Next\s*$/ }).locator("visible=true").first();

export default {
  name: "creator-sheets",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, ids, viewport } = t;
    const audit = ids.creatorAudit;
    await narrowPhone(t);
    const problems = [];
    const errors = consoleErrors(page);
    const hootLines = async (scope, where, { pack = true } = {}) => {
      const text = ((await scope.textContent()) ?? "").replace(/\s+/g, " ");
      if (!/Small/.test(text)) problems.push(`${where}: the owlfolk's size (Small) is not shown`);
      if (!hasPack()) {
        // The suit's Athletics comes from the pack's Metallurgist.
      } else if (!/Conditional/.test(text) || !/Athletics while wearing the armor from Mystic Metal/i.test(text)) problems.push(`${where}: no conditional Athletics line`);
      else if (!/holds now/.test(text)) problems.push(`${where}: the conditional Athletics does not say it holds now, in the suit`);
      if (pack && hasPack() && !/A Favor In Turn/.test(text)) problems.push(`${where}: the pack background's feature is not shown`);
      if (!/Personality/.test(text) || !/I watch the exits/.test(text)) problems.push(`${where}: the Personality lines are not shown`);
    };
    try {
      // ---- the library's character page ----
      await t.open(`/characters/${audit.hootCharacterId}`);
      const pageRoot = page.locator(`${t.root}main`).first();
      await eventually(async () => /Hoot Ashfeather/.test((await pageRoot.textContent()) ?? ""), { timeoutMs: 30_000, label: "Hoot's character page" });
      await untilStill(page).catch(() => {});
      await hootLines(pageRoot, "character page");
      // The background feature's info opens what it does.
      const favor = pageRoot.getByRole("button", { name: /What is A Favor In Turn\?/ }).first();
      if (!hasPack()) {
        // No pack, no background feature to open.
      } else if (await upTo(() => favor.count(), 5_000)) {
        await t.tap(favor);
        const info = page.locator('[role="dialog"]').filter({ hasText: "A Favor In Turn" }).last();
        await eventually(() => info.count(), { timeoutMs: 10_000, label: "the feature's info" });
        await eventually(async () => /favor|syndicate/i.test(((await info.textContent()) ?? "").replace(/A Favor In Turn/g, "")), { timeoutMs: 15_000, label: "the feature's text" }).catch(() =>
          problems.push("character page: the background feature's info opens with no text"),
        );
        // The feature, not the background's whole story with the feature at its foot.
        if (/slum-run streets/.test((await info.textContent()) ?? "")) problems.push("character page: the feature's info opens the background's whole story");
        await untilStill(page).catch(() => {});
        await shootBoth(t, null, "library-background-feature-info");
        await page.keyboard.press("Escape");
        await eventually(async () => (await info.count()) === 0, { timeoutMs: 10_000, label: "the info closed" });
      } else {
        problems.push("character page: the background feature has no info button");
      }
      for (const title of ["Languages and training", "Features and traits", "Personality"]) {
        const panel = pageRoot.locator("section").filter({ hasText: title }).last();
        if (await panel.count()) {
          await look(t, panel, `character page: ${title}`, problems);
          await shootBoth(t, panel, `library-${title.toLowerCase().replace(/\W+/g, "-")}`);
        } else {
          problems.push(`character page: no ${title} panel`);
        }
      }

      // ---- the sheet at the table ----
      await t.open(`/campaigns/${audit.sheetTableId}`);
      if (viewport === "phone") await openPanelTab(t, "party").catch(() => {});
      const sheet = await openSheet(t, "Hoot Ashfeather");
      await hootLines(sheet, "table sheet", { pack: false });
      const owed = sheet.getByText(/Languages to choose/).first();
      if (await upTo(() => owed.count(), 10_000)) {
        await owed.scrollIntoViewIfNeeded();
        const block = sheet.locator("div, section").filter({ hasText: /Choices owed/ }).filter({ hasText: /Languages to choose/ }).last();
        await look(t, block, "table sheet: Languages to choose", problems);
        await shootBoth(t, block, "sheet-languages-owed");
      } else {
        problems.push("table sheet: the owlfolk's language of choice is not owed");
      }
      const training = sheet.locator("section, div").filter({ hasText: /^\s*Languages and training/ }).last();
      if (await training.count()) await shootBoth(t, training, "sheet-conditional-training");
      const change = sheet.getByRole("button", { name: /Change personality/ });
      await eventually(() => change.count(), { timeoutMs: 10_000, label: "the owner's Change personality" });
      // The block the button sits in (SheetBlock: its title, then its body).
      const persona = sheet.locator("section, div").filter({ has: page.getByRole("button", { name: /Change personality/ }) }).filter({ hasText: /Personality trait/ }).last();
      await persona.scrollIntoViewIfNeeded();
      await look(t, persona, "table sheet: Personality", problems);
      await shootBoth(t, persona, "sheet-personality");
      await ringOnTab(t, change, "Change personality", problems);
      await t.tap(change);
      const editing = sheet.locator('[role="group"]').filter({ has: page.locator('button[aria-haspopup], button[aria-expanded]') });
      await eventually(async () => (await editing.count()) === 4, { timeoutMs: 10_000, label: "the four personality pickers" });
      await untilStill(page).catch(() => {});
      const editor = sheet.locator("section, div").filter({ has: page.getByRole("button", { name: /Save personality/ }) }).filter({ hasText: /Personality trait/ }).last();
      await look(t, editor, "table sheet: Personality, changing", problems);
      await shootBoth(t, editor, "sheet-personality-editing");
      await t.tap(sheet.getByRole("button", { name: /^Cancel$/ }));
      await eventually(async () => (await editing.count()) === 0, { timeoutMs: 10_000, label: "the personality back to its lines" });
      await page.keyboard.press("Escape");

      // ---- the level-up: Mystic Arcanum ----
      await t.open(`/campaigns/${audit.arcanumTableId}`);
      if (viewport === "phone") await openPanelTab(t, "party").catch(() => {});
      const arcanum = await levelUpTo(
        t,
        11,
        async (dialog) => {
          if (/Mystic Arcanum: choose one level 6 warlock spell/.test((await dialog.textContent()) ?? "")) return true;
          const next = nextIn(dialog);
          if (await next.count()) await t.tap(next).catch(() => {});
          return false;
        },
        "the level-up's Mystic Arcanum",
      );
      await untilStill(page).catch(() => {});
      if (!/Mystic Arcanum \d+\/1/.test(((await arcanum.textContent()) ?? "").replace(/\s+/g, " "))) problems.push("level-up: the spell book does not count the Mystic Arcanum beside the spells known");
      const sixth = arcanum.locator("button").filter({ hasText: /^\s*VI\s*$/ }).first();
      if (await sixth.count()) {
        await t.tap(sixth);
        await untilStill(page).catch(() => {});
      } else {
        problems.push("level-up: the spell book has no 6th-level tab for the arcanum");
      }
      await look(t, arcanum, "level-up: Mystic Arcanum step", problems);
      await shootBoth(t, null, "levelup-arcanum");
      await page.keyboard.press("Escape");
      await upTo(async () => (await page.locator('[role="dialog"]').count()) === 0, 5_000);

      // ---- the level-up: a bard's instrument, and Fighting Initiate's style ----
      await t.open(`/campaigns/${audit.initiateTableId}`);
      if (viewport === "phone") await openPanelTab(t, "party").catch(() => {});
      const search = page.locator('input[aria-label="Search classes"]').locator("visible=true").first();
      const initiate = await levelUpTo(t, 5, async () => (await search.count()) > 0, "the level-up's class step");
      await search.fill("bard");
      const bard = initiate.locator("button[aria-pressed]").filter({ hasText: /^\s*Bard/ }).first();
      await eventually(() => bard.count(), { timeoutMs: 10_000, label: "Bard in the class list" });
      await t.tap(bard);
      const tools = initiate.getByRole("group", { name: /Bard tool proficiency/ });
      if (await upTo(() => tools.count(), 10_000)) {
        await tools.scrollIntoViewIfNeeded();
        const pills = tools.locator("button");
        check((await pills.count()) >= 10, `the bard's instrument is picked from the ten (${await pills.count()})`);
        await look(t, tools, "level-up: bard's instrument", problems);
        await ringOnTab(t, pills.first(), "level-up: first instrument", problems);
        await t.tap(pills.first());
        await untilStill(page).catch(() => {});
        await shootBoth(t, tools.locator("xpath=.."), "levelup-bard-instrument");
      } else {
        problems.push("level-up: taking bard never asks for its instrument");
      }
      // Back to fighter, and on to the style the feat opens.
      await search.fill("");
      // The class it already has sits above the multiclass list.
      const fighter = initiate.locator("button").filter({ hasText: /^\s*Fighter/ }).first();
      await eventually(() => fighter.count(), { timeoutMs: 10_000, label: "Fighter in the class list" });
      await t.tap(fighter);
      await eventually(
        async () => {
          if (/Fighting Style: pick 1/.test((await initiate.textContent()) ?? "")) return true;
          const next = nextIn(initiate);
          if (await next.count()) await t.tap(next).catch(() => {});
          return false;
        },
        { timeoutMs: 30_000, label: "the level-up's style for Fighting Initiate" },
      ).catch(() => problems.push("level-up: Fighting Initiate's style is never asked"));
      await untilStill(page).catch(() => {});
      // The style the fighter already has is not offered again.
      const styleText = (await initiate.textContent()) ?? "";
      if (/Fighting Style: pick/.test(styleText) && initiate.locator("button").filter({ hasText: /^\s*Defense/ })) {
        if (await initiate.locator("button").filter({ hasText: /^\s*Defense/ }).count()) problems.push("level-up: Defense, already Brisk's style, is offered again");
      }
      await look(t, initiate, "level-up: Fighting Initiate style step", problems);
      await shootBoth(t, null, "levelup-fighting-initiate");
      await page.keyboard.press("Escape");
      for (const text of errors.seen) if (hasPack() || !/\/api\/content\/backgrounds\//.test(text)) problems.push(`console: ${text}`);
    } finally {
      errors.stop();
    }
    check(!problems.length, `the sheets and the level-up:\n  ${problems.join("\n  ")}`);
  },
};
