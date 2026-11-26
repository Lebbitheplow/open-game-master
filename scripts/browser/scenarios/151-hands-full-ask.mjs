// Issue 1105: a two-weapon fighter on the road, a scimitar and a shortsword
// in hand by the engine's own pick, dragged a dagger onto "In hand". The
// shortsword was put away unasked, and dragging it back was refused with
// "putting one away takes your object interaction this turn" in no fight at
// all, with nothing on the sheet to press next. Full hands now ask on the
// row that was to be taken up: one answer for each weapon that could go back
// in the pack, and one to keep things as they are. Driven here by a drag
// (with a mouse) and by the row's own button, answered by finger and by
// keyboard, finger-sized at phone width, clean under axe by day and night.
// Runs on the website and inside the app's own screens.
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "hands-full-ask",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, ids, viewport } = t;
    const table = ids.handsTables[viewport];
    const gear = async () => {
      const body = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
      const jason = (body.sheets ?? []).find((sheet) => sheet.id === table.hero);
      return Object.fromEntries((jason?.equipment ?? []).map((item) => [item.name, item]));
    };
    const held = async () => Object.values(await gear()).filter((item) => item.equipped === true && item.name !== "Leather Armor").map((item) => item.name);
    // The day theme as the app's own switch sets it (49-wardrobe).
    const DAY = { theme: "light", scheme: "light" };
    const setTheme = (to) => page.evaluate((next) => {
      const top = document.documentElement;
      const was = { theme: top.dataset.theme ?? "", scheme: top.style.colorScheme };
      top.dataset.theme = next.theme;
      top.style.colorScheme = next.scheme;
      return was;
    }, to);

    const start = await gear();
    check(start.Scimitar?.equipped === true && start.Shortsword?.equipped === true && start.Dagger?.equipped === false, "the engine's pick holds both light blades and packs the dagger");
    check(start.Scimitar?.heldGuess === true && start.Dagger?.heldGuess === true, "the marks are the engine's guess");
    const body = await (await api.get(`${base}/api/campaigns/${table.id}`)).json();
    check(!body.encounter, "no fight is running");

    await t.open(`/campaigns/${table.id}`);
    const party = page.locator(`${root}button[title="View full character sheet"]`).filter({ hasText: "Jason Reed" }).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await party.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => party.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => party.count(), { timeoutMs: 30_000, label: "Jason's party card" });
    await t.tap(party);
    const sheet = page.locator(`${root}[role="dialog"]`).filter({ hasText: "Worn gear sets your AC" }).first();
    await eventually(() => sheet.count(), { timeoutMs: 20_000, label: "Jason's sheet with his gear" });
    const place = (id) => sheet.locator(`[data-doll-place="${id}"]`).first();
    const toggle = (name) => sheet.locator(`[data-gear-row="${name}"] button`).first();
    const asked = (name) => sheet.getByRole("group", { name: `Take up ${name}?` });
    const answer = (name, label) => asked(name).getByRole("button", { name: label, exact: true });
    await eventually(() => place("held").count(), { label: "the In hand place" });
    await place("held").scrollIntoViewIfNeeded().catch(() => undefined);
    // The weapons' rows are in the In hand place. A question raised by a drop
    // opens it, and it shuts again with the question, as a place does that
    // nobody pressed.
    const openHeld = async () => {
      await place("held").scrollIntoViewIfNeeded().catch(() => undefined);
      if ((await place("held").getAttribute("aria-expanded")) !== "true") await t.tap(place("held"));
      await eventually(() => toggle("Dagger").count(), { label: "the weapons' rows" });
    };

    // The dagger is taken up: dragged onto In hand with a mouse, as the
    // report did, and pressed on its own row by a finger.
    if (viewport === "desktop") {
      const chip = sheet.locator('[data-chip="Dagger"]').first();
      const middle = async (locator) => {
        const box = await locator.boundingBox();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      await chip.evaluate((element) => element.scrollIntoView({ block: "center" }));
      const from = await middle(chip.locator("span.truncate").first());
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
      await eventually(() => page.locator("[data-doll-ghost]").count(), { label: "the dagger picked up" });
      let to = await middle(place("held"));
      const height = page.viewportSize().height;
      if (to.y > height - 30) {
        await page.mouse.wheel(0, to.y - height + 120);
        await eventually(async () => ((await middle(place("held"))).y < height - 30 ? true : null), { label: "the In hand place scrolled into reach" });
        to = await middle(place("held"));
      }
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await eventually(async () => (await place("held").getAttribute("data-drop")) === "over", { label: "the In hand place lit under the dagger" });
      await page.mouse.up();
    } else {
      await openHeld();
      await toggle("Dagger").scrollIntoViewIfNeeded().catch(() => undefined);
      await t.tap(toggle("Dagger"));
    }

    // Asked, on the dagger's row, with nothing put away.
    await eventually(() => asked("Dagger").count(), { timeoutMs: 15_000, label: "the question full hands ask" });
    check((await sheet.locator('[data-doll-panel="held"]').count()) === 1, "the In hand place is open for the question");
    check(JSON.stringify(await held()) === JSON.stringify(["Scimitar", "Shortsword"]), `nothing was put away unasked (${JSON.stringify(await held())})`);
    const words = (await asked("Dagger").textContent()) ?? "";
    check(/Jason Reed's hands are full \(Scimitar and Shortsword\), so something has to be put away before Dagger is taken up\./.test(words), `the question says what is in the way (${words})`);
    check(!/object interaction|this turn|free/i.test(words), `out of a fight the question names no cost (${words})`);
    check((await sheet.getByRole("alert").filter({ hasText: "hands are full" }).count()) === 0, "it is a question, not a refusal");
    const labels = (await asked("Dagger").getByRole("button").allTextContents()).map((label) => label.trim());
    check(JSON.stringify(labels) === JSON.stringify(["Put away Scimitar, take up Dagger", "Put away Shortsword, take up Dagger", "Keep as is"]), `one answer for each blade, and one to keep things as they are (${JSON.stringify(labels)})`);
    if (viewport === "phone") {
      // In CSS pixels: the dialog's own scale moves the painted box, not the
      // target's layout size (137-guess-rehand).
      const small = await asked("Dagger").getByRole("button").evaluateAll((buttons) => buttons.filter((button) => button.offsetHeight < 40 || button.offsetWidth < 40).map((button) => button.textContent));
      check(small.length === 0, `every answer is finger-sized on a phone (${small.join(", ") || "all"})`);
    }
    const spill = await asked("Dagger").evaluate((node) => node.scrollWidth - node.clientWidth);
    check(spill <= 0, `the question fits its sheet (${spill}px over)`);
    await asked("Dagger").scrollIntoViewIfNeeded().catch(() => undefined);
    await untilStill(page);
    await t.shot("asked-night");
    const night = await axeViolations(page, '[data-hands-question="Dagger"]');
    check(night.length === 0, `the question passes axe: ${JSON.stringify(night).slice(0, 400)}`);
    const theme = await setTheme(DAY);
    await page.waitForTimeout(800);
    const day = await axeViolations(page, '[data-hands-question="Dagger"]');
    check(day.length === 0, `the question passes axe in the day theme: ${JSON.stringify(day).slice(0, 400)}`);
    await t.shot("asked-day");
    await setTheme(theme);
    // Past the theme's fade back, so the next picture is the night sheet.
    await page.waitForTimeout(800);

    // By keyboard: the answers are reached in order, with a ring on the one
    // that has the focus.
    await toggle("Dagger").focus();
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const element = document.activeElement;
      const style = element ? getComputedStyle(element) : null;
      return { label: element?.textContent?.trim() ?? "", focused: Boolean(element?.matches(":focus-visible")), outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : "", shadow: style?.boxShadow ?? "" };
    });
    check(ring.label === "Put away Scimitar, take up Dagger", `Tab from the row reaches the first answer (${JSON.stringify(ring)})`);
    check(ring.focused && (!/^none/.test(ring.outline) || ring.shadow !== "none"), `a visible focus ring (${JSON.stringify(ring)})`);
    await t.shot("asked-focus");

    // Keep as is: the question goes, and nothing changed.
    await t.tap(answer("Dagger", "Keep as is"));
    await eventually(async () => (await asked("Dagger").count()) === 0, { label: "the question put away" });
    check(JSON.stringify(await held()) === JSON.stringify(["Scimitar", "Shortsword"]), "keeping things as they are changed nothing");

    // Asked again from the row, and answered from the keyboard: the
    // shortsword goes back in the pack and the dagger is in hand.
    await openHeld();
    await toggle("Dagger").scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(toggle("Dagger"));
    await eventually(() => asked("Dagger").count(), { timeoutMs: 15_000, label: "the question again, from the row" });
    await answer("Dagger", "Put away Shortsword, take up Dagger").focus();
    await page.keyboard.press("Enter");
    await eventually(async () => JSON.stringify(await held()) === JSON.stringify(["Scimitar", "Dagger"]), { timeoutMs: 15_000, label: "the dagger in hand and the shortsword packed" });
    await eventually(async () => (await asked("Dagger").count()) === 0, { label: "the question answered" });
    await eventually(async () => ((await toggle("Dagger").textContent()) ?? "").trim() === "In hand", { label: "the dagger's row reads In hand" });
    check(((await toggle("Shortsword").textContent()) ?? "").trim() === "Packed", "the shortsword's row reads Packed");
    check(!(await gear()).Dagger?.heldGuess, "the player's choice ends the guess");

    // The way back, which was the dead end: the shortsword asks too, and is
    // never refused for an object interaction no fight is charging.
    await openHeld();
    await toggle("Shortsword").scrollIntoViewIfNeeded().catch(() => undefined);
    await t.tap(toggle("Shortsword"));
    await eventually(() => asked("Shortsword").count(), { timeoutMs: 15_000, label: "the shortsword's question" });
    check((await sheet.getByRole("alert").filter({ hasText: /hands are full|object interaction/ }).count()) === 0, "no refusal about an object interaction");
    const back = (await asked("Shortsword").getByRole("button").allTextContents()).map((label) => label.trim());
    check(JSON.stringify(back) === JSON.stringify(["Put away Scimitar, take up Shortsword", "Put away Dagger, take up Shortsword", "Keep as is"]), `the way back offers both blades in hand (${JSON.stringify(back)})`);
    await untilStill(page);
    await t.shot("asked-back");
    await t.tap(answer("Shortsword", "Put away Dagger, take up Shortsword"));
    await eventually(async () => JSON.stringify(await held()) === JSON.stringify(["Scimitar", "Shortsword"]), { timeoutMs: 15_000, label: "the shortsword back in hand" });
    await eventually(async () => (await asked("Shortsword").count()) === 0, { label: "the second question answered" });
    await t.shot("swapped-back");
  },
};
