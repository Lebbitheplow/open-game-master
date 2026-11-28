// A mounted pair's plate names both creatures (issue 1055). A goblin on a
// wolf is one token, the rider's, and its plate showed the goblin alone:
// nothing said a wolf was under it or how hurt the wolf was, though a tap
// that aims at the pair asks which of the two.
//
// At the Pair Plate Table the lead is a player. The wolf under the first
// goblin is bloodied and prone, the goblin unhurt. Her plate for that token,
// hovered on a desktop and held open by a tap, names both, shows the wolf's
// face and its own health word, and lists the wolf's condition under the
// wolf's name. A second pair has five conditions between the two: held, a
// phone pages them four at a time, each page saying whose they are.
//
// Her own fighter rides a warhorse on record, and the paladin beside her the
// warhorse Find Steed made, hurt and poisoned: each plate names the mount
// and its health. Then she aims an attack: the target list and the "Goblin
// or Wolf?" chips give the wolf its health word beside the goblin's.
// Every plate sits inside the window and is clean through axe. The view's
// half is held by scripts/test-enforce-mounted-pair-plate.mjs.
import { axeViolations, check, eventually, sleep, untilStill } from "../lib.mjs";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const scenario = {
  name: "mounted-pair-plate",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const bench = ids.bench2.pairPlate[viewport];
    const { wolf, horse } = bench;
    const phone = viewport === "phone";
    // Every fault is gathered, so one run says all that is missing.
    const faults = [];
    const expect = (condition, message) => {
      if (!condition) faults.push(message);
    };
    await t.open(`/campaigns/${bench.id}`);
    if (phone) {
      const tab = page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Battle", exact: true }).locator("visible=true").first();
      await eventually(() => tab.isVisible(), { timeoutMs: 30_000, label: "the phone's bar" });
      await t.tap(tab);
    }
    const tokens = page.locator(`${root}[data-token-id]`).locator("visible=true");
    await eventually(async () => (await tokens.count()) >= 4, { timeoutMs: 30_000, label: "the board's four tokens" });
    const title = page.getByText("Roll initiative", { exact: true }).locator("visible=true");
    await eventually(async () => (await title.count()) === 0, { timeoutMs: 30_000, label: "the title card gone" });
    const hide = page.locator(`${root}button`, { hasText: /^Hide$/i }).locator("visible=true").first();
    if (await hide.count()) {
      await t.tap(hide);
    }
    await untilStill(page).catch(() => undefined);
    const board = page.locator(`${root}.board-panel`).locator("visible=true").first();
    const figureOf = (name) => board.getByRole("img", { name: new RegExp(`^${escape(name)}`) }).first();
    const inWindow = async (locator) => {
      const box = await locator.boundingBox();
      const size = page.viewportSize();
      return Boolean(box && size && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height);
    };
    const hovered = page.locator('[role="tooltip"]').locator("visible=true");
    const held = page.locator('[role="dialog"][data-pinned]').locator("visible=true");
    const closeHeld = async () => {
      if (await held.count()) {
        await page.keyboard.press("Escape");
        await eventually(async () => !(await held.count()), { label: "the held plate closed" });
      }
      await page.mouse.move(2, 2);
      await untilStill(page).catch(() => undefined);
    };
    // What a plate says of the mount under its figure.
    const readMount = async (plate) => {
      const part = plate.locator("[data-plate-mount]");
      if (!(await part.count())) return null;
      return { text: ((await part.textContent()) ?? "").trim(), faces: await part.locator("img").count() };
    };
    const listOf = (plate, name) => plate.getByRole("list", { name: `${name}: conditions`, exact: true });
    const axe = async (selector, when) => {
      const found = await axeViolations(page, selector);
      expect(!found.length, `axe on ${when}: ${found.map((entry) => entry.id).join(", ")}`);
    };
    // The plate of one figure, as the mount's lines should read on it.
    const checkPlate = async (plate, when, { rider, mount, mountHealth, riderHealth }) => {
      const text = (await plate.textContent()) ?? "";
      expect(text.includes(rider) && text.includes(riderHealth), `${when} names ${rider}, ${riderHealth} (${text.slice(0, 160)})`);
      const under = await readMount(plate);
      expect(under, `${when} says nothing of ${mount} under ${rider} (${text.slice(0, 160)})`);
      if (under) {
        expect(under.text.includes(mount), `${when} names the mount (${under.text})`);
        const cut = await plate.locator("[data-plate-mount-name]").evaluate((line) => line.scrollWidth > line.clientWidth).catch(() => false);
        expect(!cut, `${when} cuts the mount's name short (${under.text})`);
        expect(!mountHealth || under.text.includes(mountHealth), `${when} gives ${mount} its own health word, ${mountHealth} (${under.text})`);
      }
      expect(await inWindow(plate), `${when} sits whole inside the window (${JSON.stringify(await plate.boundingBox())})`);
    };
    const figureLabel = (await figureOf(wolf.rider.name).getAttribute("aria-label")) ?? "";
    expect(figureLabel.includes(wolf.mount.name), `the pair's figure is read out with its mount (${figureLabel})`);

    // ---- the goblin on the wolf: hovered (a desktop's pointer), then held ----
    const pair = figureOf(wolf.rider.name);
    const wolfLooks = { rider: wolf.rider.name, mount: wolf.mount.name, riderHealth: "Unharmed", mountHealth: "Bloodied" };
    if (!phone) {
      const at = await pair.boundingBox();
      check(at, `${wolf.rider.name} has a place on screen`);
      await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
      const plate = hovered.filter({ hasText: wolf.rider.name }).first();
      await eventually(() => plate.isVisible(), { timeoutMs: 10_000, label: "the pair's hover plate" });
      await untilStill(page);
      await checkPlate(plate, "the hovered plate", wolfLooks);
      expect((await readMount(plate))?.faces === 1, "the hovered plate shows the mount's face");
      expect(((await listOf(plate, wolf.mount.name).textContent().catch(() => "")) ?? "").toLowerCase().includes("prone"), `the hovered plate lists prone under ${wolf.mount.name}`);
      expect(!(await listOf(plate, wolf.rider.name).count()), `${wolf.rider.name} has no conditions, and the hovered plate lists some as its own`);
      await axe('[role="tooltip"]', "the hovered plate");
      await t.shot("pair-hovered");
      await plate.screenshot({ path: t.shotPath("pair-hovered-plate") }).catch(() => {});
    }
    await t.tap(pair);
    await eventually(() => held.count(), { timeoutMs: 10_000, label: "the pair's plate held open" });
    await untilStill(page);
    await checkPlate(held.first(), "the held plate", wolfLooks);
    expect((await readMount(held.first()))?.faces === 1, "the held plate shows the mount's face");
    expect(((await held.first().getAttribute("aria-label")) ?? "") === `${wolf.rider.name} on ${wolf.mount.name}: details`, `the held plate's name for a screen reader names both (${await held.first().getAttribute("aria-label")})`);
    expect(((await listOf(held.first(), wolf.mount.name).textContent().catch(() => "")) ?? "").toLowerCase().includes("prone"), `the held plate lists prone under ${wolf.mount.name}`);
    await axe('[role="dialog"][data-pinned]', "the held plate");
    if (!phone) {
      // A player's click holds the plate: the pointer may leave the figure for
      // it, which is how the pager is reached.
      const box = await held.first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
      await sleep(400);
      check(await held.count(), "the plate a click held open closed as the pointer moved onto it");
    }
    await t.shot("pair-held");
    await held.first().screenshot({ path: t.shotPath("pair-held-plate") }).catch(() => {});
    await closeHeld();

    // ---- five conditions between the two: paged, each page says whose ----
    await t.tap(figureOf(horse.rider.name));
    await eventually(() => held.count(), { timeoutMs: 10_000, label: "the second pair's plate held open" });
    await untilStill(page);
    const crowded = held.first();
    await checkPlate(crowded, "the crowded plate", { rider: horse.rider.name, mount: horse.mount.name, riderHealth: "Scratched", mountHealth: "Near collapse" });
    const riderRows = listOf(crowded, horse.rider.name).locator("> li");
    const mountRows = listOf(crowded, horse.mount.name).locator("> li");
    expect((await riderRows.count()) === 2, `${horse.rider.name}'s two conditions are listed as its own (${await riderRows.count()})`);
    if (phone) {
      const status = crowded.locator('[aria-live="polite"]');
      expect(((await status.textContent().catch(() => "")) ?? "") === "Page 1 of 2", `five conditions page four at a time on a phone (${await status.textContent().catch(() => "no pager")})`);
      expect((await mountRows.count()) === 2, `the first page holds two of ${horse.mount.name}'s three (${await mountRows.count()})`);
      await t.shot("crowded-page-1");
      const next = crowded.getByRole("button", { name: "Next conditions" });
      if (await next.count()) {
        await t.tap(next);
        await sleep(500);
        await untilStill(page);
        expect((await mountRows.count()) === 1 && !(await riderRows.count()), `the second page holds ${horse.mount.name}'s last one, under its name (${await mountRows.count()} and ${await riderRows.count()})`);
        expect(await inWindow(crowded), "the second page sits whole inside the window");
        await t.shot("crowded-page-2");
      }
    } else {
      expect((await mountRows.count()) === 3, `${horse.mount.name}'s three conditions are listed as its own (${await mountRows.count()})`);
      await t.shot("crowded");
    }
    await axe('[role="dialog"][data-pinned]', "the crowded plate");
    await crowded.screenshot({ path: t.shotPath("crowded-plate") }).catch(() => {});
    await closeHeld();

    // ---- the paladin on the steed Find Steed made ----
    await t.tap(figureOf(bench.maren));
    await eventually(() => held.count(), { timeoutMs: 10_000, label: "the paladin's plate held open" });
    await untilStill(page);
    await checkPlate(held.first(), "the paladin's plate", { rider: bench.maren, mount: bench.steed, riderHealth: "Unharmed", mountHealth: "Bloodied" });
    expect(((await listOf(held.first(), bench.steed).textContent().catch(() => "")) ?? "").toLowerCase().includes("poisoned"), `the paladin's plate lists poisoned under ${bench.steed}`);
    await axe('[role="dialog"][data-pinned]', "the paladin's plate");
    await t.shot("steed-held");
    await held.first().screenshot({ path: t.shotPath("steed-held-plate") }).catch(() => {});
    await closeHeld();

    // ---- the lead's own fighter on a warhorse on record: the dial's Details ----
    const mine = figureOf(bench.mara);
    const dial = board.getByRole("menu", { name: new RegExp(`^Actions for ${escape(bench.mara)}`) });
    await t.tap(mine);
    await eventually(() => dial.count(), { label: "the lead's own dial" });
    await t.tap(dial.getByRole("menuitem", { name: "Details" }));
    await eventually(() => held.count(), { timeoutMs: 10_000, label: "the lead's own plate held open" });
    await untilStill(page);
    await checkPlate(held.first(), "the mounted character's plate", { rider: bench.mara, mount: bench.mount, riderHealth: "Unharmed", mountHealth: "Unharmed" });
    await axe('[role="dialog"][data-pinned]', "the mounted character's plate");
    await t.shot("character-held");
    await held.first().screenshot({ path: t.shotPath("character-held-plate") }).catch(() => {});
    await closeHeld();

    // ---- aiming: the wolf's chip carries its health word, as the goblin's does ----
    await t.tap(mine);
    await eventually(() => dial.count(), { timeoutMs: 3_000, label: "the dial" }).catch(() => t.tap(mine));
    await eventually(() => dial.count(), { label: "the lead's own dial again" });
    await t.tap(dial.getByLabel("Attack", { exact: true }));
    await untilStill(page).catch(() => undefined);
    const list = page.getByRole("group", { name: "Targets", exact: true }).locator("visible=true");
    await eventually(() => list.count(), { timeoutMs: 15_000, label: "the target list" });
    const listed = ((await list.getByRole("button", { name: new RegExp(`^${escape(wolf.mount.name)}`) }).first().textContent()) ?? "");
    expect(listed.includes("Bloodied"), `the target list gives ${wolf.mount.name} its health word (${listed})`);
    await t.tap(pair);
    const which = page.getByRole("group", { name: `${wolf.rider.name} or ${wolf.mount.name}?`, exact: true }).locator("visible=true");
    await eventually(() => which.count(), { timeoutMs: 15_000, label: "the two names asked for the pair's token" });
    await untilStill(page).catch(() => undefined);
    const chipOf = async (name) => ((await which.getByRole("button", { name: new RegExp(`^${escape(name)}`) }).textContent()) ?? "");
    expect((await chipOf(wolf.rider.name)).includes("Unharmed"), `the goblin's chip keeps its health word (${await chipOf(wolf.rider.name)})`);
    expect((await chipOf(wolf.mount.name)).includes("Bloodied"), `the wolf's chip has its health word (${await chipOf(wolf.mount.name)})`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the chooser does not push the page sideways");
    await t.shot("chooser");
    await t.tap(page.getByRole("button", { name: "Cancel aiming", exact: true }).locator("visible=true").first());

    check(faults.length === 0, `${faults.length} fault(s):\n  - ${faults.join("\n  - ")}`);
  },
};

export default scenario;
