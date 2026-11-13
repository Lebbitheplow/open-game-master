// A card that cannot be played now (another's turn, a reaction with nothing
// to answer) only said why when pressed, so a phone, which has no hover,
// could not read what it does. It now opens a panel to read it, under the
// rail, which stays, and the reason is still said. And no card showed its
// whole text (a spell's description, what changes at higher levels) outside
// the board panel: the read panel and the aim bar both open it on asking.
import { check, eventually, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

export default {
  name: "hand-read-panel",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api, ids, viewport } = t;
    // A spell's description comes from the content pack, which a server
    // without one (CI's browser jobs) does not have: there a card has no
    // text beyond its rules line, so it offers none to open.
    const catalog = await api.get(`${base}/api/content/spells?class=wizard&level=1`);
    const packInstalled = catalog.ok() && (await catalog.json()).packInstalled === true;
    const press = async (locator) => {
      if (t.touch) return t.tap(locator);
      await locator.focus();
      await page.keyboard.press("Enter");
    };
    await t.open(`/campaigns/${ids.spellbook[viewport].id}`);
    const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
    if (await tab.count()) await t.tap(tab.first());
    const spells = page.locator(`${root}button.hand-group-card[data-group-id="group:spells"]`);
    await eventually(() => spells.count(), { timeoutMs: 30_000, label: "the Spells card in the fan" });
    await press(spells.first());
    const levelOne = page.locator(`${root}.hand-group [role="tab"]`).filter({ hasText: "Level 1" }).first();
    await eventually(() => levelOne.count(), { label: "the Level 1 tab" });
    await t.tap(levelOne);
    const fan = page.locator(`${root}.hand-fan`);
    const card = (name) => visible(fan.locator(`button.hand-card[aria-label^="${name},"]`)).first();

    // Shield answers a hit; on her own turn there is none, so it is held.
    const shield = card("Shield");
    await eventually(() => shield.count(), { label: "Shield under Level 1" });
    await untilStill(page);
    check((await shield.getAttribute("aria-disabled")) === "true", "Shield cannot be played on her own turn");
    const onCard = (await shield.locator(".hand-rules").textContent()) ?? "";

    // A held card is aria-disabled, which Playwright's tap waits out: the
    // press is forced, as a finger's would land.
    if (t.touch) await (t.app ? shield.tap({ force: true }) : shield.click({ force: true }));
    else await press(shield);
    const panel = visible(page.locator(`${root}.hand-read`));
    await eventually(() => panel.count(), { label: "the read panel of the held card" });
    const notice = page.locator(`${root}section[aria-label="Your hand"] p[role="status"]`).locator("visible=true").first();
    await eventually(async () => (await notice.count()) && (await notice.innerText()).trim().length > 0, { label: "the reason, still said" });
    check(await visible(fan.locator("button.hand-card")).count() > 0, "the rail stays beside the panel");
    const read = await panel.first().evaluate((box) => ({
      name: box.getAttribute("aria-label") ?? "",
      rules: box.querySelector(".hand-aim-rules")?.textContent ?? "",
      size: parseFloat(getComputedStyle(box.querySelector(".hand-aim-rules") ?? box).fontSize),
    }));
    check(read.name.startsWith("Shield"), `the panel is Shield's (${read.name})`);
    check(read.rules === onCard, `it writes the card's whole rules line ("${read.rules}")`);
    check(read.size >= 12, `at a size that reads (${read.size}px)`);

    // Close and Escape hand the keyboard back to the card that opened the
    // panel (a frame later), so the next key lands on it and not on the page.
    const backOnShield = () =>
      eventually(() => shield.evaluate((button) => button === document.activeElement), { label: "the keyboard back on Shield" });

    // Escape lets the panel go, as it lets an aimed card go.
    if (!t.touch) {
      await page.keyboard.press("Escape");
      await eventually(async () => !(await panel.count()), { label: "Escape closed the read panel" });
      await backOnShield();
      await press(shield);
      await eventually(() => panel.count(), { label: "the read panel, opened again" });
    }

    // A held card pressed while another is aimed says why and leaves the aim
    // bar be; letting the aimed card go opens no panel nobody asked for. A
    // fight on the stage (and a phone) hides the rail under an aim bar, but a
    // tall table without the stage shows both, so the press is made on the
    // card itself.
    const heldWhileAimed = async (aim) => {
      await fan.locator('button.hand-card[aria-label^="Shield,"]').first().evaluate((button) => button.click());
      await untilStill(page);
      check(await aim.count(), "the aim bar keeps its place");
      check(!(await panel.count()), "no read panel opens under an aimed card");
      await page.keyboard.press("Escape");
      await eventually(async () => !(await aim.count()), { label: "the aimed card let go" });
      await untilStill(page);
      check(!(await panel.count()), "and none opens once it is let go");
    };

    // Its whole text, on asking, with a finger-sized opener.
    const opener = panel.first().locator(".hand-full-text-toggle");
    if (!packInstalled) {
      check(!(await opener.count()), "with no content pack the held card offers no full text to open");
      await t.tap(panel.first().getByRole("button", { name: "Close" }));
      await eventually(async () => !(await panel.count()), { label: "the read panel closed" });
      await backOnShield();
      await press(card("Magic Missile"));
      const aim = visible(page.locator(`${root}.hand-aim:not(.hand-read)`)).first();
      await eventually(() => aim.count(), { label: "the aim bar of Magic Missile" });
      check(!(await aim.locator(".hand-full-text-toggle").count()), "nor does a playable card's aim bar");
      await heldWhileAimed(aim);
      return;
    }
    check(await opener.count(), "the held card offers its full text");
    const tall = await opener.evaluate((summary) => summary.getBoundingClientRect().height);
    check(viewport !== "phone" || tall >= 40, `the opener is finger-sized on a phone (${tall}px)`);
    await t.tap(opener);
    const body = panel.first().locator(".hand-full-text-body");
    await eventually(() => body.isVisible(), { label: "Shield's full text" });
    const full = (await body.textContent()) ?? "";
    check(full.length > onCard.length, `the full text says more than the card (${full.length} characters)`);
    // On a short phone the Hand scrolls: the opened text is brought up to be read.
    await untilStill(page);
    const seen = await body.evaluate((text) => {
      const box = text.getBoundingClientRect();
      const hand = (text.closest(".hand") ?? document.documentElement).getBoundingClientRect();
      return { shown: Math.min(box.bottom, hand.bottom, window.innerHeight) - Math.max(box.top, hand.top), tall: box.height };
    });
    check(seen.shown >= Math.min(seen.tall, 80) - 1, `the opened text shows in the Hand (${Math.round(seen.shown)} of ${Math.round(seen.tall)}px)`);
    await untilStill(page);
    await t.shot("read");

    await t.tap(panel.first().getByRole("button", { name: "Close" }));
    await eventually(async () => !(await panel.count()), { label: "the read panel closed" });
    await backOnShield();

    // A card that can be played: the aim bar opens its full text too, here
    // with what changes at higher levels.
    const missile = card("Magic Missile");
    await press(missile);
    const aim = visible(page.locator(`${root}.hand-aim:not(.hand-read)`)).first();
    await eventually(() => aim.count(), { label: "the aim bar of Magic Missile" });
    await t.tap(aim.locator(".hand-full-text-toggle"));
    const aimBody = aim.locator(".hand-full-text-body");
    await eventually(() => aimBody.isVisible(), { label: "Magic Missile's full text in the aim bar" });
    const aimFull = (await aimBody.textContent()) ?? "";
    const aimRules = (await aim.locator(".hand-aim-rules").textContent()) ?? "";
    check(/higher levels/i.test(aimFull), "it tells what changes at higher levels");
    check(!aimFull.includes(aimRules), "and does not write the card's rules line a second time");
    await untilStill(page);
    await t.shot("aim");
    await heldWhileAimed(aim);
  },
};
