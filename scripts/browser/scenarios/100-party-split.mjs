// Issue 563: the console's two new fields, where a person running the table
// meets them. On the Gone Table the lead, its DM, moves the party with "Who
// goes" naming Kael alone: the party splits (a moment a companion holding a
// plan slips away), and the result says who went and who stayed. A deed's
// form has "Spoke against it", the party's own who objected, beside "Others
// who saw it". Both are chip pickers like the console's others: a named
// group, each character a pressable chip.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

export default {
  name: "party-split",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.gone[viewport];
    await t.open(`/campaigns/${table.id}`);
    await eventually(() => page.locator(`${root}.cine-stage`).count(), { timeoutMs: 30_000, label: "the table's stage" });
    await openPanelTab(t, "dm");
    const tab = async (name) => {
      const button = page.locator(`${root}[data-tour="dm-console-tabs"] button`).filter({ hasText: new RegExp(`^${name}$`, "i") }).locator("visible=true").first();
      await eventually(() => button.count(), { timeoutMs: 30_000, label: `the console's ${name} tab` });
      await t.tap(button);
    };
    const open = async (name) => {
      const button = page.getByRole("button", { name: new RegExp(`^${name}`) }).locator("visible=true").first();
      await eventually(() => button.count(), { label: name });
      await t.tap(button);
      await untilStill(page);
    };

    // ---- Move the party, naming who goes ----
    await tab("world");
    await open("Move the party");
    const place = page.getByLabel("Place", { exact: true }).locator("visible=true").first();
    await eventually(() => place.count(), { label: "the Place field" });
    await place.fill("The Old Mill");
    const goes = page.getByRole("group", { name: "Who goes" }).locator("visible=true").first();
    await eventually(() => goes.count(), { label: "Who goes, a named group" });
    const kael = goes.getByRole("button", { name: /Kael Ashvale/ });
    check((await kael.getAttribute("aria-pressed")) === "false", "nobody is picked by default: the whole party goes");
    await t.tap(kael);
    check((await kael.getAttribute("aria-pressed")) === "true", "Kael picked");
    const box = await kael.boundingBox();
    check(Boolean(box) && box.height >= 32, `a chip a finger can press (${box?.height}px)`);
    await goes.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("who-goes");
    const ran = page.waitForResponse((response) => response.url().endsWith("/dm/invoke") && response.request().method() === "POST", { timeout: 30_000 });
    ran.catch(() => {});
    await t.tap(page.getByRole("button", { name: /^\s*Run\s*$/ }).locator("visible=true").first());
    const answer = await ran;
    check(answer.ok(), `Run answered ${answer.status()}: ${await answer.text()}`);
    const body = await answer.json();
    check(/The party has split up: Kael Ashvale went to The Old Mill/.test(body.result?.note ?? ""), `the split, in the result: ${body.result?.note ?? JSON.stringify(body)}`);
    await untilStill(page);
    await t.shot("split");

    // ---- The split is kept (issue 951): the table says who is where ----
    // The scene line under the title names who the story is with, and the
    // party panel marks whoever is not there. Seren may have slipped away
    // in the split, so the mark is read off Ilse, who stayed.
    const sceneLine = page.locator(`${root}.session-heading p`).first();
    await eventually(async () => /The Old Mill · .*Kael Ashvale/.test((await sceneLine.textContent()) ?? ""), { label: "the scene line naming who the story is with" });
    check(!/Ilse Marrow/.test((await sceneLine.textContent()) ?? ""), "the scene line leaves out who stayed behind");
    await openPanelTab(t, "party");
    const ilse = page.locator(`${root}[data-party-card]`).filter({ hasText: "Ilse Marrow" }).locator("visible=true").first();
    await eventually(() => ilse.count(), { label: "Ilse's card in the party panel" });
    const mark = ilse.locator("[data-elsewhere]").first();
    await eventually(() => mark.count(), { label: "the mark on a character who is elsewhere" });
    check((await mark.textContent())?.trim().startsWith("At "), `the mark says where: ${await mark.textContent()}`);
    const kaelCard = page.locator(`${root}[data-party-card]`).filter({ hasText: "Kael Ashvale" }).locator("visible=true").first();
    check((await kaelCard.locator("[data-elsewhere]").count()) === 0, "nobody the story is with is marked");
    // The mark comes in, as a combatant's side does (globals.css .side-badge).
    check((await mark.evaluate((node) => getComputedStyle(node).animationName)) === "side-badge-in", "the mark animates in");
    await mark.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("elsewhere");
    // The same in the day theme, where the mark must still read.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    const ink = await mark.evaluate((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
    check(ink.color !== ink.background, `the mark has ink on its ground in the day theme (${ink.color} on ${ink.background})`);
    await t.shot("elsewhere-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
    await openPanelTab(t, "dm");

    // ---- A deed's form: who spoke against it ----
    await tab("social");
    await open("Relationship beat");
    const against = page.getByRole("group", { name: "Spoke against it" }).locator("visible=true").first();
    await eventually(() => against.count(), { label: "Spoke against it, a named group" });
    check((await against.getByRole("button", { name: /Ilse Marrow/ }).count()) > 0, "each character a chip");
    await against.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("spoke-against");
  },
};
