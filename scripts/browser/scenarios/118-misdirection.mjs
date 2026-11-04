// Misdirection turns a hit onto another creature, and its card named none, so the
// engine refused it. The card now offers the creatures beside the holder, not the
// attacker and not one 25 feet off, and from the GM's own seat the engine resolves
// the pick: the arrow comes off the rogue and lands on the goblin in its line,
// whose body gave the rogue cover. On a desktop and
// a phone, day and night, the Hand through axe (the seed's bench2.misdirection).
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "misdirection",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const phone = t.viewport === "phone";
    const bench = ids.bench2[t.viewport].misdirection;
    const state = async () => await (await api.get(`${base}/api/campaigns/${bench.id}`)).json();
    const sheetHp = (view) => (view.sheets ?? []).find((sheet) => sheet.id === bench.vex.id)?.currentHp;
    const foeHp = (view, id) => (view.encounter?.enemies ?? []).find((enemy) => enemy.id === id)?.currentHp;
    const before = await state();
    const hurt = sheetHp(before);
    check(typeof hurt === "number" && hurt < 80, `the goblin's blow is on ${bench.vex.name} (${hurt})`);

    await t.open(`/campaigns/${bench.id}`);
    const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
    const tableTab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }).locator("visible=true").first();
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "Vex's Hand" },
    );
    const strips = hand.locator('[role="group"][aria-label="Reactions"]');
    const chip = strips.getByRole("button", { name: /^Misdirection/ }).first();
    await eventually(() => chip.isVisible(), { timeoutMs: 20_000, label: "the Misdirection card" });
    check((await chip.getAttribute("aria-disabled")) !== "true", "Misdirection is open with a goblin beside Vex");
    if (phone) {
      await untilStill(page).catch(() => undefined);
      const box = await chip.boundingBox();
      check(box && Math.round(box.height) >= 40, `the card is at least 40px tall on a phone (${box?.height})`);
    }

    await t.tap(chip);
    const picks = hand.locator('[role="group"][aria-label="Targets"]').locator("visible=true").first();
    await eventually(() => picks.isVisible(), { timeoutMs: 20_000, label: "the creatures to pick from" });
    const options = picks.getByRole("button");
    check((await options.count()) === 1, `one creature to pick, the goblin beside Vex (${await options.count()}: ${await picks.innerText()})`);
    await hand.evaluate((node) => node.setAttribute("data-misdirection", "hand"));
    for (const theme of ["dark", "light"]) {
      await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
      await untilStill(page).catch(() => undefined);
      const faults = await axeViolations(page, '[data-misdirection="hand"]');
      check(faults.length === 0, `the Hand passes axe in the ${theme} theme: ${JSON.stringify(faults).slice(0, 400)}`);
      await t.shot(`misdirection-pick-${theme}`);
    }

    await t.tap(options.first());
    const send = hand.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();
    await eventually(async () => /misdirection/i.test(await send.innerText()), { label: "the aim bar for Misdirection" });
    const resolving = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${bench.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(send);
    const resolved = await resolving;
    const outcome = await resolved.json();
    check(resolved.ok() && outcome.resolved === true, `the engine resolved it (${resolved.status()} ${JSON.stringify(outcome).slice(0, 240)})`);
    check(resolved.request().postDataJSON()?.intent?.targetId === bench.beside, "the pick is the goblin beside Vex");

    const after = await state();
    check(sheetHp(after) > hurt, `the blow comes off ${bench.vex.name} (${hurt} to ${sheetHp(after)})`);
    check(foeHp(after, bench.beside) < foeHp(before, bench.beside), "and lands on the goblin beside them");
    check(foeHp(after, bench.far) === foeHp(before, bench.far), "the goblin 25 feet off is untouched");
    await untilStill(page).catch(() => undefined);
    await t.shot("misdirection-resolved");

    // Off their turn the board's distances are the acting hero's, so they do not
    // judge the pick: both other goblins and Brom are offered, not the attacker
    // nor Vex, and the goblin beside Vex takes the blow.
    const off = ids.bench2[t.viewport].misdirectionOff;
    const offState = async () => await (await api.get(`${base}/api/campaigns/${off.id}`)).json();
    const offBefore = await offState();
    const nameOf = (id) => (offBefore.encounter?.enemies ?? []).find((enemy) => enemy.id === id)?.name;
    await t.open(`/campaigns/${off.id}`);
    await eventually(
      async () => {
        if (await hand.isVisible().catch(() => false)) return true;
        if (phone && (await tableTab.count())) await t.tap(tableTab).catch(() => undefined);
        return false;
      },
      { timeoutMs: 30_000, label: "the Hand at the off-turn table" },
    );
    const offChip = strips.filter({ hasText: off.vex.name }).getByRole("button", { name: /^Misdirection/ }).first();
    await eventually(() => offChip.isVisible(), { timeoutMs: 20_000, label: "Vex's Misdirection, off their turn" });
    await t.tap(offChip);
    const offPicks = hand.locator('[role="group"][aria-label="Targets"]').locator("visible=true").first();
    await eventually(() => offPicks.isVisible(), { timeoutMs: 20_000, label: "the creatures to pick from, off turn" });
    const offered = offPicks.getByRole("button");
    check((await offered.count()) === 3, `both other goblins and Brom are offered (${await offPicks.innerText()})`);
    check(!(await offPicks.innerText()).includes(nameOf(off.striker)), "not the attacker");
    check(!(await offPicks.innerText()).includes(off.vex.name), "not Vex, whose hit it answers");
    await t.shot("misdirection-off-turn");
    await t.tap(offPicks.getByRole("button", { name: new RegExp(`^${nameOf(off.beside)}`) }).first());
    const offSend = hand.locator("div", { has: page.getByRole("button", { name: "Back", exact: true }) }).last().getByRole("button").last();
    await eventually(async () => /misdirection/i.test(await offSend.innerText()), { label: "the aim bar off turn" });
    const offResolving = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${off.id}/actions`) && response.request().method() === "POST", { timeout: 30_000 });
    await t.tap(offSend);
    const offAnswer = await offResolving;
    const offOutcome = await offAnswer.json();
    check(offAnswer.ok() && offOutcome.resolved === true, `resolved off turn (${offAnswer.status()} ${JSON.stringify(offOutcome).slice(0, 240)})`);
    const offBody = offAnswer.request().postDataJSON();
    check(offBody?.characterId === off.vex.id && offBody?.intent?.targetId === off.beside, `sent for Vex at the goblin beside them (${JSON.stringify(offBody).slice(0, 240)})`);
    const offAfter = await offState();
    const offHp = (view, id) => (view.encounter?.enemies ?? []).find((enemy) => enemy.id === id)?.currentHp;
    check(offHp(offAfter, off.beside) < offHp(offBefore, off.beside), "the goblin beside Vex takes the blow");
    check(offHp(offAfter, off.byBrom) === offHp(offBefore, off.byBrom), "the goblin beside Brom is untouched");
  },
};
