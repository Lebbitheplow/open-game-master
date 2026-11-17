// Issues 411 and 412 at the sheet. Vex, the lead's netrunner, is a genre
// class: her features explain themselves once the cyberpunk catalog has been
// fetched, which is no longer part of the table's first load (411). She wears
// a Cloak of Protection and carries a Cloak of Elvenkind: putting the second
// on asks to take the first off, the swap goes through in one press, and the
// lead (who corrects the table) may let both be worn, the SRD's exception
// (412). A workshop author says where a homebrew item is worn with the item
// form's "Worn on" picker, labelled, explained and clean under axe, and gone
// once the item is armour. The sheet shows her gear on a paperdoll: a tile
// for every place on the body, filled or empty, which opens the rows that go
// there, by finger and by keyboard, clean under axe by day and by night.
// Runs on the website and inside the app's own screens.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const PROTECTION = "Cloak of Protection";
const ELVENKIND = "Cloak of Elvenkind";

export default {
  name: "wardrobe",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const campaignId = ids.wardrobe[viewport];
    const gear = async () => {
      const table = await (await api.get(`${base}/api/campaigns/${campaignId}`)).json();
      const vex = (table.sheets ?? []).find((sheet) => sheet.name === "Vex Halloran");
      return Object.fromEntries((vex?.equipment ?? []).map((item) => [item.name, item]));
    };

    await t.open(`/campaigns/${campaignId}`);
    const card = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Vex Halloran" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Vex's party card" });
    await t.tap(card);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Worn gear sets your AC" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Vex's sheet with her gear" });

    // 411: the genre feature's help arrives with its catalog.
    const help = sheet.getByRole("button", { name: "What is Deck Interface?" });
    await eventually(() => help.count(), { timeoutMs: 20_000, label: "Deck Interface's help, once the cyberpunk catalog is fetched" });
    await help.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(help.first());
    const explained = page.getByRole("dialog").filter({ hasText: /cyberdeck/ }).locator("visible=true").first();
    await eventually(() => explained.count(), { label: "Deck Interface explained" });
    // Past the dialog's fade-in, so the shot shows it.
    await untilStill(page);
    await t.shot("feature-help");
    await page.keyboard.press("Escape");
    await eventually(async () => (await explained.count()) === 0, { label: "the help closing" });

    // The paperdoll: every place has a tile, and a tile opens its rows.
    const rowOf = (name) => sheet.locator(`[data-gear-row="${name}"]`).first();
    const place = (id) => sheet.locator(`[data-doll-place="${id}"]`).first();
    const openPlace = async (id) => {
      await place(id).scrollIntoViewIfNeeded().catch(() => undefined);
      if ((await place(id).getAttribute("aria-expanded")) !== "true") await t.tap(place(id));
      await eventually(() => sheet.locator(`[data-doll-panel="${id}"]`).count(), { label: `the ${id} place open` });
    };
    const before = await gear();
    check(before[PROTECTION]?.equipped === true && before[ELVENKIND]?.equipped === false, "Vex starts in the Cloak of Protection");
    await eventually(() => place("cloak").count(), { label: "the paperdoll" });
    const bracers = '/assets/icons/inventory/magic-bracers.webp';
    // The app resolves bundled images locally and keeps the requested path.
    const artImage = (src) => `img[src="${src}"], img[data-odm-src="${src}"]`;
    check(await sheet.locator(artImage(bracers)).count() >= 2, "bracers have their own art in the inventory chip and worn tile");
    check(await place("cloak").locator(artImage("/assets/icons/inventory/magic-cloak.webp")).count() === 1, "the cloak tile uses the circular cloak painting");
    for (const id of ["gear-quiver", "gear-lute", "gear-drum", "magic-dust"]) {
      const added = sheet.locator(artImage(`/assets/icons/inventory/${id}.webp`)).first();
      check(await added.count() === 1, `${id} uses its approved inventory painting`);
      await added.scrollIntoViewIfNeeded();
      await eventually(() => added.evaluate(img => img.complete && img.naturalWidth > 0), { label: `${id} image loaded` });
    }
    await untilStill(page);
    await t.shot("inventory-additions-night");
    const additionsTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("inventory-additions-day");
    await page.evaluate(theme => (document.documentElement.dataset.theme = theme), additionsTheme);
    // Twelve places on the body and in the hands, and Other items for her
    // orb, which has no place on the body (the tile is drawn only for a pack
    // that holds something for it).
    check((await sheet.locator("[data-doll-place]").count()) === 13, "the doll has a tile for every place");
    check((await place("other").getAttribute("aria-label")) === "Other items: empty. Magic with no place on the body. 1 in the pack.", "the Other items tile counts her orb");
    check((await place("held").getAttribute("aria-label")) === "In hand: empty. Weapons, a wand, staff or rod. 1 in the pack.", "the In hand tile counts her wand");
    check((await place("cloak").getAttribute("aria-label")) === `Shoulders: ${PROTECTION}, attuned.`, "the shoulders tile names the cloak worn there");
    check((await place("body").getAttribute("aria-label")) === "Body: Leather.", "the body tile names the suit");
    check((await place("head").getAttribute("aria-label")) === "Head: empty. A hat, helm or circlet.", "an empty place says what goes there");
    check((await rowOf(ELVENKIND).count()) === 0, "no row shows before its place is opened");
    const small = await sheet.locator("[data-doll-place]").evaluateAll((tiles) => tiles.filter((tile) => tile.offsetHeight < 40 || tile.offsetWidth < 40).map((tile) => tile.dataset.dollPlace));
    check(small.length === 0, `every tile is finger-sized (${small.join(", ") || "all"})`);
    const spill = await sheet.locator("[data-paperdoll]").evaluate((doll) => doll.scrollWidth - doll.clientWidth);
    check(spill <= 0, `the doll fits its sheet (${spill}px over)`);
    await place("head").scrollIntoViewIfNeeded().catch(() => undefined);
    await untilStill(page);
    await t.shot("doll");
    const dollNight = await axeViolations(page, "[data-paperdoll]");
    check(dollNight.length === 0, `the doll passes axe: ${JSON.stringify(dollNight).slice(0, 400)}`);
    const dollTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await page.waitForTimeout(800);
    const dollDay = await axeViolations(page, "[data-paperdoll]");
    check(dollDay.length === 0, `the doll passes axe in the day theme: ${JSON.stringify(dollDay).slice(0, 400)}`);
    await t.shot("doll-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), dollTheme);
    await openPlace("wrists");
    const bracerRow = rowOf("Bracers of Defense");
    check(await bracerRow.locator(artImage(bracers)).count() === 1, "the opened bracer row uses the same art");
    await eventually(() => bracerRow.locator("img").evaluate(img => img.complete && img.naturalWidth > 0), { label: "the bracer artwork loaded" });
    await t.shot("doll-bracers");
    await t.tap(place("wrists"));
    // From the keyboard: an empty place opens and says nothing she carries goes there.
    await place("head").focus();
    await page.keyboard.press("Enter");
    const headPanel = sheet.getByRole("group", { name: "Head: what goes there" });
    await eventually(() => headPanel.count(), { label: "the head place opened from the keyboard" });
    check(/One item of headwear counts at a time/.test((await headPanel.textContent()) ?? ""), "the open place says its rule");
    check(/Nothing you carry goes here./.test((await headPanel.textContent()) ?? ""), "an empty place with nothing to wear says so");
    check((await place("head").getAttribute("aria-expanded")) === "true", "the tile says it is open");
    await page.keyboard.press("Enter");
    await eventually(async () => (await headPanel.count()) === 0, { label: "the head place shut again" });

    // Her wand is in hand beside the weapons, and reads as they do.
    await openPlace("held");
    const wand = rowOf("Wand of Magic Missiles").getByRole("button").first();
    check(((await wand.textContent()) ?? "").trim() === "Packed", "the wand's button reads Packed");
    check((await wand.getAttribute("aria-label")) === "Wand of Magic Missiles: Packed. Take it in hand.", "a screen reader hears where the wand is and what the press does");
    check(/does not stop a weapon being drawn/.test((await sheet.locator('[data-doll-panel="held"]').textContent()) ?? ""), "the place says a wand is no part of the two-hands rule");
    // Her orb is attuned to and never put on: one button, under Other items.
    await openPlace("other");
    const orb = await rowOf("Crystal Ball").getByRole("button").allTextContents();
    check(orb.length === 1 && orb[0].trim() === "attune", `the orb offers attunement and nothing else (${orb.join(", ")})`);
    await untilStill(page);
    await t.shot("doll-other");

    // 412: the second cloak asks first.
    await openPlace("ring");
    // Its details say it requires attunement, and only items the magic item
    // table holds offer the button, so a ring left out could never be attuned.
    const ring = rowOf("Ring of Spell Storing");
    // What the ring holds is read under its row (src/lib/srd/spell-storing.ts).
    await eventually(() => sheet.getByText("Holds Fireball (level 3)").count(), { label: "what the Ring of Spell Storing holds" });
    await t.shot("stored");
    const storedTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    // Past the theme's fade, so the shot shows the day colors.
    await page.waitForTimeout(800);
    await t.shot("stored-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), storedTheme);
    await ring.scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(ring.getByRole("button", { name: "attune", exact: true }));
    await eventually(async () => (await gear())["Ring of Spell Storing"]?.attuning === true, { label: "the Ring of Spell Storing attuning" });
    await eventually(() => ring.getByRole("button", { name: "cancel", exact: true }).count(), { label: "the ring's attunement offered back" });
    // The row is at its fullest here, with the attuning mark beside both
    // buttons. The buttons keep their whole width and the name gives way: a
    // flex row shrank all three, which cut the end off "cancel" on a phone.
    // Measured on the words against the box inside the padding, unrounded:
    // scrollWidth and clientWidth round apart by a pixel on a desktop font,
    // which read a whole "cancel" as cut.
    const cut = await ring.evaluate((row) => [...row.querySelectorAll("button")].filter((button) => {
      const words = document.createRange();
      words.selectNodeContents(button);
      const style = getComputedStyle(button);
      const inner = button.getBoundingClientRect().width - ["borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight"].reduce((sum, key) => sum + parseFloat(style[key]), 0);
      return words.getBoundingClientRect().width > inner + 0.5;
    }).map((button) => button.textContent));
    check(cut.length === 0, `the attuning ring's buttons show their whole words (cut: ${cut.join(", ") || "none"})`);
    // On the narrowest phone the row still fits and the name stays readable.
    if (viewport === "phone") {
      const size = page.viewportSize();
      await page.setViewportSize({ width: 320, height: size.height });
      await eventually(async () => {
        const fit = await ring.evaluate((row) => ({ spill: row.scrollWidth - row.clientWidth, name: row.querySelector("span.truncate").clientWidth }));
        return fit.spill <= 0 && fit.name >= 40 ? fit : null;
      }, { timeoutMs: 3_000, label: "the attuning ring's row fitting a 320px phone with its name showing" });
      await t.shot("attuning-320");
      await page.setViewportSize(size);
    }
    await t.shot("attuning");

    await openPlace("cloak");
    await untilStill(page);
    await t.shot("doll-open");
    await rowOf(ELVENKIND).scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(rowOf(ELVENKIND).getByRole("button", { name: "wear", exact: true }));
    const ask = sheet.getByRole("group", { name: `Wear ${ELVENKIND}?` });
    await eventually(() => ask.count(), { label: "the question before a second cloak" });
    const text = ((await ask.textContent()) ?? "").replace(/\s+/g, " ");
    check(text.includes(`${ELVENKIND} goes where ${PROTECTION} is: a character wears one cloak at a time.`), `the question names both cloaks (${text})`);
    check((await ask.getByRole("button", { name: /Wear both/ }).count()) === 1, "the lead is offered the DM's exception");
    // The whole question is on screen, its answers included: in the open
    // place it opened under the last row a phone showed, below the fold.
    await eventually(async () => {
      const box = await ask.boundingBox();
      const frame = await sheet.boundingBox();
      return box && frame && box.y >= frame.y && box.y + box.height <= Math.min(frame.y + frame.height, page.viewportSize().height) ? box : null;
    }, { timeoutMs: 3_000, label: "the question, with its answers, on screen" });
    await untilStill(page);
    await t.shot("asked");
    check((await gear())[ELVENKIND]?.equipped === false, "nothing was posted before the answer");

    // The swap: one press, the first comes off, the second goes on.
    await t.tap(ask.getByRole("button", { name: `Take off ${PROTECTION}, wear ${ELVENKIND}` }));
    await eventually(async () => {
      const now = await gear();
      return now[PROTECTION]?.equipped === false && now[ELVENKIND]?.equipped === true;
    }, { label: "the swap stored" });
    await eventually(async () => ((await rowOf(ELVENKIND).getByRole("button", { name: "worn", exact: true }).count()) === 1), {
      label: "the Cloak of Elvenkind marked worn on the sheet",
    });
    check((await place("cloak").getAttribute("aria-label")) === `Shoulders: ${ELVENKIND}, attuned.`, "the shoulders tile follows the swap");
    await t.shot("swapped");

    // The lead's exception: both cloaks, the Cloak of Protection marked beside another.
    await t.tap(rowOf(PROTECTION).getByRole("button", { name: "wear", exact: true }));
    const again = sheet.getByRole("group", { name: `Wear ${PROTECTION}?` });
    await eventually(() => again.count(), { label: "the question before the first cloak goes back on" });
    await t.tap(again.getByRole("button", { name: /Wear both/ }));
    await eventually(async () => {
      const now = await gear();
      return now[PROTECTION]?.equipped === true && now[PROTECTION]?.layered === true && now[ELVENKIND]?.equipped === true;
    }, { label: "both cloaks stored, the second on the DM's say" });
    await eventually(() => rowOf(PROTECTION).getByText("beside another").count(), { label: "the beside-another mark" });
    await t.shot("both");

    // The workshop: a homebrew mantle worn on the shoulders. The shelf is
    // the user's, shared by every run, so the name is this run's own.
    const mantle = `Mantle of the Gloaming ${viewport}${t.app ? " app" : ""}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Wardrobe", description: "" } });
    check(made.ok(), "a workshop for the item form");
    const workshopId = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-homebrew", version: 1, how: "ended" }] } });
    try {
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.count(), { timeoutMs: 30_000, label: "the homebrew shelf" });
      await t.tap(kinds.getByText(/^Items/).first());
      await t.tap(page.getByRole("button", { name: /New item/ }).locator("visible=true").first());
      const name = page.getByRole("textbox", { name: /^Name/ }).locator("visible=true").first();
      await eventually(() => name.count(), { timeoutMs: 20_000, label: "the item form" });
      await name.fill(mantle);
      const wornOn = page.getByRole("button", { name: "Worn on", exact: true }).locator("visible=true").first();
      await eventually(() => wornOn.count(), { label: "the Worn on picker on plain gear" });
      check(/Not worn/.test(await wornOn.innerText()), "an item starts not worn");
      const kind = page.getByRole("button", { name: "Kind", exact: true }).locator("visible=true").first();
      await t.tap(kind);
      await t.tap(page.getByRole("menuitemradio", { name: "Magic item" }).locator("visible=true").first());
      await eventually(() => wornOn.count(), { label: "the Worn on picker on a magic item" });
      const field = wornOn.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
      check(/One cloak, hat, pair of boots, gloves or bracers counts at a time\./.test(await field.innerText()), "the hint says what the place does");
      const box = await wornOn.boundingBox();
      check(box && box.height >= (viewport === "phone" ? 40 : 32), `the picker is big enough to tap (${Math.round(box?.height ?? 0)}px)`);

      // The ⓘ names every place and what the limit there is.
      await t.tap(page.getByRole("button", { name: "What is Places on the body?" }).locator("visible=true").first());
      const glossary = page.getByRole("dialog").filter({ hasText: "Shoulders (a cloak or cape)" }).locator("visible=true").first();
      await eventually(() => glossary.count(), { label: "the places explained" });
      check(/One cloak counts at a time/.test(await glossary.innerText()), "the glossary says one cloak counts");
      await untilStill(page);
      await t.shot("worn-on-glossary");
      await page.keyboard.press("Escape");
      await eventually(async () => (await glossary.count()) === 0, { label: "the glossary closing" });

      // Picked from the keyboard: focus, open, choose.
      await wornOn.focus();
      await page.keyboard.press("Enter");
      const shoulders = page.getByRole("menuitemradio", { name: "Shoulders (a cloak or cape)" }).locator("visible=true").first();
      await eventually(() => shoulders.count(), { label: "the places listed from the keyboard" });
      await t.tap(shoulders);
      await eventually(async () => /Shoulders/.test(await wornOn.innerText()), { label: "Shoulders picked" });
      const form = page.locator(`${root}[role="dialog"]`).filter({ has: wornOn }).first();
      const problems = await axeViolations(page, (await form.count()) ? `[role="dialog"]` : "main");
      check(problems.length === 0, `the item form passes axe: ${JSON.stringify(problems).slice(0, 400)}`);
      await wornOn.scrollIntoViewIfNeeded().catch(() => undefined);
      await untilStill(page);
      await t.shot("worn-on");
      // Legible in the day theme too: the field alone under axe, contrast included.
      const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      await field.evaluate((element) => element.setAttribute("data-check", "worn-on"));
      await untilStill(page);
      const day = await axeViolations(page, '[data-check="worn-on"]');
      check(day.length === 0, `the picker passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
      await t.shot("worn-on-day");
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

      // Armour places itself, so the picker goes while it is armour.
      const alsoArmour = page.getByRole("switch", { name: "It is also armour" }).locator("visible=true").first();
      await alsoArmour.scrollIntoViewIfNeeded().catch(() => undefined);
      await t.tap(alsoArmour);
      await eventually(async () => (await wornOn.count()) === 0, { label: "the picker gone while it is armour" });
      await t.tap(alsoArmour);
      await eventually(() => wornOn.count(), { label: "the picker back" });

      await t.tap(page.getByRole("button", { name: "Keep it", exact: true }).locator("visible=true").first());
      const line = page.getByText(/worn on the shoulders/).locator("visible=true").first();
      await eventually(() => line.count(), { timeoutMs: 20_000, label: "the shelf line saying where it is worn" });
      const shelf = await (await api.get(`${base}/api/homebrew`)).json();
      const kept = (shelf.entries ?? []).find((entry) => entry.name === mantle);
      check(kept?.data?.wornOn === "cloak", `the mantle is stored worn on the shoulders (${JSON.stringify(kept?.data?.wornOn)})`);
    } finally {
      const shelf = await (await api.get(`${base}/api/homebrew`)).json().catch(() => ({}));
      for (const entry of (shelf.entries ?? []).filter((item) => item.name === mantle)) {
        await api.delete(`${base}/api/homebrew/${entry.id}`);
      }
      await api.delete(`${base}/api/workshops/${workshopId}`);
    }
  },
};
